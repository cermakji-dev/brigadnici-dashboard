import test from "node:test";
import assert from "node:assert/strict";
import { shiftNumber, draftFromHistory, applyRules, suggestRules, draftToTsv, daysFromShiftRows, dayTotals, cellKey, FREE_LABEL, describeRule } from "../roster.mjs";

test("SMĚNA 1/2 sedí s Google tabulkou", () => {
  const expected = {
    "2026-11-01": 2, "2026-11-02": 1, "2026-11-03": 1, "2026-11-04": 2, "2026-11-05": 2, "2026-11-06": 1, "2026-11-07": 1, "2026-11-08": 1,
    "2026-11-09": 2, "2026-11-10": 2, "2026-11-11": 1, "2026-11-13": 2, "2026-11-30": 1,
    "2026-10-01": 1, "2026-10-02": 2, "2026-10-05": 1, "2026-10-07": 2, "2026-10-31": 2,
    "2025-09-01": 2, "2025-09-03": 1, "2025-09-05": 2, "2025-09-08": 1, "2025-09-30": 2
  };
  Object.entries(expected).forEach(([date, value]) => assert.equal(shiftNumber(date), value, date));
});

const row = (date, column, department, start, end, name) => ({ date, column, department, start: start * 60, end: end * 60, name, free: /VOLN/.test(name) });

test("nový měsíc převezme sloupce ze stejného dne v týdnu a se stejnou SMĚNOU", () => {
  const history = daysFromShiftRows([
    row("2026-11-29", 1, "Výdej", 8, 20, "Novák"), row("2026-11-29", 2, "LEGO", 8, 20, "VOLNÁ SMĚNA"),
    row("2026-11-22", 1, "Výdej", 10, 20, "Dvořák")
  ]);
  // 13. 12. 2026 je neděle se SMĚNOU 2 – stejně jako 29. 11.
  assert.equal(shiftNumber("2026-12-13"), shiftNumber("2026-11-29"));
  const draft = draftFromHistory("2026-12", history);
  assert.equal(Object.keys(draft.days).length, 31);
  assert.deepEqual(draft.days["2026-12-13"].columns.slice(0, 2), ["Výdej", "LEGO"]);
  assert.equal(draft.days["2026-12-13"].cells[cellKey(1, 8 * 60)], FREE_LABEL);
});

test("pravidla vypíší volné směny a nezdvojí se", () => {
  const draft = draftFromHistory("2026-12", {}, { copyFree: false });
  const rules = [
    { days: "all", smena: 0, department: "Výdej", start: 600, end: 1200 },
    { days: [6], smena: 2, department: "LEGO", start: 480, end: 1200 }
  ];
  const first = applyRules(draft, rules);
  const second = applyRules(draft, rules);
  assert.ok(first > 0);
  assert.equal(second, 0);
  const sunday2 = draft.days["2026-12-13"];
  assert.ok(sunday2.columns.includes("LEGO"));
  const sunday1 = draft.days["2026-12-06"];
  assert.ok(!sunday1.columns.includes("LEGO"));
  assert.equal(dayTotals(draft.days["2026-12-01"]).total, 10);
  assert.match(describeRule(rules[1]), /neděli \(SMĚNA 2\) · LEGO 8–20/);
});

test("našeptávač najde opakující se úseky", () => {
  const rows = [];
  ["2026-11-01", "2026-11-15", "2026-11-29"].forEach(date => rows.push(row(date, 5, "LEGO", 8, 20, "X")));
  for (let d = 1; d <= 30; d++) rows.push(row(`2026-11-${String(d).padStart(2, "0")}`, 1, "Výdej", 10, 20, "Y"));
  const suggestions = suggestRules(daysFromShiftRows(rows));
  assert.ok(suggestions.some(item => item.rule.days === "all" && item.rule.department === "Výdej" && item.rule.start === 600));
  assert.ok(suggestions.some(item => Array.isArray(item.rule.days) && item.rule.days[0] === 6 && item.rule.smena === 2 && item.rule.department === "LEGO"));
});

test("export pro Google má rozložení jako list", () => {
  const draft = draftFromHistory("2026-12", {}, { copyFree: false });
  applyRules(draft, [{ days: "all", smena: 0, department: "Výdej", start: 600, end: 1200 }]);
  const lines = draftToTsv(draft).split("\n");
  assert.equal(lines.length, 31 * 15);
  assert.equal(lines[0].split("\t")[1], "1.12.2026");
  assert.equal(lines[0].split("\t")[9], `SMĚNA ${shiftNumber("2026-12-01")}`);
  assert.equal(lines[1].split("\t")[1], "↓ Výdej ↓");
  assert.equal(lines[4].split("\t")[1], "VOLNÁ SMĚNA");
  assert.deepEqual(lines[14].split("\t").slice(7), ["Celkem hod.:", "10"]);
});
