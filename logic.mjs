// Čistá logika bez závislosti na DOM, Supabase nebo knihovně XLSX.
// Vše tady je pokryté testy v tests/logic.test.mjs.

export const DEPARTMENTS = ["Výdej", "Prodej", "Lego", "Pokladny", "Upsell", "MV", "LOG", "PS"];
export const SALES_ASR_TARGET = 6500;

export const normalizeText = value => String(value ?? "")
  .replace(/[​-‍﻿]/g, "")
  .replace(/\s+/g, " ")
  .toLocaleLowerCase("cs")
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
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

export const isLikelyWorkerName = value => {
  const name = String(value || "").trim();
  return !isIgnoredShiftName(name) && /^[\p{L}][\p{L}'’-]+(?:\s+[\p{L}][\p{L}'’-]+)+$/u.test(name);
};

// Odstraní případný čas za jménem, např. „Novák Petr 14:30“.
export const stripTrailingTime = value => String(value || "").trim().replace(/\s+\d{1,2}:\d{2}\s*$/, "").trim();

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
  const source = String(text || "").replace(/^﻿/, "");
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
  return "﻿" + [headers, ...rows].map(row => row.map(escape).join(";")).join("\r\n");
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
  .replace(/[←-⇿▲-◿]/g, "")
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
