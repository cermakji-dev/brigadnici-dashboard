// Tvorba rozpisu na další měsíce: stejné rozložení jako Google tabulka
// (den = 6 sloupců oddělení × hodiny 8–20), SMĚNA 1/2, pravidla a našeptávač.
// Čistá logika bez DOM – testy v tests/roster.test.mjs.

export const ROSTER_COLUMNS = 6;
export const ROSTER_START = 8 * 60;
export const ROSTER_END = 20 * 60;
export const FREE_LABEL = "VOLNÁ SMĚNA";
export const DEPARTMENT_OPTIONS = ["Výdej", "Prodej", "Výdej / Prodej", "LEGO", "MV", "Retail", "LOG", "První směna", "Pokladny", "Upsell / Prodej", "LEGO / Retail"];

const normalize = value => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
export const isFreeValue = value => /^voln/.test(normalize(value));

const pad = number => String(number).padStart(2, "0");
const keyOf = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const parseKey = key => { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d); };
export const cellKey = (column, minute) => `${column}|${minute}`;
export const rosterHours = () => Array.from({ length: (ROSTER_END - ROSTER_START) / 60 }, (_, index) => ROSTER_START + index * 60);
export const monthDates = month => {
  const [year, number] = month.split("-").map(Number);
  const days = new Date(year, number, 0).getDate();
  return Array.from({ length: days }, (_, index) => keyOf(new Date(year, number - 1, index + 1)));
};
// Po = 0 … Ne = 6
export const weekdayIndex = key => (parseKey(key).getDay() + 6) % 7;

// SMĚNA 1/2: střídá se po dvojicích Po–Út, St–Čt a trojici Pá–Ne, další týden obráceně.
// Ověřeno na září 2025 a říjnu i listopadu 2026 (Po 2. 11. 2026 = SMĚNA 1).
const ANCHOR = Date.UTC(2026, 10, 2);
export const shiftNumber = key => {
  const [y, m, d] = key.split("-").map(Number);
  const days = Math.round((Date.UTC(y, m - 1, d) - ANCHOR) / 86400000);
  const week = Math.floor(days / 7);
  const dow = ((days % 7) + 7) % 7;
  const group = dow <= 1 ? 0 : dow <= 3 ? 1 : 2;
  const first = group === 1 ? 2 : 1;
  return week % 2 === 0 ? first : 3 - first;
};

export const emptyDay = (columns = []) => ({
  columns: Array.from({ length: ROSTER_COLUMNS }, (_, index) => columns[index] || ""),
  cells: {}
});

// Dny z Google rozpisu (řádky tabulky shifts) → stejná struktura jako koncept.
export const daysFromShiftRows = rows => {
  const byDate = new Map();
  rows.forEach(row => {
    if (!byDate.has(row.date)) byDate.set(row.date, []);
    byDate.get(row.date).push(row);
  });
  const days = {};
  byDate.forEach((list, date) => {
    const order = [...new Set(list.map(row => row.column))].sort((a, b) => a - b).slice(0, ROSTER_COLUMNS);
    const columns = order.map(column => list.find(row => row.column === column)?.department || "");
    const day = emptyDay(columns);
    list.forEach(row => {
      const index = order.indexOf(row.column);
      if (index < 0) return;
      for (let minute = row.start; minute < row.end; minute += 60) day.cells[cellKey(index, minute)] = row.free ? FREE_LABEL : row.name;
    });
    days[date] = day;
  });
  return days;
};

// Nový měsíc podle minulého: stejné sloupce podle dne v týdnu (a stejné SMĚNY,
// když to jde); volné směny se volitelně předvyplní tam, kde minule někdo byl.
export const draftFromHistory = (month, historyDays, { copyFree = true } = {}) => {
  const history = Object.keys(historyDays).sort();
  const pick = date => {
    const weekday = weekdayIndex(date);
    const smena = shiftNumber(date);
    const same = history.filter(key => weekdayIndex(key) === weekday);
    return [...same].reverse().find(key => shiftNumber(key) === smena) || same[same.length - 1] || null;
  };
  const days = {};
  monthDates(month).forEach(date => {
    const source = pick(date);
    const template = source ? historyDays[source] : null;
    const day = emptyDay(template?.columns || []);
    if (template && copyFree) {
      Object.entries(template.cells).forEach(([key, value]) => { if (value) day.cells[key] = FREE_LABEL; });
    }
    days[date] = day;
  });
  return { month, days };
};

const ruleMatches = (rule, date) => {
  const weekday = weekdayIndex(date);
  const days = rule.days;
  const dayOk = days === "all" || (days === "weekdays" && weekday <= 4) || (days === "weekend" && weekday >= 5)
    || (Array.isArray(days) && days.includes(weekday));
  return dayOk && (!rule.smena || Number(rule.smena) === shiftNumber(date));
};

// Pravidlo vypíše „VOLNÁ SMĚNA“ do sloupce daného oddělení; když sloupec chybí,
// použije první úplně prázdný sloupec a pojmenuje ho. Opakované použití nic nezdvojí.
export const applyRules = (draft, rules) => {
  let added = 0;
  Object.entries(draft.days).forEach(([date, day]) => {
    rules.filter(rule => ruleMatches(rule, date)).forEach(rule => {
      const hours = rosterHours().filter(minute => minute >= rule.start && minute < rule.end);
      const wanted = normalize(rule.department);
      const covered = day.columns.some((name, index) => normalize(name) === wanted && hours.every(minute => day.cells[cellKey(index, minute)]));
      if (covered) return;
      let index = day.columns.findIndex((name, column) => normalize(name) === wanted && hours.every(minute => !day.cells[cellKey(column, minute)]));
      if (index < 0) {
        index = day.columns.findIndex((name, column) => rosterHours().every(minute => !day.cells[cellKey(column, minute)]) && (!name || normalize(name) === wanted));
        if (index < 0) index = day.columns.findIndex((_, column) => rosterHours().every(minute => !day.cells[cellKey(column, minute)]));
        if (index < 0) return;
        day.columns[index] = rule.department;
      }
      hours.forEach(minute => {
        if (!day.cells[cellKey(index, minute)]) { day.cells[cellKey(index, minute)] = FREE_LABEL; added += 1; }
      });
    });
  });
  return added;
};

const DAY_NAMES = ["pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota", "neděle"];
const DAY_EVERY = ["každé pondělí", "každé úterý", "každou středu", "každý čtvrtek", "každý pátek", "každou sobotu", "každou neděli"];
export const describeRule = rule => {
  const when = rule.days === "all" ? "Každý den" : rule.days === "weekdays" ? "Po–Pá" : rule.days === "weekend" ? "So–Ne"
    : rule.days.map(index => DAY_EVERY[index]).join(", ").replace(/^./, letter => letter.toUpperCase());
  return `${when}${rule.smena ? ` (SMĚNA ${rule.smena})` : ""} · ${rule.department} ${rule.start / 60}–${rule.end / 60}`;
};
export const dayName = index => DAY_NAMES[index];

// Souvislé úseky obsazení ve sloupci (kdokoli nebo volná směna).
const blocksOfDay = day => {
  const blocks = [];
  day.columns.forEach((department, column) => {
    if (!department) return;
    let start = null;
    const hours = rosterHours();
    hours.forEach((minute, index) => {
      const filled = Boolean(day.cells[cellKey(column, minute)]);
      if (filled && start === null) start = minute;
      const last = index === hours.length - 1;
      if (start !== null && (!filled || last)) {
        const end = filled && last ? minute + 60 : minute;
        if (end - start >= 3 * 60) blocks.push({ department, start, end });
        start = null;
      }
    });
  });
  return blocks;
};

// Našeptávač: opakující se úseky z minulých dní navrhne jako pravidla.
export const suggestRules = (historyDays, existing = []) => {
  const dates = Object.keys(historyDays).sort();
  if (!dates.length) return [];
  const label = block => `${normalize(block.department)}|${block.start}|${block.end}`;
  const everyDay = new Map();
  const perClass = new Map();
  const classSize = new Map();
  dates.forEach(date => {
    const klass = `${weekdayIndex(date)}|${shiftNumber(date)}`;
    classSize.set(klass, (classSize.get(klass) || 0) + 1);
    new Set(blocksOfDay(historyDays[date]).map(block => JSON.stringify(block))).forEach(text => {
      const block = JSON.parse(text);
      const key = label(block);
      everyDay.set(key, { block, count: (everyDay.get(key)?.count || 0) + 1 });
      const classKey = `${klass}|${key}`;
      perClass.set(classKey, { block, klass, count: (perClass.get(classKey)?.count || 0) + 1 });
    });
  });
  const has = rule => existing.some(item => normalize(item.department) === normalize(rule.department) && item.start === rule.start && item.end === rule.end
    && JSON.stringify(item.days) === JSON.stringify(rule.days) && Number(item.smena || 0) === Number(rule.smena || 0));
  const suggestions = [];
  const daily = new Set();
  everyDay.forEach(({ block, count }, key) => {
    if (count >= Math.max(5, dates.length * 0.8)) {
      daily.add(key);
      suggestions.push({ rule: { days: "all", smena: 0, department: block.department, start: block.start, end: block.end }, count, of: dates.length });
    }
  });
  perClass.forEach(({ block, klass, count }) => {
    const [weekday, smena] = klass.split("|").map(Number);
    const size = classSize.get(klass);
    if (daily.has(label(block)) || count < 2 || count < size * 0.75) return;
    suggestions.push({ rule: { days: [weekday], smena, department: block.department, start: block.start, end: block.end }, count, of: size });
  });
  return suggestions
    .filter(item => !has(item.rule))
    .sort((a, b) => (a.rule.days === "all" ? -1 : 0) - (b.rule.days === "all" ? -1 : 0) || b.count / b.of - a.count / a.of || b.count - a.count)
    .slice(0, 8);
};

// Počty jako v tabulce: lidí (vč. volných) na hodinu a „Celkem hod.“.
export const dayTotals = day => {
  const perHour = rosterHours().map(minute => day.columns.reduce((sum, _, column) => sum + (day.cells[cellKey(column, minute)] ? 1 : 0), 0));
  return { perHour, total: perHour.reduce((sum, value) => sum + value, 0) };
};

// Export pro vložení do Google tabulky: stejné rozložení A–J jako stávající listy.
export const draftToTsv = draft => {
  const lines = [];
  Object.keys(draft.days).sort().forEach(date => {
    const day = draft.days[date];
    const [y, m, d] = date.split("-").map(Number);
    const { perHour, total } = dayTotals(day);
    lines.push(["", `${d}.${m}.${y}`, "", "", "", "", "", "", "", `SMĚNA ${shiftNumber(date)}`]);
    lines.push(["Určení:", ...day.columns.map(name => (name ? `↓ ${name} ↓` : ""))]);
    rosterHours().forEach((minute, index) => {
      const label = `${minute / 60}-${minute / 60 + 1} h`;
      lines.push([label, ...day.columns.map((_, column) => day.cells[cellKey(column, minute)] || ""), label, String(perHour[index])]);
    });
    lines.push(["", "", "", "", "", "", "", "Celkem hod.:", String(total)]);
  });
  return lines.map(cells => cells.map(cell => String(cell).replace(/[\t\n]/g, " ")).join("\t")).join("\n");
};
