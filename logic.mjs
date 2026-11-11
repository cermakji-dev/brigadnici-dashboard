// Čistá logika bez závislosti na DOM, Supabase nebo knihovně XLSX.
// Vše tady je pokryté testy v tests/logic.test.mjs.

export const DEPARTMENTS = ["Výdej", "Prodej", "Lego", "Pokladny", "Upsell", "MV", "LOG", "PS"];
export const SALES_ASR_TARGET = 6500;

export const normalizeText = value => String(value ?? "")
  .replace(/[\u200B-\u200D\uFEFF]/g, "")
  .replace(/\s+/g, " ")
  .toLocaleLowerCase("cs")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim();

export const slugFromName = value => normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const addRosterOnlyWorkers = (totals, rosterNames, findWorker) => {
  rosterNames.forEach(rosterName => {
    const worker = findWorker(rosterName);
    if (!worker || totals.has(worker.id)) return;
    totals.set(worker.id, {
      id: worker.id,
      name: worker.name,
      hours: 0,
      email: worker.email,
      photo: ""
    });
  });
};

export const isIgnoredShiftName = value => {
  const name = normalizeText(value);
  return !name || name === "volna smena" || name.startsWith("volna smena ");
};

// Stabilní ID pro automaticky založené karty. Formát se nesmí měnit,
// protože podle něj se v databázi rozpoznávají již existující AUTO_ záznamy.
export const automaticWorkerId = name => {
  const key = slugFromName(name);
  let hash = 2166136261;
  for (const character of key) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `AUTO_${key.toUpperCase().replace(/-/g, "_")}_${(hash >>> 0).toString(36).toUpperCase()}`;
};

// Poznámky v rozpisu psané velkými písmeny („STÁTNÍ SVÁTEK“, „NEPRODEJNÍ
// STÁTNÍ SVÁTEK“, „LOG“) nejsou jména lidí.
const NON_PERSON_WORDS = /\b(svatek|zavreno|inventura|skoleni|porada|volno|neprodejni)\b/;
export const isLikelyWorkerName = value => {
  const name = String(value || "").trim();
  if (isIgnoredShiftName(name)) return false;
  if (name === name.toLocaleUpperCase("cs") && /\p{Lu}{2}/u.test(name)) return false;
  if (NON_PERSON_WORDS.test(normalizeText(name))) return false;
  return /^[\p{L}][\p{L}'’-]+(?:\s+[\p{L}][\p{L}'’-]+)+$/u.test(name);
};

// Odstraní případný čas příchodu za jménem: „Novák Petr 14:30“,
// „Novák Petr (19:30)“, „Novák Petr od 9.30h“.
export const stripTrailingTime = value => String(value || "").trim()
  .replace(/\s*(?:\(\s*)?(?:od\s+)?\d{1,2}[:.]\d{2}\s*h?\s*\)?\s*$/i, "")
  .trim();

export const salesMetrics = ({ hours = 0, hardware = 0, services = 0 } = {}) => ({
  asr: Number(hours) > 0 ? (Number(hardware) + Number(services)) / Number(hours) : 0,
  aros: Number(hardware) > 0 ? Number(services) / Number(hardware) * 100 : 0
});

// Souhrn za více prodejních dní; započítává pouze vyplněné reporty.
export const summarizeSales = days => {
  const reported = days.filter(day => day.status === "reported");
  const hours = reported.reduce((sum, day) => sum + Number(day.salesHours || 0), 0);
  const hardware = reported.reduce((sum, day) => sum + Number(day.hardware || 0), 0);
  const services = reported.reduce((sum, day) => sum + Number(day.services || 0), 0);
  const revenue = hardware + services;
  const asr = hours ? revenue / hours : 0;
  return {
    hours,
    hardware,
    services,
    revenue,
    asr,
    aros: hardware > 0 ? services / hardware * 100 : null,
    targetPercent: asr / SALES_ASR_TARGET * 100
  };
};

export const incompleteOnboardingTasks = onboarding => {
  const value = onboarding || {};
  return [
    ["training", "Splnit úvodní školení"],
    ["contracts", "Zajistit podpis smluv"],
    ["taxes", "Vyřešit daně"]
  ].filter(([key]) => !value[key]).map(([, label]) => label);
};

export const clampMetric = value => Math.min(100, Math.max(0, Number(value) || 0));

export const calculateAutomaticMetrics = (feedback = [], departments = []) => {
  const attendanceNet = (feedback || []).reduce((total, item) => {
    if ((item.category || "general") !== "attendance") return total;
    return total + (item.type === "positive" ? 1 : -1);
  }, 0);
  const trainedDepartments = new Set((departments || []).filter(department => DEPARTMENTS.includes(department))).size;
  return {
    skills: Math.round((trainedDepartments / DEPARTMENTS.length) * 100),
    reliability: clampMetric(100 + attendanceNet * 5)
  };
};

export const parseHours = value => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? "").replace(/\s/g, "").replace(",", ".").replace(/[^0-9.-]/g, "");
  const number = Number(normalized || 0);
  return Number.isFinite(number) ? number : 0;
};

export const parseCsv = text => {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] || "";
  const delimiter = firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";
  const records = [];
  let row = [], value = "", quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { value += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(value); value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(value); value = "";
      if (row.some(cell => cell.trim())) records.push(row);
      row = [];
    } else value += char;
  }
  if (value || row.length) {
    row.push(value);
    if (row.some(cell => cell.trim())) records.push(row);
  }
  if (records.length < 2) return [];
  const headers = records[0].map(header => header.trim());
  return records.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() || ""])));
};

// Bezpečný CSV výstup pro český Excel: středník, BOM a ochrana proti vzorcům.
export const toCsv = (headers, rows) => {
  const escape = value => {
    // Číslo s desetinnou čárkou, aby ho český Excel rozpoznal jako číslo.
    if (typeof value === "number") return Number.isFinite(value) ? String(value).replace(".", ",") : "";
    let text = value === null || value === undefined ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(?:[.,]\d+)?$/.test(text)) text = `'${text}`;
    return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return "\uFEFF" + [headers, ...rows].map(row => row.map(escape).join(";")).join("\r\n");
};

export const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const firstDayOfMonth = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
export const startOfDay = date => new Date(date.getFullYear(), date.getMonth(), date.getDate());

export const addMonths = (date, months) => {
  const result = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(date.getDate(), lastDay));
  return result;
};

const MONTH_NAMES = ["leden", "unor", "brezen", "duben", "kveten", "cerven", "cervenec", "srpen", "zari", "rijen", "listopad", "prosinec"];

export const periodFromSheetName = sheetName => {
  const match = normalizeText(sheetName).replace(/\s+/g, "").match(/^(leden|unor|brezen|duben|kveten|cervenec|cerven|srpen|zari|rijen|listopad|prosinec)(\d{2}|\d{4})$/);
  if (!match) return null;
  const year = match[2].length === 2 ? 2000 + Number(match[2]) : Number(match[2]);
  return `${year}-${String(MONTH_NAMES.indexOf(match[1]) + 1).padStart(2, "0")}-01`;
};

export const parseShiftSlot = value => {
  const match = String(value ?? "").trim().match(/^(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*h?$/i);
  if (!match) return null;
  const startMinutes = Number(match[1]) * 60 + Number(match[2] || 0);
  const endMinutes = Number(match[3]) * 60 + Number(match[4] || 0);
  const clock = minutes => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
  return {
    startMinutes,
    endMinutes,
    start: clock(startMinutes),
    end: clock(endMinutes),
    hours: Math.max(0, endMinutes - startMinutes) / 60
  };
};

export const formatShiftDepartment = value => String(value || "")
  .replace(/[\u2190-\u21ff\u25b2-\u25ff]/g, "")
  .replace(/\s+/g, " ")
  .trim()
  .replace(/(^|\s)\S/g, letter => letter.toUpperCase());

// Excel ukládá datum jako počet dní od 30. 12. 1899.
export const excelSerialToDate = serial => {
  const whole = Math.floor(Number(serial));
  const utc = new Date(Date.UTC(1899, 11, 30) + whole * 86400000);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
};

export const excelCellDate = cells => {
  for (const value of cells || []) {
    if (value instanceof Date && !Number.isNaN(value.valueOf())) return startOfDay(value);
    if (typeof value === "number" && value > 30000 && value < 70000) return excelSerialToDate(value);
    if (typeof value === "string" && /^\d{1,2}[./]\d{1,2}[./]\d{2,4}$/.test(value.trim())) {
      const [day, month, rawYear] = value.trim().split(/[./]/).map(Number);
      const year = rawYear < 100 ? 2000 + rawYear : rawYear;
      return new Date(year, month - 1, day);
    }
  }
  return null;
};

// Projde denní bloky rozpisu směn v jednom listu.
// Blok začíná řádkem s datem, za ním následuje řádek „Určení:“ s názvy
// oddělení ve sloupcích B–G a pak řádky se směnami („9-10“, „14:30-15h“…)
// až po řádek „Celkem hod…“. Pro každou buňku se jménem zavolá onCell.
export const forEachShiftCell = (matrix, onCell) => {
  for (let rowIndex = 0; rowIndex < matrix.length - 1; rowIndex += 1) {
    if (normalizeText(matrix[rowIndex + 1]?.[0]).replace(/:$/, "") !== "urceni") continue;
    const date = excelCellDate((matrix[rowIndex] || []).slice(0, 8));
    const assignments = (matrix[rowIndex + 1] || []).slice(1, 7);
    for (let shiftRow = rowIndex + 2; shiftRow < matrix.length; shiftRow += 1) {
      const row = matrix[shiftRow] || [];
      if (row.some(cell => normalizeText(cell).startsWith("celkem hod"))) break;
      const slot = parseShiftSlot(row[0]);
      if (!slot) continue;
      row.slice(1, 7).forEach((cell, column) => {
        const text = String(cell ?? "").trim();
        if (!text) return;
        onCell({ date, slot, text, column, assignment: String(assignments[column] ?? "") });
      });
    }
  }
};

export const calculateFreeShiftHours = matrix => {
  let freeHours = 0;
  forEachShiftCell(matrix, ({ slot, text }) => {
    if (normalizeText(text).includes("volna smena")) freeHours += slot.hours;
  });
  return Math.round(freeHours * 100) / 100;
};

export const median = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

// Posledních N měsíců (včetně aktuálního) jako klíče období „RRRR-MM-01“, od nejstaršího.
export const recentPeriods = (today, count) => Array.from({ length: count }, (_, index) =>
  firstDayOfMonth(new Date(today.getFullYear(), today.getMonth() - (count - 1 - index), 1)));

export const matchesSearch = (person, query) => {
  const needle = normalizeText(query);
  if (!needle) return true;
  return [person.name, person.email, person.userId, ...(person.aliases || [])]
    .some(value => normalizeText(value).includes(needle));
};

// ---------------------------------------------------------------------------
// Rozpis směn uložený v databázi (tabulka shifts). Stejné funkce používá
// serverová synchronizace (supabase/functions/sync-google-sheets) i aplikace.
// Řádek směny: { date: "RRRR-MM-DD", start, end (minuty od půlnoci),
//                department, column, name, workerId | null, free }
// ---------------------------------------------------------------------------

export const parseDateKey = key => {
  const [year, month, day] = String(key).slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
};

export const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

export const formatClock = minutes => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

// Rozdělí obsah buňky na jednotlivé lidi. lookup(jméno) vrací brigádníka nebo null.
// Celá buňka se zkouší jako jedno jméno dřív než rozdělení, protože jména
// s čárkou nebo více řádky se v tabulce nevyskytují, kdežto „Novák Petr 13:30“ ano.
export const resolveShiftCell = (text, lookup) => {
  const value = String(text ?? "").trim();
  if (!value) return [];
  if (normalizeText(value).includes("volna smena")) return [{ name: "Volná směna", worker: null, free: true }];
  const whole = lookup(value) || lookup(stripTrailingTime(value));
  if (whole) return [{ name: stripTrailingTime(value), worker: whole, free: false }];
  const found = new Map();
  value.split(/[\n,;]+/).map(part => part.trim()).filter(Boolean).forEach(part => {
    const name = stripTrailingTime(part);
    if (!name) return;
    const worker = lookup(part) || lookup(name) || null;
    const key = worker ? `w:${worker.id}` : `n:${normalizeText(name)}`;
    if (!found.has(key)) found.set(key, { name, worker, free: false });
  });
  return [...found.values()];
};

// Převede matici listu na řádky směn v rozmezí dat (včetně krajních dní).
export const buildShiftRows = (matrix, { from, to, lookup }) => {
  const rows = [];
  forEachShiftCell(matrix, ({ date, slot, text, column, assignment }) => {
    if (!date || date < from || date > to) return;
    resolveShiftCell(text, lookup).forEach(entry => rows.push({
      date: dateKey(date),
      start: slot.startMinutes,
      end: slot.endMinutes,
      department: formatShiftDepartment(assignment),
      column,
      name: entry.name,
      workerId: entry.worker?.id ?? null,
      free: entry.free
    }));
  });
  return rows;
};

const shiftHours = shift => Math.max(0, shift.end - shift.start) / 60;
const roundHours = value => Math.round(value * 100) / 100;

// Prodejní report se zakládá rovnou pro všechny naplánované prodejní směny
// (i budoucí), aby byl připravený dopředu. „Chybí“ je až po skončení dne.
export const salesExpectationsFromShifts = shifts => {
  const totals = new Map();
  shifts.forEach(shift => {
    if (!shift.workerId || shift.free) return;
    if (!normalizeText(shift.department).includes("prodej")) return;
    const key = `${shift.workerId}|${shift.date}`;
    const current = totals.get(key) || { worker_id: shift.workerId, shift_date: shift.date, planned_hours: 0 };
    current.planned_hours = roundHours(current.planned_hours + shiftHours(shift));
    totals.set(key, current);
  });
  return [...totals.values()];
};

// Sloučí navazující sloty stejného člověka na stejném oddělení v jeden blok
// (9-10, 10-11, 11-12 → 9:00–12:00). Volné směny se slučují podle sloupce.
export const mergeShiftBlocks = shifts => {
  const sorted = [...shifts].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  const blocks = [];
  const open = new Map();
  sorted.forEach(shift => {
    const who = shift.free ? `free:${shift.column}` : shift.workerId ? `w:${shift.workerId}` : `n:${normalizeText(shift.name)}`;
    const key = `${shift.date}|${normalizeText(shift.department)}|${who}`;
    const last = open.get(key);
    if (last && shift.start <= last.end) {
      last.end = Math.max(last.end, shift.end);
      last.hours = roundHours(last.hours + shiftHours(shift));
      return;
    }
    const block = { ...shift, hours: shiftHours(shift) };
    blocks.push(block);
    open.set(key, block);
  });
  return blocks;
};

// Odvozené hodnoty pro přehled týmu: hodiny za posledních 60 dní, nejbližší
// směna, volné hodiny a kdo je v rozpisu daného měsíce.
export const summarizeShifts = (shifts, today, { periodKey = firstDayOfMonth(today) } = {}) => {
  const todayKey = dateKey(today);
  const cutoffKey = dateKey(addDays(today, -59));
  const monthPrefix = periodKey.slice(0, 7);
  const hours60 = new Map();
  const rosterWorkerIds = new Set();
  let freeHours = 0;
  shifts.forEach(shift => {
    const inMonth = shift.date.startsWith(monthPrefix);
    if (shift.free) {
      if (inMonth) freeHours += shiftHours(shift);
      return;
    }
    if (!shift.workerId) return;
    if (inMonth) rosterWorkerIds.add(shift.workerId);
    if (shift.date >= cutoffKey && shift.date <= todayKey) hours60.set(shift.workerId, (hours60.get(shift.workerId) || 0) + shiftHours(shift));
  });
  const nextShift = new Map();
  mergeShiftBlocks(shifts.filter(shift => shift.workerId && !shift.free && shift.date >= todayKey))
    .forEach(block => { if (!nextShift.has(block.workerId)) nextShift.set(block.workerId, block); });
  hours60.forEach((value, key) => hours60.set(key, roundHours(value)));
  return { hours60, nextShift, freeHours: roundHours(freeHours), rosterWorkerIds };
};

// Na která oddělení ze seznamu DEPARTMENTS se vztahuje popisek ve rozpisu,
// např. „Prodej / Výdej“ → ["Výdej", "Prodej"].
export const departmentsForLabel = label => {
  const text = normalizeText(label);
  return DEPARTMENTS.filter(department => {
    const key = normalizeText(department);
    return key.length <= 3 ? new RegExp(`(^|[^a-z])${key}([^a-z]|$)`).test(text) : text.includes(key);
  });
};

// Návrh náhrady na volnou směnu: zaškolení na oddělení, ten den v tu dobu
// nepracují, aktivní v posledních 60 dnech, pak méně hodin v měsíci a lepší docházka.
export const suggestReplacements = (freeBlock, people, dayShifts, limit = 3) => {
  const needed = departmentsForLabel(freeBlock.department);
  const busy = new Set(dayShifts
    .filter(shift => shift.workerId && !shift.free && shift.date === freeBlock.date && shift.start < freeBlock.end && shift.end > freeBlock.start)
    .map(shift => shift.workerId));
  return people
    .filter(person => person.remoteId && !busy.has(person.remoteId))
    .map(person => ({ person, trained: needed.filter(department => (person.departments || []).includes(department)).length }))
    .filter(item => !needed.length || item.trained > 0)
    .map(item => ({ ...item, active: Number(item.person.hours60 || 0) > 0 || Number(item.person.hours || 0) > 0 }))
    // Přednost mají lidé, kteří v posledních 60 dnech opravdu pracovali;
    // kdo dlouho nechodí, by směnu nejspíš nevzal.
    .sort((a, b) => b.trained - a.trained
      || Number(b.active) - Number(a.active)
      || Number(a.person.hours || 0) - Number(b.person.hours || 0)
      || Number(b.person.reliability || 0) - Number(a.person.reliability || 0)
      || a.person.name.localeCompare(b.person.name, "cs"))
    .slice(0, limit)
    .map(item => item.person);
};

// Klíč nezávislý na pořadí slov: „Ondřej Kolebač“ = „Kolebač Ondřej“.
export const nameTokensKey = name => {
  const parts = slugFromName(name).split("-").filter(Boolean);
  return parts.length >= 2 ? [...parts].sort().join("-") : "";
};

// Výběr jména pro zápis do rozpisu: preferuje ručně založené karty před AUTO_.
// Přesná shoda má přednost; jinak se zkusí stejná jména v jiném pořadí.
export const buildWorkerLookup = workers => {
  const byName = new Map();
  const byTokens = new Map();
  [...workers]
    .sort((a, b) => Number(String(a.external_user_id || a.userId || "").startsWith("AUTO_")) - Number(String(b.external_user_id || b.userId || "").startsWith("AUTO_")))
    .forEach(worker => {
      [worker.full_name ?? worker.name, ...(worker.aliases || [])].forEach(name => {
        const key = slugFromName(name);
        if (key && !byName.has(key)) byName.set(key, worker);
        const tokens = nameTokensKey(name);
        if (tokens && !byTokens.has(tokens)) byTokens.set(tokens, worker);
      });
    });
  return name => byName.get(slugFromName(name)) || byTokens.get(nameTokensKey(name)) || null;
};

// Rozložení bloků v řádku časové osy: překrývající se bloky dostanou
// vlastní pruh (lane), navazující bloky sdílí pruh.
export const assignLanes = blocks => {
  const laneEnds = [];
  const placed = [...blocks].sort((a, b) => a.start - b.start || a.end - b.end).map(block => {
    let lane = laneEnds.findIndex(end => end <= block.start);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(block.end); }
    else laneEnds[lane] = block.end;
    return { ...block, lane };
  });
  return { blocks: placed, lanes: Math.max(1, laneEnds.length) };
};

// Rozsah osy v celých hodinách (výchozí 8–20, rozšíří se podle směn).
export const timelineRange = (blocks, fallback = [480, 1200]) => {
  if (!blocks.length) return fallback;
  const start = Math.min(fallback[0], ...blocks.map(block => block.start));
  const end = Math.max(fallback[1], ...blocks.map(block => block.end));
  return [Math.floor(start / 60) * 60, Math.ceil(end / 60) * 60];
};

// ---------------------------------------------------------------------------
// Prodejní výkon: souhrny po lidech a po týdnech.
// Den: { workerId, date, status, salesHours, hardware, services, plannedHours }
// ---------------------------------------------------------------------------

// Žebříček za vybrané dny: jen vyplněné reporty se počítají do výkonu,
// chybějící se jen sčítají.
// todayKey: budoucí naplánované dny se nepočítají do „chybí“ ani do počtu dní.
export const salesByPerson = (days, todayKey = null) => {
  const groups = new Map();
  days.forEach(day => {
    if (!day.workerId) return;
    if (!groups.has(day.workerId)) groups.set(day.workerId, []);
    groups.get(day.workerId).push(day);
  });
  return [...groups].map(([workerId, list]) => ({
    workerId,
    ...summarizeSales(list),
    days: list.filter(day => !todayKey || day.date <= todayKey).length,
    planned: todayKey ? list.filter(day => day.status === "pending" && day.date > todayKey).length : 0,
    reported: list.filter(day => day.status === "reported").length,
    missing: list.filter(day => day.status === "pending" && (!todayKey || day.date < todayKey)).length
  })).sort((a, b) => (b.reported > 0) - (a.reported > 0) || b.asr - a.asr || b.revenue - a.revenue);
};

// Pondělí týdne, do kterého datum („RRRR-MM-DD“) patří.
export const weekStartKey = key => {
  const [year, month, day] = String(key).slice(0, 10).split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return dateKey(date);
};

// Týmové ASR po týdnech (jen týdny s aspoň jedním vyplněným reportem), od nejstaršího.
export const salesByWeek = days => {
  const groups = new Map();
  days.filter(day => day.status === "reported").forEach(day => {
    const key = weekStartKey(day.date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(day);
  });
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([week, list]) => ({ week, ...summarizeSales(list), reports: list.length }));
};

// Hodiny za měsíc přímo z rozpisu měsíčního listu: každá buňka se jménem je
// jeden slot (obvykle hodina), počítá se skutečná délka slotu. Stejná metoda
// jako souhrn v tabulce, ale pro každého v rozpisu a bez ručního seznamu.
export const monthlyRosterHours = (matrix, periodKey, lookup) => {
  const prefix = String(periodKey).slice(0, 7);
  const hours = new Map();
  let free = 0;
  let unmatched = 0;
  forEachShiftCell(matrix, ({ date, slot, text }) => {
    if (!date || !dateKey(date).startsWith(prefix)) return;
    resolveShiftCell(text, lookup).forEach(entry => {
      if (entry.free) { free += slot.hours; return; }
      if (!entry.worker) { if (isLikelyWorkerName(entry.name)) unmatched += slot.hours; return; }
      hours.set(entry.worker.id, (hours.get(entry.worker.id) || 0) + slot.hours);
    });
  });
  hours.forEach((value, key) => hours.set(key, roundHours(value)));
  const occupied = roundHours([...hours.values()].reduce((sum, value) => sum + value, 0) + unmatched);
  return { hours, occupied, free: roundHours(free), planned: roundHours(occupied + free) };
};
