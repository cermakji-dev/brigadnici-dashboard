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

test("hodnocení nejde odeslat dvakrát dvojklikem", () => {
  assert.match(app, /if \(submitButton\.disabled\) return;\s*submitButton\.disabled = true;/);
});

test("autor prodejního reportu se nevkládá jako HTML", () => {
  assert.doesNotMatch(app, /\$\{day\.updatedByEmail/);
  assert.match(app, /\.sales-author"\)\.textContent = day\.updatedByEmail/);
});

test("ověření hesla stejného uživatele znovu nenačítá celou aplikaci", () => {
  assert.match(app, /remoteUser\?\.id === session\.user\.id && elements\.authGate\.hidden/);
});

test("profil má záložku docházky a přehledy mají export", () => {
  assert.match(html, /data-profile-tab="attendance"/);
  assert.match(html, /id="attendanceHistoryChart"/);
  assert.match(html, /id="exportTeamButton"/);
  assert.match(html, /id="exportSalesButton"/);
});

test("verze souborů pro obejití mezipaměti GitHub Pages sedí", () => {
  const appVersion = html.match(/app\.js\?v=(\d+)/)[1];
  assert.match(app, new RegExp(`logic\\.mjs\\?v=${appVersion}"`));
  assert.match(html, new RegExp(`<span>v${appVersion}</span>`));
});
