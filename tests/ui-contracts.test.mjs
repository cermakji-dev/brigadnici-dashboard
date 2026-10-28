import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, app] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8")
]);

test("profil zobrazuje schopnosti a docházku jako automatické ukazatele", () => {
  assert.match(html, /<progress id="skillsRange" class="metric-meter"/);
  assert.match(html, /<progress id="reliabilityRange" class="metric-meter"/);
  assert.doesNotMatch(html, /<input id="(?:skillsRange|reliabilityRange)" type="range"/);
  assert.match(app, /elements\.skillsRange\.value = Math\.round\(\(trainedCount \/ DEPARTMENTS\.length\) \* 100\)/);
  assert.match(app, /elements\.reliabilityRange\.value = person\.reliability/);
});

test("historie hodnocení ukládá a zobrazuje e-mail autora", () => {
  assert.match(app, /created_by_email: remoteUser\.email\.toLowerCase\(\)/);
  assert.match(app, /createdByEmail: item\.created_by_email/);
  assert.match(app, /author\.textContent = item\.createdByEmail/);
});
