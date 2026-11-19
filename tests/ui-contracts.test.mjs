import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, app, styles] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8")
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

test("aplikace je zatím bez přihlášení a bez napojení na Insight", () => {
  assert.doesNotMatch(html, /type="password"|id="authGate"/);
  assert.doesNotMatch(app, /signInWithPassword|insight-auth|hostOrigins|guardWrites/);
  assert.match(app, /persistSession: false/);
});

test("ruční podpis je odstraněn z rozhraní a nových zápisů", () => {
  assert.doesNotMatch(html, /editorNameButton|editorDialog|Podepsat se|Podepisovat jako/);
  assert.doesNotMatch(app, /openEditorDialog|saveEditorName|x-editor-name|EDITOR_KEY/);
  assert.match(app, /return "Neuvedeno";/);
});

test("běžná zelená potvrzení se nezobrazují, chyby a undo zůstávají", () => {
  assert.match(app, /if \(text && !error && !undoAction\) text = "";/);
  assert.match(app, /elements\.toastUndo\.onclick = undoAction/);
  assert.match(html, /id="toastUndo"/);
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
  for (const id of ["shiftsViewButton", "shiftsDashboard", "bulkSalesDialog", "feedbackQuickReasons", "topbarMenu"]) {
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

test("modul Zápis směn je odstraněný", () => {
  assert.doesNotMatch(html, /planViewButton|planDashboard/);
  assert.doesNotMatch(app, /planner\.mjs|roster\.mjs|export\.mjs|initPlanView/);
});


test("zvoneček s upozorněními je odstraněný", () => {
  assert.doesNotMatch(html, /alertsToggle|alertsPanel/);
  assert.doesNotMatch(app, /renderAlerts|setAlertsOpen/);
});


test("měsíční docházka má filtry, obsazenost po dnech a přechod do dne", () => {
  assert.match(app, /month-overview-filters/);
  assert.match(app, /row\.dataset\.monthDayStatus = !dayBlocks\.length/);
  assert.match(app, /dayHours \/ planned \* 100/);
  assert.match(app, /monthShiftFilter === "all"/);
  assert.match(app, /setShiftsMode\("day"\)/);
  assert.match(app, /filteredEmpty\.hidden = visible > 0/);
});


test("tmavé týmové karty a hlavička při scrollování neprosvítají", () => {
  assert.match(styles, /:root\[data-theme="dark"\] \.person-card\s*\{\s*background: var\(--surface\);\s*-webkit-backdrop-filter: none;\s*backdrop-filter: none;/);
  assert.match(styles, /:root\[data-theme="dark"\] \.topbar\s*\{\s*background: var\(--surface-elevated\);\s*-webkit-backdrop-filter: none;\s*backdrop-filter: none;/);
  assert.match(styles, /\.person-card:hover \{ transform: none; \}/);
});


test("výchozí karty mají stejné rozestupy i bez oddělení a poznámky", () => {
  assert.match(styles, /\.person-card \.card-meta \{[\s\S]*?min-height: 54px;/);
  assert.match(styles, /\.person-card \.department-badges:empty \{ display: flex; \}/);
  assert.match(styles, /\.person-card \.card-flags\[hidden\] \{ display: flex; visibility: hidden; \}/);
  assert.match(styles, /\.person-card \.card-note\[hidden\] \{ display: block; visibility: hidden; pointer-events: none; \}/);
  assert.match(styles, /\.person-card \.card-note \.inline-note \{[\s\S]*?height: 54px;/);
});


test("neproškolený brigádník má viditelný stav a školení má na všech kartách stejný prostor", () => {
  assert.match(app, /displayedDepartments\(departments\)/);
  assert.match(app, /placeholder\.textContent = "Bez proškolení"/);
  assert.match(styles, /\.person-card \.department-badges \{[\s\S]*?min-height: 52px;[\s\S]*?height: auto;/);
  assert.match(styles, /\.person-card \.department-badge\.empty/);
});


test("rychlé filtry umožňují kombinovat všechny nebo alespoň jednu podmínku", () => {
  assert.match(html, /data-quick-mode="all" aria-pressed="true"/);
  assert.match(html, /data-quick-mode="any" aria-pressed="false"/);
  assert.match(html, /id="quickFilterSummary"/);
  assert.match(app, /quickFilterMode === "any" \? checks\.some\(Boolean\) : checks\.every\(Boolean\)/);
  assert.match(app, /selectedDepartments\.forEach\(department => checks\.push\(trained\.includes\(department\)\)\)/);
  assert.match(app, /return matchesSelectedFilters\(person, selectedDepartments\)/);
  assert.doesNotMatch(html, /departmentMatchMode|Umí všechna vybraná|Umí alespoň jedno/);
  assert.doesNotMatch(app, /departmentMatchMode/);
  assert.match(app, /button\.setAttribute\("aria-pressed", String\(active\)\)/);
  assert.match(app, /case "no-training": return canonicalDepartments\(person\.departments\)\.length === 0/);
});


test("záznamy hodnocení, poznámek, historie a reportů se dají scrollovat", () => {
  for (const panel of ["overview", "attendance", "sales", "feedback", "history"]) {
    assert.match(html, new RegExp(`data-profile-panel="${panel}" tabindex="0"`));
  }
  assert.match(styles, /#personDialog \.profile-tab-panel:not\(\[hidden\]\) \{[\s\S]*?overflow-y: auto;/);
  assert.match(styles, /#bulkSalesDialog \.bulk-sales-wrap \{[\s\S]*?overscroll-behavior: contain;/);
  assert.match(styles, /\.sales-report-dialog form \{[\s\S]*?overflow-y: auto;/);
});


test("kartám se neodřezávají proškolená oddělení", () => {
  assert.match(app, /const trained = displayedDepartments\(departments\)/);
  assert.match(styles, /\.person-card \.department-badges \{[\s\S]*?overflow: visible;/);
  assert.match(styles, /\.person-card \.department-badges \.department-badge \{ max-width: 100%; overflow-wrap: anywhere; \}/);
});
