import test from "node:test";
import assert from "node:assert/strict";
import { parseShiftRequests, parseTimeSpec, departmentsInText, planAssignments, splitMessages } from "../planner.mjs";

const WORKERS = ["Eliška Kaštánková", "Kateřina Zvercová", "Vojtěch Žatecký", "Ondřej Hejda", "Oliver Jašek"].map(name => ({ full_name: name }));
const findWorker = name => WORKERS.find(worker => worker.full_name.toLowerCase() === String(name).trim().toLowerCase()) || null;

const CHAT = `Ahoj, směny na listopad máte vypsané. Pište si o ně. Díky.
14:21
Eliška Kaštánková
Bri(g)oška
Ahooj, prosim zapsat tyto smeny, dekujiii 😊 preferuji vydej
3.11. 10-20
11.11. 8-15
30.11. 10-20
Upraveno 14:21
👍
Kateřina Zvercová
Ahoj, ráda bych tyto směny prosím:
preferuji pořadí lego-prodej-výdej
Začátek směny podle potřeby, ve vypsané termíny mohu klidně už od 10:00

1.11. 10/11/12-20
7.11. 8-14
17.11. klidně celý den
Vojtěch Žatecký
Prosim 14.11.
15.11.
Hodiny jak vyjdou,
Dekuju
Ondřej Hejda
Ahoj můžu poprosit o 1.11,7.11,8.11,14.11 od 10:00 do 20:00 děkuji
Oliver Jašek
Lego > Prodej > MV > Výdej
9.11. 8-14 / 10-16`;

test("časy ze zpráv", () => {
  assert.deepEqual(parseTimeSpec("10-20").options, [{ start: 600, end: 1200 }]);
  assert.deepEqual(parseTimeSpec("10/11/12-20").options.map(o => o.start), [600, 660, 720]);
  assert.deepEqual(parseTimeSpec("8-14 / 10-16").options, [{ start: 480, end: 840 }, { start: 600, end: 960 }]);
  assert.deepEqual(parseTimeSpec("od 10:00 do 20:00").options, [{ start: 600, end: 1200 }]);
  assert.equal(parseTimeSpec("klidně celý den").flexible, true);
  assert.equal(parseTimeSpec("děkuji"), null);
});

test("pořadí oddělení", () => {
  assert.deepEqual(departmentsInText("preferuji pořadí lego-prodej-výdej"), ["LEGO", "Prodej", "Výdej"]);
  assert.deepEqual(departmentsInText("Lego > Prodej > MV > Výdej"), ["LEGO", "Prodej", "MV", "Výdej"]);
});

test("zprávy z WhatsAppu se rozdělí podle lidí a přečtou se dny i časy", () => {
  const people = parseShiftRequests(CHAT, { year: 2026, month: 11, findWorker });
  const by = name => people.find(item => item.sender === name);
  assert.equal(people.length, 5);
  assert.deepEqual(by("Eliška Kaštánková").preferences, ["Výdej"]);
  assert.deepEqual(by("Eliška Kaštánková").requests.map(r => r.date), ["2026-11-03", "2026-11-11", "2026-11-30"]);
  assert.deepEqual(by("Eliška Kaštánková").requests[1].options, [{ start: 480, end: 900 }]);
  assert.deepEqual(by("Kateřina Zvercová").preferences, ["LEGO", "Prodej", "Výdej"]);
  assert.equal(by("Kateřina Zvercová").requests.find(r => r.date === "2026-11-17").flexible, true);
  assert.deepEqual(by("Vojtěch Žatecký").requests.map(r => r.date), ["2026-11-14", "2026-11-15"]);
  assert.equal(by("Vojtěch Žatecký").requests[0].flexible, true);
  assert.equal(by("Ondřej Hejda").requests.length, 4);
  assert.deepEqual(by("Ondřej Hejda").requests[0].options, [{ start: 600, end: 1200 }]);
  assert.equal(by("Oliver Jašek").requests[0].options.length, 2);
});

test("formát kopírování z WhatsApp Webu", () => {
  const text = "[14:21, 28. 10. 2026] Ondřej Hejda: 1.11 10-20\n[14:22, 28. 10. 2026] Ondřej Hejda: 2.11 8-12";
  const messages = splitMessages(text, findWorker);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].lines.length, 2);
});

const slot = (date, start, end, column, department) => ({ date, start: start * 60, end: end * 60, column, department });

test("návrh: preferované oddělení, férovost a limit 85 h", () => {
  const slots = [slot("2026-11-01", 8, 20, 1, "Výdej"), slot("2026-11-01", 10, 20, 2, "LEGO")];
  const people = [
    { personKey: "a", order: 0, existingMinutes: 80 * 60, preferences: [], requests: [{ date: "2026-11-01", options: [{ start: 600, end: 1200 }], flexible: false, departments: [] }] },
    { personKey: "b", order: 1, existingMinutes: 0, preferences: ["LEGO"], requests: [{ date: "2026-11-01", options: [{ start: 600, end: 1200 }], flexible: false, departments: [] }] }
  ];
  const plan = planAssignments(people, slots);
  const b = plan.assignments.find(item => item.person.personKey === "b");
  assert.equal(b.segments[0].department, "LEGO");
  assert.equal(b.minutes, 600);
  const a = plan.assignments.find(item => item.person.personKey === "a");
  assert.equal(a.minutes, 300); // jen do limitu 85 h
  assert.equal(a.limited, true);
});

test("návrh: obsazený slot a chybějící volno", () => {
  const slots = [slot("2026-11-02", 8, 12, 1, "Výdej")];
  const people = [{ personKey: "a", order: 0, existingMinutes: 0, preferences: [], requests: [
    { date: "2026-11-02", options: [{ start: 600, end: 1200 }], flexible: false, departments: [] },
    { date: "2026-11-03", options: [{ start: 600, end: 1200 }], flexible: false, departments: [] }
  ] }];
  const plan = planAssignments(people, slots);
  assert.equal(plan.assignments.length, 0);
  assert.equal(plan.unmet.length, 2);
  assert.match(plan.unmet.find(u => u.request.date === "2026-11-03").reason, /nejsou vypsané/);
});

test("odesílatel, který není v týmu, začne novou zprávu", () => {
  const text = "Vojtěch Žatecký\nProsim 14.11.\nHodiny jak vyjdou,\nKarel Neznámý\nAhoj, můžu 1.11 od 10 do 20";
  const people = parseShiftRequests(text, { year: 2026, month: 11, findWorker });
  assert.deepEqual(people.map(p => p.sender), ["Vojtěch Žatecký", "Karel Neznámý"]);
  assert.equal(people[1].worker, null);
  assert.deepEqual(people[1].requests[0].options, [{ start: 600, end: 1200 }]);
});

test("pevný čas má přednost před „jak vyjde“", () => {
  const slots = [slot("2026-11-05", 8, 20, 1, "Výdej")];
  const people = [
    { personKey: "flex", order: 0, existingMinutes: 0, preferences: [], requests: [{ date: "2026-11-05", options: [{ start: 480, end: 1200 }], flexible: true, departments: [] }] },
    { personKey: "fixed", order: 1, existingMinutes: 600, preferences: [], requests: [{ date: "2026-11-05", options: [{ start: 480, end: 900 }], flexible: false, departments: [] }] }
  ];
  const plan = planAssignments(people, slots);
  const fixed = plan.assignments.find(item => item.person.personKey === "fixed");
  assert.equal(fixed.start, 480); assert.equal(fixed.end, 900);
  const flex = plan.assignments.find(item => item.person.personKey === "flex");
  assert.equal(flex.start, 900);
});

test("čas hned za datem se nesplete s rokem", () => {
  const people = parseShiftRequests("Ondřej Hejda\n3.11. 10-20\n4.11.2026 8-14\n5. 11. 2026 12-20\n1.11. 10/11/12-20", { year: 2026, month: 11, findWorker });
  const r = Object.fromEntries(people[0].requests.map(item => [item.date, item.options]));
  assert.deepEqual(r["2026-11-03"], [{ start: 600, end: 1200 }]);
  assert.deepEqual(r["2026-11-04"], [{ start: 480, end: 840 }]);
  assert.deepEqual(r["2026-11-05"], [{ start: 720, end: 1200 }]);
  assert.equal(r["2026-11-01"].length, 3);
});
