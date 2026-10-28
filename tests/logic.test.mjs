import test from "node:test";
import assert from "node:assert/strict";
import { addRosterOnlyWorkers, automaticWorkerId, incompleteOnboardingTasks, isIgnoredShiftName, normalizeText, salesMetrics } from "../logic.mjs";

test("normalizace zachová porovnatelnost českých jmen", () => assert.equal(normalizeText("  Čermák Jiří "), "cermak jiri"));
test("volná směna se nikdy nepovažuje za člověka", () => assert.equal(isIgnoredShiftName("Volná směna"), true));
test("automatické ID je stabilní", () => assert.equal(automaticWorkerId("Novák Petr"), "AUTO-NOVAK-PETR"));
test("ASR a ARoS se počítají z denního reportu", () => assert.deepEqual(salesMetrics({ hours: 8, hardware: 100000, services: 10000 }), { asr: 13750, aros: 10 }));
test("onboarding úkoly jsou nezávislé", () => assert.deepEqual(incompleteOnboardingTasks({ training: true }), ["Zajistit podpis smluv", "Vyřešit daně"]));

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
