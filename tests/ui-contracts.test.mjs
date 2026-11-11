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
  assert.match(app, /created_by_email: editorLabel\(\)/);
  assert.match(app, /createdByEmail: item\.created_by_email/);
  assert.match(app, /author\.textContent = item\.createdByEmail/);
});

test("hodnocení nejde odeslat dvakrát dvojklikem", () => {
  assert.match(app, /if \(submitButton\.disabled\) return;\s*submitButton\.disabled = true;/);
});

test("autor prodejního reportu se nevkládá jako HTML", () => {
  assert.doesNotMatch(app, /\$\{day\.updatedByEmail/);
  assert.match(app, /cells\[7\]\.textContent = day\.updatedByEmail/);
});

test("prohlížení je veřejné, úpravy jen pod přihlášeným účtem", () => {
  assert.doesNotMatch(html, /id="authGate"/);
  assert.match(html, /id="loginPassword" type="password"/);
  assert.match(app, /signInWithPassword/);
  assert.match(app, /persistSession: true/);
  assert.match(app, /guardWrites\(supabaseClient\)/);
  assert.doesNotMatch(app, /x-editor-name/);
});

test("profil má záložku docházky a přehledy už nemají export", () => {
  assert.match(html, /data-profile-tab="attendance"/);
  assert.match(html, /id="attendanceHistoryChart"/);
  assert.doesNotMatch(html, /id="exportTeamButton"|id="exportSalesButton"/);
  assert.doesNotMatch(app, /exportTeamCsv|exportSalesCsv/);
});

test("záložka Docházka má jen vykřičník pro dnešní neobsazenou směnu", () => {
  assert.match(html, />Docházka <span id="shiftsFreeBadge" class="tab-alert" hidden/);
  assert.match(app, /block\.date === todayKey/);
});

test("verze souborů pro obejití mezipaměti GitHub Pages sedí", () => {
  const appVersion = html.match(/app\.js\?v=(\d+)/)[1];
  assert.match(app, new RegExp(`logic\\.mjs\\?v=${appVersion}"`));
  assert.match(html, new RegExp(`<span>v${appVersion}</span>`));
});

test("data z Google stahuje server, prohlížeč jen čte rozpis", () => {
  assert.doesNotMatch(app, /docs\.google\.com\/spreadsheets\/d\/\$\{/);
  assert.match(app, /functions\.invoke\("sync-google-sheets"/);
  assert.match(app, /from\("shifts"\)/);
});

test("mazání palců a poznámek je vratné", () => {
  assert.doesNotMatch(app, /from\("feedback"\)\.delete\(\)|from\("worker_notes"\)\.delete\(\)/);
  assert.match(app, /setRecordDeleted\("feedback", item\.id, false\)/);
  assert.match(app, /\.is\("deleted_at", null\)/);
});

test("oznámení s Vrátit zpět funguje i nad otevřeným dialogem", () => {
  assert.match(html, /id="importMessage"[^>]*popover="manual"/);
  assert.match(app, /host\.append\(toast\)/);
});

test("nové části rozhraní existují", () => {
  for (const id of ["shiftsViewButton", "shiftsDashboard", "bulkSalesDialog", "feedbackQuickReasons", "topbarMenu", "alertsToggle"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
});

test("profil má souhrn v hlavičce a pět záložek", () => {
  const tabs = [...html.matchAll(/data-profile-tab="([a-z]+)"/g)].map(match => match[1]);
  assert.deepEqual(tabs, ["overview", "attendance", "sales", "feedback", "history"]);
  for (const id of ["profileHours", "profileHours60", "profileNextShift", "profileScore", "profileUpcomingShifts", "profileThumbUp"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
});

test("detail je velké okno uprostřed se záložkami a přepínáním lidí", () => {
  assert.match(app, /elements\.dialog\.showModal\(\)/);
  assert.doesNotMatch(app, /elements\.dialog\.show\(\)/);
  assert.match(html, /id="profilePrev"/);
  assert.match(html, /id="profileNext"/);
  assert.match(app, /function stepPerson\(/);
});

test("Směny mají přepínač Den / Celý měsíc a měsíční osu", () => {
  assert.match(html, /data-shifts-mode="day"/);
  assert.match(html, /data-shifts-mode="month"/);
  assert.match(html, /id="shiftsMonth"/);
  assert.match(app, /function renderShiftsMonth\(/);
  assert.match(app, /from\("attendance_totals"\)\.select\("worker_id, hours"\)\.eq\("period", period\)/);
});

test("knihovna pro Excel se načítá až při ručním importu, Supabase má pevnou verzi", () => {
  assert.doesNotMatch(html, /xlsx\.full\.min\.js/);
  assert.match(app, /function ensureXlsx\(/);
  assert.match(html, /supabase-js@\d+\.\d+\.\d+/);
});
