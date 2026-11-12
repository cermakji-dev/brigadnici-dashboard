import test from "node:test";
import assert from "node:assert/strict";
import { buildSheetGrid, buildXlsx, buildHtml, zipFiles } from "../export.mjs";

const day = (label, smena) => ({
  label, smena, columns: ["Výdej", "Prodej", "", "", "", ""], total: 13,
  rows: Array.from({ length: 12 }, (_, i) => ({ label: `${8 + i}-${9 + i} h`, count: 1, cells: [{ text: i ? "Novák Petr" : "VOLNÁ SMĚNA", type: i ? "taken" : "free" }] }))
});
const model = { days: [day("pondělí 7. prosince 2026", 1), day("úterý 8. prosince 2026", 2)], people: [{ name: "Novák Petr", hours: 90 }], stats: { free: 2, taken: 22, percent: 92, planned: 24, log: 0 } };

test("list má rozložení jako Google tabulka: 15 řádků na den, SMĚNA vpravo, souhrn v L–M", () => {
  const grid = buildSheetGrid(model);
  assert.equal(grid.rows[0][1].v, "pondělí 7. prosince 2026");
  assert.equal(grid.rows[0][9].v, "SMĚNA 1");
  assert.equal(grid.rows[0][9].s, "smena1");
  assert.equal(grid.rows[15][9].s, "smena2");
  assert.equal(grid.rows[1][1].v, "↓ Výdej ↓");
  assert.equal(grid.rows[2][1].s, "free");
  assert.equal(grid.rows[14][7].v, "Celkem hod.:");
  assert.equal(grid.rows[0][11].v, "Jméno");
  assert.equal(grid.rows[1][11].s, "sumOver");
  assert.ok(grid.merges.some(m => m.r1 === 0 && m.c1 === 9 && m.r2 === 13));
});

test("xlsx je platný ZIP se styly a HTML nese barvy", () => {
  const bytes = buildXlsx(model, "Prosinec26");
  assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4b);
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /FFFFE599/);
  assert.match(text, /textRotation="255"/);
  assert.match(text, /<mergeCell ref="J1:J14"\/>/);
  const html = buildHtml(model);
  assert.match(html, /rowspan="14"/);
  assert.match(html, /background:#FFFF00/);
  assert.equal(zipFiles([{ name: "a.txt", data: "x" }]).length > 0, true);
});
