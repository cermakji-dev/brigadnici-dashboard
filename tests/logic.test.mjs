import test from "node:test";
import assert from "node:assert/strict";
import { automaticWorkerId, incompleteOnboardingTasks, isIgnoredShiftName, normalizeText, salesMetrics } from "../logic.mjs";

test("normalizace zachová porovnatelnost českých jmen", () => assert.equal(normalizeText("  Čermák Jiří "), "cermak jiri"));
test("volná směna se nikdy nepovažuje za člověka", () => assert.equal(isIgnoredShiftName("Volná směna"), true));
test("automatické ID je stabilní", () => assert.equal(automaticWorkerId("Novák Petr"), "AUTO-NOVAK-PETR"));
test("ASR a ARoS se počítají z denního reportu", () => assert.deepEqual(salesMetrics({ hours: 8, hardware: 100000, services: 10000 }), { asr: 13750, aros: 10 }));
test("onboarding úkoly jsou nezávislé", () => assert.deepEqual(incompleteOnboardingTasks({ training: true }), ["Zajistit podpis smluv", "Vyřešit daně"]));
