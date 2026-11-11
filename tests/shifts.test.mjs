import test from "node:test";
import assert from "node:assert/strict";
import {
  assignLanes, timelineRange, buildShiftRows, buildWorkerLookup, departmentsForLabel, mergeShiftBlocks, resolveShiftCell,
  salesExpectationsFromShifts, suggestReplacements, summarizeShifts
} from "../logic.mjs";

const workers = [
  { id: "w1", external_user_id: "USER1", full_name: "Novák Petr", aliases: [] },
  { id: "w2", external_user_id: "USER2", full_name: "Dvořák Jan", aliases: ["Honza Dvořák"] },
  { id: "w3", external_user_id: "AUTO_SVOBODA_EVA_X", full_name: "Svoboda Eva", aliases: [] },
  { id: "w3b", external_user_id: "USER3", full_name: "Svoboda Eva", aliases: [] }
];
const lookup = buildWorkerLookup(workers);

test("vyhledání jména dává přednost ručně založené kartě před AUTO_", () => {
  assert.equal(lookup("svoboda eva").id, "w3b");
  assert.equal(lookup("Honza Dvořák").id, "w2");
  assert.equal(lookup("Neznámý Člověk"), null);
});

test("buňka s více jmény, časem příchodu i volnou směnou", () => {
  assert.deepEqual(resolveShiftCell("Novák Petr 13:30", lookup).map(item => item.worker.id), ["w1"]);
  const many = resolveShiftCell("Dvořák Jan\nSvoboda Eva, Neznámý Člověk", lookup);
  assert.deepEqual(many.map(item => [item.name, item.worker?.id ?? null]), [["Dvořák Jan", "w2"], ["Svoboda Eva", "w3b"], ["Neznámý Člověk", null]]);
  assert.deepEqual(resolveShiftCell("Volná směna", lookup), [{ name: "Volná směna", worker: null, free: true }]);
  assert.deepEqual(resolveShiftCell("  ", lookup), []);
});

const matrix = [
  ["Středa", 46331],
  ["Určení:", "↓ Prodej ↓", "Výdej / prodej"],
  ["9-10", "Novák Petr", "Volná směna"],
  ["10-11", "Novák Petr", "Volná směna"],
  ["11-13", "Dvořák Jan\nSvoboda Eva", ""],
  ["Celkem hodin", 0],
  ["Čtvrtek", 46332],
  ["Určení", "Prodej", "Výdej"],
  ["9-13", "Dvořák Jan", "Novák Petr"],
  ["celkem hod.", 0]
];

test("rozpis se převede na řádky směn jen v zadaném rozmezí", () => {
  const all = buildShiftRows(matrix, { from: new Date(2026, 10, 1), to: new Date(2026, 10, 30), lookup });
  assert.equal(all.length, 8);
  assert.deepEqual(all[0], { date: "2026-11-05", start: 540, end: 600, department: "Prodej", column: 0, name: "Novák Petr", workerId: "w1", free: false });
  assert.equal(all[1].free, true);
  assert.equal(all[1].department, "Výdej / Prodej");
  const onlyThursday = buildShiftRows(matrix, { from: new Date(2026, 10, 6), to: new Date(2026, 10, 6), lookup });
  assert.deepEqual(onlyThursday.map(row => row.workerId), ["w2", "w1"]);
});

const shifts = buildShiftRows(matrix, { from: new Date(2026, 10, 1), to: new Date(2026, 10, 30), lookup });

test("navazující sloty se sloučí do jednoho bloku", () => {
  const blocks = mergeShiftBlocks(shifts.filter(row => row.date === "2026-11-05"));
  const petr = blocks.find(block => block.workerId === "w1");
  assert.deepEqual([petr.start, petr.end, petr.hours], [540, 660, 2]);
  const free = blocks.filter(block => block.free);
  assert.equal(free.length, 1);
  assert.deepEqual([free[0].start, free[0].end], [540, 660]);
});

test("prodejní očekávání: i budoucí směny, jen prodej, skutečná délka slotu", () => {
  const expected = salesExpectationsFromShifts(shifts).filter(row => row.shift_date === "2026-11-05");
  assert.deepEqual(expected.sort((a, b) => a.worker_id.localeCompare(b.worker_id)), [
    { worker_id: "w1", shift_date: "2026-11-05", planned_hours: 2 },
    { worker_id: "w2", shift_date: "2026-11-05", planned_hours: 2 },
    { worker_id: "w3b", shift_date: "2026-11-05", planned_hours: 2 }
  ]);
  assert.ok(salesExpectationsFromShifts(shifts).every(row => row.planned_hours > 0));
});

test("souhrn: hodiny za 60 dní, další směna, volné hodiny a rozpis měsíce", () => {
  const summary = summarizeShifts(shifts, new Date(2026, 10, 5));
  assert.equal(summary.hours60.get("w1"), 2);
  assert.equal(summary.hours60.get("w2"), 2);
  assert.equal(summary.freeHours, 2);
  assert.deepEqual([...summary.rosterWorkerIds].sort(), ["w1", "w2", "w3b"]);
  const next = summary.nextShift.get("w1");
  assert.deepEqual([next.date, next.start, next.end], ["2026-11-05", 540, 660]);
  assert.equal(summary.nextShift.get("w2").date, "2026-11-05");
  const later = summarizeShifts(shifts, new Date(2026, 10, 6));
  assert.deepEqual([later.nextShift.get("w1").date, later.nextShift.get("w1").department], ["2026-11-06", "Výdej"]);
  assert.equal(later.nextShift.has("w3b"), false);
});

test("popisek oddělení se mapuje na zaškolení", () => {
  assert.deepEqual(departmentsForLabel("↓ prodej / výdej ↓"), ["Výdej", "Prodej"]);
  assert.deepEqual(departmentsForLabel("Pokladny + LOG"), ["Pokladny", "LOG"]);
  assert.deepEqual(departmentsForLabel("Psaní"), []);
});

test("návrh náhrady: zaškolení, volno v danou dobu, méně hodin první", () => {
  const people = [
    { remoteId: "w1", name: "Novák Petr", departments: ["Výdej"], hours: 10, reliability: 100 },
    { remoteId: "w2", name: "Dvořák Jan", departments: ["Výdej", "Prodej"], hours: 40, reliability: 100 },
    { remoteId: "w4", name: "Černá Eva", departments: ["Výdej"], hours: 5, reliability: 90 },
    { remoteId: "w5", name: "Bez Zaškolení", departments: ["Lego"], hours: 0, reliability: 100 }
  ];
  const free = { date: "2026-11-05", start: 540, end: 660, department: "Výdej / Prodej" };
  const day = shifts.filter(row => row.date === "2026-11-05");
  assert.deepEqual(suggestReplacements(free, people, day).map(person => person.remoteId), ["w2", "w4"]);
});

test("návrh náhrady dá přednost lidem, kteří v posledních 60 dnech pracovali", () => {
  const people = [
    { remoteId: "a", name: "Nechodí Vůbec", departments: ["Prodej"], hours: 0, hours60: 0, reliability: 100 },
    { remoteId: "b", name: "Chodí Hodně", departments: ["Prodej"], hours: 40, hours60: 80, reliability: 100 },
    { remoteId: "c", name: "Chodí Málo", departments: ["Prodej"], hours: 4, hours60: 20, reliability: 100 }
  ];
  const free = { date: "2026-11-11", start: 720, end: 840, department: "Prodej" };
  assert.deepEqual(suggestReplacements(free, people, []).map(person => person.remoteId), ["c", "b", "a"]);
});

test("překrývající se bloky dostanou vlastní pruh, navazující sdílí", () => {
  const { blocks, lanes } = assignLanes([
    { start: 480, end: 600 }, { start: 600, end: 900 }, { start: 540, end: 720 }, { start: 720, end: 1200 }
  ]);
  assert.equal(lanes, 2);
  assert.deepEqual(blocks.map(block => [block.start, block.lane]), [[480, 0], [540, 1], [600, 0], [720, 1]]);
  assert.equal(assignLanes([]).lanes, 1);
});

test("rozsah osy je aspoň 8–20 a zaokrouhlí se na hodiny", () => {
  assert.deepEqual(timelineRange([]), [480, 1200]);
  assert.deepEqual(timelineRange([{ start: 450, end: 1230 }]), [420, 1260]);
});

test("jméno v obráceném pořadí se spáruje se stejným brigádníkem", async () => {
  const { buildWorkerLookup } = await import("../logic.mjs");
  const lookup = buildWorkerLookup([{ id: "a", full_name: "Kolebač Ondřej", external_user_id: "AUTO_X" }, { id: "b", full_name: "Hrubantová Veronika", external_user_id: "U1" }]);
  assert.equal(lookup("Ondřej Kolebač")?.id, "a");
  assert.equal(lookup("Veronika Hrubantová")?.id, "b");
  assert.equal(lookup("Hrubantová Veronika")?.id, "b");
  assert.equal(lookup("Veronika Nováková"), null);
});

test("hodiny za měsíc se počítají z rozpisu pro každého, i se jménem obráceně", async () => {
  const { monthlyRosterHours, buildWorkerLookup } = await import("../logic.mjs");
  const lookup = buildWorkerLookup([{ id: "k", full_name: "Kolebač Ondřej" }, { id: "l", full_name: "Lískovcová Lucie" }]);
  const matrix = [
    ["", 46327],
    ["Určení:", "Výdej", "Prodej"],
    ["8-9 h", "Ondřej Kolebač", "Lískovcová Lucie"],
    ["9-10 h", "Kolebač Ondřej", "VOLNÁ SMĚNA"],
    ["Celkem hod.:", 4],
    ["", 46357],
    ["Určení:", "Výdej"],
    ["8-9 h", "Kolebač Ondřej"],
    ["Celkem hod.:", 1]
  ];
  const result = monthlyRosterHours(matrix, "2026-11-01", lookup);
  assert.equal(result.hours.get("k"), 2);
  assert.equal(result.hours.get("l"), 1);
  assert.equal(result.free, 1);
  assert.equal(result.planned, 4);
});
