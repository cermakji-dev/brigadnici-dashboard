// Zápis směn: přečte žádosti brigádníků (zprávy z WhatsAppu) a navrhne,
// jak je rozdělit do volných slotů („VOLNÁ SMĚNA“) v rozpisu.
// Čistá logika bez DOM – testy v tests/planner.test.mjs.

export const MONTHLY_LIMIT_MINUTES = 85 * 60;
export const MIN_BLOCK_MINUTES = 3 * 60;
const DAY_START = 8 * 60;
const DAY_END = 20 * 60;

const normalize = value => String(value ?? "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Oddělení, která brigádníci ve zprávách zmiňují, a jak je poznat ve sloupci rozpisu.
export const PLAN_DEPARTMENTS = [
  { key: "LEGO", text: /(^|[^a-z])lego/, column: /lego/ },
  { key: "Prodej", text: /(^|[^a-z])prodej/, column: /prodej/ },
  { key: "Výdej", text: /(^|[^a-z])vydej/, column: /vydej/ },
  { key: "MV", text: /(^|[^a-z])mv([^a-z]|$)/, column: /(^|[^a-z])mv([^a-z]|$)/ },
  { key: "Retail", text: /(^|[^a-z])retail/, column: /retail/ },
  { key: "LOG", text: /(^|[^a-z])log([^a-z]|$)/, column: /(^|[^a-z])log([^a-z]|$)/ },
  { key: "Pokladny", text: /(^|[^a-z])pokladn/, column: /pokladn/ }
];

// Oddělení zmíněná v textu v pořadí, v jakém jsou napsaná („Lego > Prodej > MV“).
export const departmentsInText = text => {
  const value = normalize(text);
  return PLAN_DEPARTMENTS
    .map(item => ({ key: item.key, index: value.search(item.text) }))
    .filter(item => item.index >= 0)
    .sort((a, b) => a.index - b.index)
    .map(item => item.key);
};

export const departmentsOfColumn = label => {
  const value = normalize(label);
  return PLAN_DEPARTMENTS.filter(item => item.column.test(value)).map(item => item.key);
};

const toMinutes = (hours, minutes = 0) => Number(hours) * 60 + Number(minutes || 0);
const validHour = minutes => minutes >= 6 * 60 && minutes <= 22 * 60;

const DATE_RE = /(?<![\d:])(\d{1,2})\s*\.\s*(\d{1,2})(?!\d)(?:\s*\.\s*(?:\d{4}|\d{2})(?!\d))?\.?/g;

// Data v řádku („1.11,7.11“, „3.11. 10-20“) pro daný měsíc.
export const datesInLine = (line, year, month) => {
  const found = [];
  const foreign = [];
  for (const match of String(line).matchAll(DATE_RE)) {
    const day = Number(match[1]);
    const mon = Number(match[2]);
    if (day < 1 || day > 31 || mon < 1 || mon > 12) continue;
    const date = new Date(year, mon - 1, day);
    if (date.getMonth() !== mon - 1) continue;
    const key = `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    (mon === month ? found : foreign).push(key);
  }
  return { dates: found, foreign, rest: String(line).replace(DATE_RE, " ") };
};

const CLOCK = "(\\d{1,2})(?::(\\d{2}))?";

// Časový údaj: „10-20“, „8:00–14:00“, „8-14 / 10-16“ (varianty),
// „10/11/12-20“ (začátek v 10, 11 nebo 12, konec ve 20), „od 10 do 20“,
// „celý den“, „jak vyjdou“. Vrací null, když v textu žádný čas není.
export const parseTimeSpec = text => {
  let value = normalize(text).replace(/\s+/g, " ");
  value = value.replace(new RegExp(`od ${CLOCK}\\s*(?:h|hod)?\\s*do ${CLOCK}`, "g"), (_, h1, m1, h2, m2) => `${h1}${m1 ? `:${m1}` : ""}-${h2}${m2 ? `:${m2}` : ""}`);
  const options = [];
  const rangeRe = new RegExp(`((?:\\d{1,2}(?::\\d{2})?\\s*\\/\\s*)*)${CLOCK}\\s*(?:h\\s*)?[-–—]\\s*${CLOCK}`, "g");
  for (const match of value.matchAll(rangeRe)) {
    const end = toMinutes(match[4], match[5]);
    const starts = [...match[1].matchAll(/(\d{1,2})(?::(\d{2}))?/g)].map(item => toMinutes(item[1], item[2]));
    starts.push(toMinutes(match[2], match[3]));
    starts.forEach(start => {
      if (validHour(start) && validHour(end) && end > start) options.push({ start, end });
    });
  }
  if (options.length) return { options, flexible: false };
  if (/cely den|celej den|kdykoli|jak vyjd|jak je potreba|podle potreby|jakkoli/.test(value)) {
    const from = value.match(new RegExp(`od ${CLOCK}`));
    const start = from ? toMinutes(from[1], from[2]) : DAY_START;
    return { options: [{ start: validHour(start) ? start : DAY_START, end: DAY_END }], flexible: true };
  }
  const from = value.match(new RegExp(`(?:^|[^a-z])od ${CLOCK}`));
  const to = value.match(new RegExp(`(?:^|[^a-z])do ${CLOCK}`));
  if (from || to) {
    const start = from ? toMinutes(from[1], from[2]) : DAY_START;
    const end = to ? toMinutes(to[1], to[2]) : DAY_END;
    if (validHour(start) && validHour(end) && end > start) return { options: [{ start, end }], flexible: true };
  }
  return null;
};

const NAME_WORD = "[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýžäöüß'-]+";
const NAME_LINE = new RegExp(`^${NAME_WORD}(?: ${NAME_WORD}){1,3}$`);
const NOT_NAME_START = /^(ahoj|ahojky|cau|dobry|dobrou|dekuji|dekuju|diky|prosim|prosimte|zdravim|preferuji|jen|klidne|hodiny|zacatek|lego|prodej|vydej|retail)\b/;
const looksLikeName = line => line.length <= 40 && NAME_LINE.test(line) && !NOT_NAME_START.test(normalize(line));

const NOISE_LINE = /^(upraveno\s+)?\d{1,2}:\d{2}$|^upraveno\b|^[\s\p{Extended_Pictographic}‍️]*$/u;
const HEADER_PATTERNS = [
  // WhatsApp Web / desktop při kopírování: [14:21, 28. 10. 2026] Jméno: text
  /^\[\d{1,2}:\d{2}(?::\d{2})?,\s*\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4}\]\s*([^:]{2,60}?):\s?(.*)$/,
  // Export chatu (iOS): [28.10.26 14:21:05] Jméno: text
  /^\[\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\]\s*([^:]{2,60}?):\s?(.*)$/,
  // Export chatu (Android): 28.10.26 14:21 - Jméno: text
  /^\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4},?\s+\d{1,2}:\d{2}\s+-\s+([^:]{2,60}?):\s?(.*)$/
];

// Rozdělí vložený text na zprávy podle odesílatele. Pozná formát kopírování
// z WhatsApp Webu, export chatu i prostý text, kde je jméno na samostatném
// řádku nebo na začátku řádku („Eliška Kaštánková: …“).
export const splitMessages = (text, findWorker = () => null) => {
  const messages = [];
  let current = null;
  const start = (sender, firstLine) => {
    const worker = findWorker(sender);
    if (current && (worker ? current.worker === worker : current.sender === sender)) {
      if (firstLine) current.lines.push(firstLine);
      return;
    }
    current = { sender: worker?.full_name || worker?.name || sender, worker, lines: firstLine ? [firstLine] : [] };
    messages.push(current);
  };
  String(text || "").split(/\r?\n/).forEach(raw => {
    const line = raw.replace(/‎|‏/g, "").trim();
    if (!line) return;
    for (const pattern of HEADER_PATTERNS) {
      const match = line.match(pattern);
      if (match) { start(match[1].trim(), match[2].trim()); return; }
    }
    const colon = line.match(/^([^:\d]{3,60}?):\s*(.*)$/);
    if (colon && findWorker(colon[1].trim())) { start(colon[1].trim(), colon[2].trim()); return; }
    if (!/\d/.test(line) && line.length <= 60 && findWorker(line)) { start(line, ""); return; }
    // Jméno, které není v týmu (nový brigádník): 2–4 slova s velkým písmenem.
    if (looksLikeName(line)) { start(line, ""); return; }
    if (NOISE_LINE.test(line)) return;
    if (!current) { current = { sender: "", worker: null, lines: [] }; messages.push(current); }
    current.lines.push(line);
  });
  return messages.filter(message => message.lines.length);
};

// Žádosti z jedné zprávy: dny, časy, preference oddělení.
export const parseRequestMessage = (lines, year, month) => {
  let preferences = [];
  let general = null;
  const pending = [];
  const foreignDates = [];
  lines.forEach(line => {
    const { dates, foreign, rest } = datesInLine(line, year, month);
    foreignDates.push(...foreign);
    const lineDepartments = departmentsInText(rest);
    if (!dates.length) {
      if (lineDepartments.length && !preferences.length) preferences = lineDepartments;
      const spec = parseTimeSpec(rest);
      if (spec && !general) general = spec;
      return;
    }
    if (lineDepartments.length && /prefer|poradi|>/.test(normalize(rest)) && !preferences.length) preferences = lineDepartments;
    pending.push({ dates, spec: parseTimeSpec(rest), departments: /prefer|poradi|>/.test(normalize(rest)) ? [] : lineDepartments, text: line });
  });
  const requests = [];
  const seen = new Set();
  pending.forEach(item => {
    const spec = item.spec || general || { options: [{ start: DAY_START, end: DAY_END }], flexible: true, unspecified: true };
    item.dates.forEach(date => {
      if (seen.has(date)) return;
      seen.add(date);
      requests.push({
        date,
        options: spec.options,
        flexible: Boolean(spec.flexible),
        unspecified: Boolean(spec.unspecified || (!item.spec && !general)),
        departments: item.departments,
        text: item.text
      });
    });
  });
  requests.sort((a, b) => a.date.localeCompare(b.date));
  return { preferences, requests, foreignDates: [...new Set(foreignDates)] };
};

// Celý vložený text → žádosti po lidech.
export const parseShiftRequests = (text, { year, month, findWorker = () => null }) =>
  splitMessages(text, findWorker)
    .map(message => ({ sender: message.sender, worker: message.worker, ...parseRequestMessage(message.lines, year, month) }))
    .filter(item => item.requests.length || item.foreignDates.length);

const rangeLabel = (start, end) => `${start / 60}–${end / 60}`;

// Návrh obsazení. slots = volné hodinové sloty měsíce { date, start, end, column, department };
// busy = už obsazené hodiny lidí { personKey, date, start, end }; people = výstup parseShiftRequests
// doplněný o personKey a existingMinutes (už naplánováno v měsíci).
export const planAssignments = (people, slots, busy = [], { limitMinutes = MONTHLY_LIMIT_MINUTES, minBlock = MIN_BLOCK_MINUTES } = {}) => {
  const free = new Map();
  slots.forEach(slot => {
    for (let minute = slot.start; minute < slot.end; minute += 60) {
      const key = `${slot.date}|${minute}`;
      if (!free.has(key)) free.set(key, []);
      free.get(key).push({ ...slot, start: minute, end: minute + 60, taken: false });
    }
  });
  free.forEach(list => list.sort((a, b) => a.column - b.column));
  const busyHours = new Set();
  busy.forEach(item => { for (let minute = item.start; minute < item.end; minute += 60) busyHours.add(`${item.personKey}|${item.date}|${minute}`); });
  const totals = new Map(people.map(person => [person.personKey, Number(person.existingMinutes || 0)]));
  const assignments = [];
  const unmet = [];

  const rank = (slot, preferences) => {
    if (!preferences.length) return 0;
    const departments = departmentsOfColumn(slot.department);
    const index = Math.min(...departments.map(key => preferences.indexOf(key)).filter(value => value >= 0));
    return Number.isFinite(index) ? index : preferences.length + 1;
  };
  const pickSlot = (person, date, minute, previous, preferences) => {
    if (busyHours.has(`${person.personKey}|${date}|${minute}`)) return null;
    const candidates = (free.get(`${date}|${minute}`) || []).filter(slot => !slot.taken);
    if (!candidates.length) return null;
    return [...candidates].sort((a, b) =>
      Number(b.column === previous?.column) - Number(a.column === previous?.column)
      || rank(a, preferences) - rank(b, preferences)
      || a.column - b.column)[0];
  };
  // Nejdelší souvislý úsek v okně, kde má člověk v každé hodině volný slot.
  const bestRun = (person, date, start, end, preferences) => {
    let best = null;
    let run = [];
    const close = () => {
      if (run.length && (!best || run.length > best.length)) best = run;
      run = [];
    };
    for (let minute = start; minute < end; minute += 60) {
      const slot = pickSlot(person, date, minute, run[run.length - 1], preferences);
      if (slot) run.push(slot); else close();
    }
    close();
    return best || [];
  };

  const byDate = new Map();
  people.forEach(person => person.requests.forEach(request => {
    if (!byDate.has(request.date)) byDate.set(request.date, []);
    byDate.get(request.date).push({ person, request });
  }));
  [...byDate.keys()].sort().forEach(date => {
    const dayHasSlots = [...free.keys()].some(key => key.startsWith(`${date}|`));
    byDate.get(date)
      // Férově: přednost má ten, kdo má zatím v měsíci méně hodin.
      // Kdo má pevný čas, má méně možností – jde před těmi, kdo napsali „jak vyjde“.
      .sort((a, b) => Number(a.request.flexible) - Number(b.request.flexible)
        || totals.get(a.person.personKey) - totals.get(b.person.personKey) || a.person.order - b.person.order)
      .forEach(({ person, request }) => {
        const preferences = request.departments.length ? request.departments : person.preferences;
        const remaining = limitMinutes - totals.get(person.personKey);
        if (!dayHasSlots) { unmet.push({ person, request, reason: "Ten den nejsou vypsané volné sloty" }); return; }
        if (remaining < Math.min(minBlock, 60)) { unmet.push({ person, request, reason: "Vyčerpaný limit 85 h" }); return; }
        let chosen = null;
        request.options.forEach(option => {
          const run = bestRun(person, date, option.start, option.end, preferences);
          const exact = run.length * 60 === option.end - option.start;
          const score = run.length * 60 + (exact ? 30 : 0) - run.reduce((sum, slot) => sum + rank(slot, preferences), 0) / 100;
          if (run.length && (!chosen || score > chosen.score)) chosen = { run, option, exact, score };
        });
        if (!chosen || chosen.run.length * 60 < Math.min(minBlock, chosen.option.end - chosen.option.start)) {
          unmet.push({ person, request, reason: chosen ? "Volno jen na kratší úsek než 3 h" : "V požadovaném čase není volný slot" });
          return;
        }
        let run = chosen.run;
        let limited = false;
        if (run.length * 60 > remaining) {
          run = run.slice(0, Math.floor(remaining / 60));
          limited = true;
          if (run.length * 60 < minBlock) { unmet.push({ person, request, reason: "Překročil by limit 85 h" }); return; }
        }
        run.forEach(slot => { slot.taken = true; busyHours.add(`${person.personKey}|${date}|${slot.start}`); });
        const minutes = run.length * 60;
        totals.set(person.personKey, totals.get(person.personKey) + minutes);
        const segments = [];
        run.forEach(slot => {
          const last = segments[segments.length - 1];
          if (last && last.column === slot.column && last.end === slot.start) last.end = slot.end;
          else segments.push({ start: slot.start, end: slot.end, column: slot.column, department: slot.department });
        });
        const offPreference = preferences.length > 0 && run.some(slot => rank(slot, preferences) > 0);
        assignments.push({
          person, request, date,
          start: run[0].start, end: run[run.length - 1].end, minutes, segments,
          partial: !chosen.exact && !request.flexible, limited, offPreference,
          requested: request.options.map(option => rangeLabel(option.start, option.end)).join(" / ")
        });
      });
  });
  const freeLeft = [...free.values()].flat().filter(slot => !slot.taken)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start || a.column - b.column);
  return { assignments, unmet, totals, freeLeft };
};
