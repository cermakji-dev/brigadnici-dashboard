import test from "node:test";
import assert from "node:assert/strict";
import {
  addMonths, addRosterOnlyWorkers, automaticWorkerId, calculateAutomaticMetrics, calculateFreeShiftHours,
  excelCellDate, forEachShiftCell, formatShiftDepartment, incompleteOnboardingTasks, isIgnoredShiftName,
  isLikelyWorkerName, matchesSearch, median, normalizeText, parseCsv, parseHours, parseShiftSlot,
  periodFromSheetName, recentPeriods, salesMetrics, stripTrailingTime, summarizeSales, toCsv
} from "../logic.mjs";

test("normalizace zachová porovnatelnost českých jmen", () => assert.equal(normalizeText("  Čermák Jiří "), "cermak jiri"));
test("volná směna se nikdy nepovažuje za člověka", () => {
  assert.equal(isIgnoredShiftName("Volná směna"), true);
  assert.equal(isIgnoredShiftName("volná směna 2"), true);
  assert.equal(isLikelyWorkerName("Volná směna"), false);
  assert.equal(isLikelyWorkerName("Novák Petr"), true);
  assert.equal(isLikelyWorkerName("Prodej"), false);
});

test("automatické ID odpovídá formátu uloženému v databázi a je stabilní", () => {
  const id = automaticWorkerId("Novák Petr");
  assert.match(id, /^AUTO_NOVAK_PETR_[0-9A-Z]+$/);
  assert.equal(automaticWorkerId("novak-petr"), id);
  assert.notEqual(automaticWorkerId("Novák Pavel"), id);
});

test("čas za jménem se odstraní", () => assert.equal(stripTrailingTime("Novák Petr 14:30"), "Novák Petr"));

test("ASR a ARoS se počítají z denního reportu", () => assert.deepEqual(salesMetrics({ hours: 8, hardware: 100000, services: 10000 }), { asr: 13750, aros: 10 }));

test("souhrn prodejů počítá jen vyplněné reporty", () => {
  const summary = summarizeSales([
    { status: "reported", salesHours: 4, hardware: 20000, services: 6000 },
    { status: "reported", salesHours: 4, hardware: 10000, services: 0 },
    { status: "pending", plannedHours: 8 },
    { status: "not_sales" }
  ]);
  assert.equal(summary.hours, 8);
  assert.equal(summary.revenue, 36000);
  assert.equal(summary.asr, 4500);
  assert.equal(summary.aros, 20);
  assert.equal(Math.round(summary.targetPercent), 69);
  assert.equal(summarizeSales([]).aros, null);
});

test("onboarding úkoly jsou nezávislé", () => assert.deepEqual(incompleteOnboardingTasks({ training: true }), ["Zajistit podpis smluv", "Vyřešit daně"]));

test("ukazatele: schopnosti podle oddělení, docházka podle palců za docházku", () => {
  assert.deepEqual(calculateAutomaticMetrics([], ["Výdej", "Prodej", "Neznámé"]), { skills: 25, reliability: 100 });
  const feedback = [
    { type: "negative", category: "attendance" },
    { type: "negative", category: "attendance" },
    { type: "positive", category: "attendance" },
    { type: "negative", category: "general" }
  ];
  assert.equal(calculateAutomaticMetrics(feedback, []).reliability, 95);
  assert.equal(calculateAutomaticMetrics(Array(30).fill({ type: "negative", category: "attendance" })).reliability, 0);
});

test("hodiny se čtou z čísel i českých zápisů", () => {
  assert.equal(parseHours(12.5), 12.5);
  assert.equal(parseHours("12,5"), 12.5);
  assert.equal(parseHours("1 234,5 h"), 1234.5);
  assert.equal(parseHours(""), 0);
  assert.equal(parseHours(null), 0);
});

test("CSV: středník, uvozovky, BOM a prázdné řádky", () => {
  const rows = parseCsv('﻿Jméno;Hodiny\r\n"Novák; Petr";"12,5"\r\n\r\nDvořák Jan;8\n');
  assert.deepEqual(rows, [{ Jméno: "Novák; Petr", Hodiny: "12,5" }, { Jméno: "Dvořák Jan", Hodiny: "8" }]);
  assert.deepEqual(parseCsv("Jméno,Hodiny\nNovák Petr,4"), [{ Jméno: "Novák Petr", Hodiny: "4" }]);
  assert.deepEqual(parseCsv("Jen hlavička"), []);
});

test("export CSV je bezpečný pro Excel", () => {
  const csv = toCsv(["Jméno", "Poznámka", "Hodiny"], [["Novák Petr", '=HYPERLINK("x")', -5], ["A;B", 'řekl "ahoj"', 1.5]]);
  assert.ok(csv.startsWith("﻿Jméno;Poznámka;Hodiny\r\n"));
  assert.ok(csv.includes(`Novák Petr;"'=HYPERLINK(""x"")";-5`));
  assert.ok(csv.includes('"A;B";"řekl ""ahoj""";1,5'));
});

test("název měsíčního listu se převede na období", () => {
  assert.equal(periodFromSheetName("Říjen26"), "2026-10-01");
  assert.equal(periodFromSheetName("červenec 2026"), "2026-07-01");
  assert.equal(periodFromSheetName("Červen26"), "2026-06-01");
  assert.equal(periodFromSheetName("Souhrn"), null);
});

test("směna: čas, délka a název oddělení", () => {
  assert.deepEqual(parseShiftSlot("9-13"), { startMinutes: 540, endMinutes: 780, start: "9:00", end: "13:00", hours: 4 });
  assert.equal(parseShiftSlot("14:30 - 15h").hours, 0.5);
  assert.equal(parseShiftSlot("Celkem hodin"), null);
  assert.equal(formatShiftDepartment("↓ prodej / výdej ↓"), "Prodej / Výdej");
});

test("datum z Excelu: číslo, text i Date", () => {
  assert.deepEqual(excelCellDate(["", 46323]), new Date(2026, 9, 28));
  assert.deepEqual(excelCellDate(["28.10.26"]), new Date(2026, 9, 28));
  assert.equal(excelCellDate(["Pondělí"]), null);
});

const rosterMatrix = [
  ["Pondělí", 46323],
  ["Určení:", "↓ Prodej ↓", "Výdej", "", "", "", ""],
  ["9-13", "Novák Petr", "Volná směna", "", "", "", ""],
  ["13-17", "Novák Petr 13:30", "Dvořák Jan\nSvoboda Eva", "", "", "", ""],
  ["Celkem hodin", 16],
  ["Úterý", 46324],
  ["Určení", "Prodej", "Výdej"],
  ["9-10", "Dvořák Jan", ""],
  ["celkem hod.", 1]
];

test("rozpis směn se projde po dnech, oddělení a buňkách", () => {
  const cells = [];
  forEachShiftCell(rosterMatrix, cell => cells.push(cell));
  assert.equal(cells.length, 5);
  assert.deepEqual(cells[0].date, new Date(2026, 9, 28));
  assert.equal(cells[0].assignment, "↓ Prodej ↓");
  assert.equal(cells[1].text, "Volná směna");
  assert.equal(cells[3].slot.hours, 4);
  assert.deepEqual(cells[4].date, new Date(2026, 9, 29));
});

test("volné hodiny se počítají podle délky slotu", () => assert.equal(calculateFreeShiftHours(rosterMatrix), 4));

test("medián u sudého i lichého počtu", () => {
  assert.equal(median([4, 1, 3]), 3);
  assert.equal(median([1, 2, 3, 10]), 2.5);
  assert.equal(median([]), 0);
});

test("posun o měsíce nepřeteče do dalšího měsíce", () => {
  assert.deepEqual(addMonths(new Date(2026, 2, 31), -1), new Date(2026, 1, 28));
  assert.deepEqual(addMonths(new Date(2026, 9, 28), -12), new Date(2025, 9, 28));
});

test("posledních N období končí aktuálním měsícem", () => {
  assert.deepEqual(recentPeriods(new Date(2026, 1, 15), 3), ["2025-12-01", "2026-01-01", "2026-02-01"]);
});

test("hledání podle jména, e-mailu, ID i přezdívky bez diakritiky", () => {
  const person = { name: "Čermák Jiří", email: "jiri@firma.cz", userId: "USER123", aliases: ["Jirka Č."] };
  assert.equal(matchesSearch(person, "cermak"), true);
  assert.equal(matchesSearch(person, "jiri@"), true);
  assert.equal(matchesSearch(person, "user1"), true);
  assert.equal(matchesSearch(person, "jirka"), true);
  assert.equal(matchesSearch(person, "novák"), false);
  assert.equal(matchesSearch(person, ""), true);
});

test("brigádníci z rozpisu se objeví s nulovými hodinami, i když chybí v měsíčním souhrnu", () => {
  const totals = new Map([["worker-1", { id: "worker-1", name: "Novák Petr", hours: 12 }]]);
  const roster = new Map([
    ["Novák Petr", { id: "worker-1", name: "Novák Petr", email: "petr@example.com" }],
    ["Dvořák Jan", { id: "worker-2", name: "Dvořák Jan", email: "" }]
  ]);

  addRosterOnlyWorkers(totals, ["Novák Petr", "Dvořák Jan", "Neznámé jméno"], name => roster.get(name));

  assert.equal(totals.size, 2);
  assert.equal(totals.get("worker-1").hours, 12);
  assert.deepEqual(totals.get("worker-2"), {
    id: "worker-2",
    name: "Dvořák Jan",
    hours: 0,
    email: "",
    photo: ""
  });
});
