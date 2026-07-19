const STORAGE_KEY = "brigadnici-dashboard-v1";
const DEPARTMENTS = ["Výdej", "Prodej", "Lego", "Pokladny", "Upsell", "MV", "LOG"];
const GOOGLE_SHEET_ID = "1mEke18XDi76U_92N_HifkWSFlrsrTWs962_yPWjuYDA";
const GOOGLE_SHEET_EXPORT_URL = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/export?format=xlsx`;
let pendingWorkbook = null;
let pendingWorkbookName = "";
let currentImportPeriod = firstDayOfMonth(new Date());
let supabaseClient = null;
let remoteUser = null;
let messageTimer = null;
let hasAutoSynced = false;

const state = loadState();
const elements = {
  authGate: document.querySelector("#authGate"),
  loginForm: document.querySelector("#loginForm"),
  loginEmail: document.querySelector("#loginEmail"),
  loginPassword: document.querySelector("#loginPassword"),
  loginButton: document.querySelector("#loginButton"),
  themeToggles: [...document.querySelectorAll("[data-theme-toggle]")],
  authMessage: document.querySelector("#authMessage"),
  appContent: [...document.querySelectorAll(".app-content")],
  signedInUser: document.querySelector("#signedInUser"),
  signOutButton: document.querySelector("#signOutButton"),
  googleSheetsButton: document.querySelector("#googleSheetsButton"),
  attendanceInput: document.querySelector("#attendanceInput"),
  dropZone: document.querySelector("#dropZone"),
  importMessage: document.querySelector("#importMessage"),
  sheetSelectWrap: document.querySelector("#sheetSelectWrap"),
  sheetSelect: document.querySelector("#sheetSelect"),
  peopleGrid: document.querySelector("#peopleGrid"),
  emptyState: document.querySelector("#emptyState"),
  peopleCount: document.querySelector("#peopleCount"),
  hoursTotal: document.querySelector("#hoursTotal"),
  alertsPanel: document.querySelector("#alertsPanel"),
  alertsToggle: document.querySelector("#alertsToggle"),
  alertsClose: document.querySelector("#alertsClose"),
  alertsEarCount: document.querySelector("#alertsEarCount"),
  alertsList: document.querySelector("#alertsList"),
  alertsCount: document.querySelector("#alertsCount"),
  alertsEmpty: document.querySelector("#alertsEmpty"),
  currentPeriodLabel: document.querySelector("#currentPeriodLabel"),
  searchInput: document.querySelector("#searchInput"),
  sortSelect: document.querySelector("#sortSelect"),
  departmentFilters: [...document.querySelectorAll(".department-filter")],
  departmentMatchMode: document.querySelector("#departmentMatchMode"),
  clearDepartmentFilters: document.querySelector("#clearDepartmentFilters"),
  personDepartments: [...document.querySelectorAll(".person-department")],
  cardTemplate: document.querySelector("#personCardTemplate"),
  dialog: document.querySelector("#personDialog"),
  form: document.querySelector("#personForm"),
  dialogTitle: document.querySelector("#dialogTitle"),
  personId: document.querySelector("#personId"),
  skillsRange: document.querySelector("#skillsRange"),
  skillsOutput: document.querySelector("#skillsOutput"),
  reliabilityRange: document.querySelector("#reliabilityRange"),
  reliabilityOutput: document.querySelector("#reliabilityOutput"),
  notesInput: document.querySelector("#notesInput"),
  clearNotesButton: document.querySelector("#clearNotesButton"),
  profileUserId: document.querySelector("#profileUserId"),
  profileRole: document.querySelector("#profileRole"),
  profileStatus: document.querySelector("#profileStatus"),
  profileEmail: document.querySelector("#profileEmail"),
  savePersonButton: document.querySelector("#savePersonButton"),
  feedbackHistory: document.querySelector("#feedbackHistory"),
  feedbackBreakdown: document.querySelector("#feedbackBreakdown"),
  auditHistory: document.querySelector("#auditHistory"),
  feedbackDialog: document.querySelector("#feedbackDialog"),
  feedbackForm: document.querySelector("#feedbackForm"),
  feedbackDialogTitle: document.querySelector("#feedbackDialogTitle"),
  feedbackPersonId: document.querySelector("#feedbackPersonId"),
  feedbackType: document.querySelector("#feedbackType"),
  feedbackCategory: document.querySelector("#feedbackCategory"),
  feedbackNote: document.querySelector("#feedbackNote"),
  cancelFeedbackButton: document.querySelector("#cancelFeedbackButton"),
  cancelFeedbackAction: document.querySelector("#cancelFeedbackAction"),
  appFeedbackButton: document.querySelector("#appFeedbackButton"),
  appFeedbackDialog: document.querySelector("#appFeedbackDialog"),
  appFeedbackForm: document.querySelector("#appFeedbackForm"),
  appFeedbackCategory: document.querySelector("#appFeedbackCategory"),
  appFeedbackMessage: document.querySelector("#appFeedbackMessage"),
  appFeedbackStatus: document.querySelector("#appFeedbackStatus"),
  closeAppFeedback: document.querySelector("#closeAppFeedback"),
  cancelAppFeedback: document.querySelector("#cancelAppFeedback"),
  sendAppFeedback: document.querySelector("#sendAppFeedback")
};

elements.loginForm.addEventListener("submit", signInWithPassword);
elements.themeToggles.forEach(button => button.addEventListener("click", toggleTheme));
updateThemeControls();
elements.signOutButton.addEventListener("click", async () => {
  if (supabaseClient) await supabaseClient.auth.signOut();
});
elements.googleSheetsButton.addEventListener("click", () => syncGoogleSheets(false));
elements.attendanceInput.addEventListener("change", (event) => importAttendance(event.target.files[0]));
elements.searchInput.addEventListener("input", render);
elements.sortSelect.addEventListener("change", render);
elements.departmentFilters.forEach(input => input.addEventListener("change", render));
elements.departmentMatchMode.addEventListener("change", render);
elements.clearDepartmentFilters.addEventListener("click", () => {
  elements.departmentFilters.forEach(input => { input.checked = false; });
  render();
});
elements.sheetSelect.addEventListener("change", () => importWorkbookSheet(elements.sheetSelect.value));
elements.cancelFeedbackButton.addEventListener("click", () => elements.feedbackDialog.close());
elements.cancelFeedbackAction.addEventListener("click", () => elements.feedbackDialog.close());
elements.personDepartments.forEach(input => input.addEventListener("change", previewDepartmentSkills));
elements.clearNotesButton.addEventListener("click", () => {
  elements.notesInput.value = "";
  elements.notesInput.focus();
});
elements.alertsToggle.addEventListener("click", () => setAlertsOpen(!elements.alertsPanel.classList.contains("is-open")));
elements.alertsClose.addEventListener("click", () => setAlertsOpen(false));
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && elements.alertsPanel.classList.contains("is-open")) setAlertsOpen(false);
});
document.addEventListener("click", event => {
  if (!elements.alertsPanel.classList.contains("is-open")) return;
  if (!elements.alertsPanel.contains(event.target) && !elements.alertsToggle.contains(event.target)) setAlertsOpen(false);
});
elements.dialog.addEventListener("click", closeDialogFromBackdrop);
elements.feedbackDialog.addEventListener("click", closeDialogFromBackdrop);
elements.appFeedbackDialog.addEventListener("click", closeDialogFromBackdrop);
elements.appFeedbackButton.addEventListener("click", () => {
  elements.appFeedbackForm.reset();
  elements.appFeedbackStatus.textContent = "";
  elements.appFeedbackDialog.showModal();
});
elements.closeAppFeedback.addEventListener("click", () => elements.appFeedbackDialog.close());
elements.cancelAppFeedback.addEventListener("click", () => elements.appFeedbackDialog.close());
elements.appFeedbackForm.addEventListener("submit", submitAppFeedback);

["dragenter", "dragover"].forEach(type => elements.dropZone.addEventListener(type, (event) => {
  event.preventDefault();
  elements.dropZone.classList.add("is-dragging");
}));
["dragleave", "drop"].forEach(type => elements.dropZone.addEventListener(type, (event) => {
  event.preventDefault();
  elements.dropZone.classList.remove("is-dragging");
}));
elements.dropZone.addEventListener("drop", (event) => importAttendance(event.dataTransfer.files[0]));

elements.form.addEventListener("submit", async (event) => {
  if (event.submitter !== elements.savePersonButton) return;
  event.preventDefault();
  const person = state.people[elements.personId.value];
  if (!person) return;
  person.departments = elements.personDepartments.filter(input => input.checked).map(input => input.value);
  person.notes = elements.notesInput.value.trim();
  const metrics = calculateAutomaticMetrics(person.feedback, person.departments);
  person.skills = metrics.skills;
  person.reliability = metrics.reliability;
  if (supabaseClient && remoteUser && person.remoteId) {
    const { error } = await supabaseClient.from("workers").update({
      departments: person.departments,
      notes: person.notes,
      skills: person.skills,
      reliability: person.reliability
    }).eq("id", person.remoteId);
    if (error) {
      setMessage(`Profil se nepodařilo uložit: ${error.message}`, true);
      return;
    }
    await refreshWorkerAudit(person);
  }
  saveState();
  elements.dialog.close();
  render();
});

elements.feedbackForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const person = state.people[elements.feedbackPersonId.value];
  const note = elements.feedbackNote.value.trim();
  if (!person || !note) return;
  const feedbackItem = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: elements.feedbackType.value,
    category: elements.feedbackCategory.value,
    note,
    createdAt: new Date().toISOString()
  };
  if (supabaseClient && remoteUser && person.remoteId) {
    const { data, error } = await supabaseClient.from("feedback").insert({
      worker_id: person.remoteId,
      kind: feedbackItem.type,
      category: feedbackItem.category,
      note: feedbackItem.note,
      created_by: remoteUser.id
    }).select("id, kind, category, note, created_at").single();
    if (error) {
      elements.feedbackNote.setCustomValidity(error.message);
      elements.feedbackNote.reportValidity();
      return;
    }
    elements.feedbackNote.setCustomValidity("");
    feedbackItem.id = data.id;
    feedbackItem.category = data.category;
    feedbackItem.createdAt = data.created_at;
  }
  if (!Array.isArray(person.feedback)) person.feedback = [];
  person.feedback.push(feedbackItem);
  const metrics = calculateAutomaticMetrics(person.feedback, person.departments);
  person.skills = metrics.skills;
  person.reliability = metrics.reliability;
  if (supabaseClient && remoteUser && person.remoteId) {
    const { error } = await supabaseClient.from("workers").update(metrics).eq("id", person.remoteId);
    if (error) setMessage(`Hodnocení je uložené, ale ukazatele se nepodařilo zapsat: ${error.message}`, true);
    else await refreshWorkerAudit(person);
  }
  saveState();
  elements.feedbackDialog.close();
  render();
  if (elements.dialog.open && elements.personId.value === person.id) {
    elements.skillsRange.value = person.skills;
    elements.reliabilityRange.value = person.reliability;
    updateRangeControl(elements.skillsRange, elements.skillsOutput);
    updateRangeControl(elements.reliabilityRange, elements.reliabilityOutput);
    renderFeedbackHistory(person);
  }
});

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return parsed && parsed.people ? parsed : { people: {}, lastImport: null };
  } catch {
    return { people: {}, lastImport: null };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function initializeApp() {
  const config = window.APP_CONFIG;
  if (!config?.supabaseUrl || !config?.supabasePublishableKey || !window.supabase?.createClient) {
    showAuthMessage("Chybí konfigurace Supabase nebo se nenačetla jeho knihovna.", true);
    return;
  }
  supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    void handleSession(session);
  });
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) showAuthMessage(error.message, true);
  else await handleSession(data.session);
}

async function signInWithPassword(event) {
  event.preventDefault();
  if (!supabaseClient) return;
  showAuthMessage("Přihlašuji…");
  elements.loginButton.disabled = true;
  elements.loginButton.textContent = "Přihlašuji…";
  const { error } = await supabaseClient.auth.signInWithPassword({
    email: elements.loginEmail.value.trim(),
    password: elements.loginPassword.value
  });
  elements.loginButton.disabled = false;
  elements.loginButton.textContent = "Přihlásit se";
  showAuthMessage(error ? "E-mail nebo heslo není správné." : "Přihlášení proběhlo úspěšně.", Boolean(error));
}

function toggleTheme() {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem("brigadnici-theme", nextTheme);
  updateThemeControls();
}

function updateThemeControls() {
  const dark = document.documentElement.dataset.theme === "dark";
  elements.themeToggles.forEach(button => {
    button.querySelector(".theme-icon").textContent = dark ? "☀" : "☾";
    button.querySelector(".theme-label").textContent = dark ? "Světlý režim" : "Tmavý režim";
    button.setAttribute("aria-pressed", String(dark));
  });
}

function closeDialogFromBackdrop(event) {
  if (event.target !== event.currentTarget) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  if (!inside) event.currentTarget.close();
}

function updateRangeControl(input, output) {
  output.value = `${input.value} %`;
  input.style.setProperty("--range-value", `${input.value}%`);
}

function previewDepartmentSkills() {
  const trainedCount = elements.personDepartments.filter(input => input.checked).length;
  elements.skillsRange.value = Math.round((trainedCount / DEPARTMENTS.length) * 100);
  updateRangeControl(elements.skillsRange, elements.skillsOutput);
}

async function handleSession(session) {
  if (!session?.user) {
    remoteUser = null;
    hasAutoSynced = false;
    elements.authGate.hidden = false;
    elements.appContent.forEach(element => { element.hidden = true; });
    return;
  }
  remoteUser = session.user;
  const { data: membership, error: membershipError } = await supabaseClient
    .from("app_members")
    .select("email")
    .eq("email", remoteUser.email.toLocaleLowerCase())
    .maybeSingle();
  if (membershipError) {
    showAuthMessage(`Databáze ještě není připravená: ${membershipError.message}`, true);
    return;
  }
  if (!membership) {
    showAuthMessage("Tento e-mail není na seznamu povolených vedoucích.", true);
    await supabaseClient.auth.signOut();
    return;
  }
  elements.authGate.hidden = true;
  elements.appContent.forEach(element => { element.hidden = false; });
  elements.signedInUser.textContent = remoteUser.email;
  try {
    await loadRemoteState();
    render();
    if (!hasAutoSynced) {
      hasAutoSynced = true;
      await syncGoogleSheets(true);
    }
  } catch (error) {
    elements.authGate.hidden = false;
    elements.appContent.forEach(element => { element.hidden = true; });
    showAuthMessage(error.message, true);
  }
}

function showAuthMessage(text, error = false) {
  elements.authMessage.textContent = text;
  elements.authMessage.classList.toggle("error", error);
}

async function loadRemoteState() {
  const [workersResult, attendanceResult, feedbackResult, auditResult] = await Promise.all([
    supabaseClient.from("workers").select("*").eq("active", true).order("full_name"),
    supabaseClient.from("attendance_totals").select("worker_id, period, hours"),
    supabaseClient.from("feedback").select("id, worker_id, kind, category, note, created_at").order("created_at"),
    supabaseClient.from("worker_audit").select("*").order("changed_at", { ascending: false }).limit(500)
  ]);
  const error = workersResult.error || attendanceResult.error || feedbackResult.error || auditResult.error;
  if (error) throw new Error(`Data se nepodařilo načíst: ${error.message}`);

  const latestPeriod = firstDayOfMonth(new Date());
  const hoursByWorker = new Map(attendanceResult.data
    .filter(row => row.period === latestPeriod)
    .map(row => [row.worker_id, Number(row.hours)]));
  const feedbackByWorker = new Map();
  feedbackResult.data.forEach(item => {
    if (!feedbackByWorker.has(item.worker_id)) feedbackByWorker.set(item.worker_id, []);
    feedbackByWorker.get(item.worker_id).push({
      id: item.id,
      type: item.kind,
      category: item.category || "general",
      note: item.note,
      createdAt: item.created_at
    });
  });
  const auditByWorker = new Map();
  auditResult.data.forEach(item => {
    if (!auditByWorker.has(item.worker_id)) auditByWorker.set(item.worker_id, []);
    auditByWorker.get(item.worker_id).push({
      id: item.id,
      changedAt: item.changed_at,
      changedBy: item.changed_by_email || (item.changed_by === remoteUser.id ? remoteUser.email : "Dřívější uživatel"),
      operation: item.operation,
      before: item.before_data,
      after: item.after_data
    });
  });

  const remotePeople = {};
  workersResult.data.forEach(worker => {
    const id = slugify(worker.full_name);
    const workerFeedback = feedbackByWorker.get(worker.id) || [];
    const metrics = calculateAutomaticMetrics(workerFeedback, worker.departments || []);
    remotePeople[id] = {
      id,
      remoteId: worker.id,
      name: worker.full_name,
      userId: worker.external_user_id,
      email: worker.email || "",
      role: worker.role,
      status: worker.status,
      photo: worker.photo_url || "",
      hours: hoursByWorker.get(worker.id) || 0,
      skills: metrics.skills,
      reliability: metrics.reliability,
      departments: worker.departments || [],
      notes: worker.notes || "",
      positive: 0,
      negative: 0,
      feedback: workerFeedback,
      audit: auditByWorker.get(worker.id) || [],
      aliases: worker.aliases || []
    };
  });
  state.people = remotePeople;
  if (latestPeriod) currentImportPeriod = latestPeriod;
  saveState();
}

function findActiveWorker(name) {
  const key = slugify(name);
  return Object.values(state.people).find(worker => [worker.name, ...(worker.aliases || [])].some(candidate => slugify(candidate) === key));
}

async function syncGoogleSheets(automatic = false) {
  const button = elements.googleSheetsButton;
  button.disabled = true;
  button.textContent = "Načítám…";
  setMessage("");
  try {
    const response = await fetch(`${GOOGLE_SHEET_EXPORT_URL}&cache=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Google Sheets vrátil chybu ${response.status}.`);
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html")) throw new Error("Tabulka není dostupná bez přihlášení. Nastavte sdílení na Kdokoli s odkazem – čtenář.");
    const file = new File([await response.blob()], "BRIGÁDNÍCI P7 – Google Sheets.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    await prepareWorkbook(file, true);
  } catch (error) {
    setMessage(`${automatic ? "Automatická synchronizace: " : ""}${error.message || "Google tabulku se nepodařilo načíst."}`, true);
  } finally {
    button.disabled = false;
    button.textContent = "Načíst z Google Sheets";
  }
}

async function importAttendance(file) {
  if (!file) return;
  setMessage("");
  try {
    if (/\.xlsx$/i.test(file.name)) {
      await prepareWorkbook(file);
      elements.attendanceInput.value = "";
      return;
    }
    pendingWorkbook = null;
    elements.sheetSelectWrap.hidden = true;
    const text = await file.text();
    const rows = parseCsv(text);
    currentImportPeriod = firstDayOfMonth(new Date());
    await importRows(rows, file.name);
    elements.attendanceInput.value = "";
  } catch (error) {
    setMessage(error.message || "Soubor se nepodařilo načíst.", true);
  }
}

async function prepareWorkbook(file, requireCurrentMonth = false) {
  if (typeof XLSX === "undefined") throw new Error("Knihovna pro Excel se nenačetla. Zkontrolujte připojení k internetu a zkuste to znovu.");
  pendingWorkbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  pendingWorkbookName = file.name;
  const compatible = pendingWorkbook.SheetNames.filter(name => findWorkbookHeader(pendingWorkbook.Sheets[name]));
  if (!compatible.length) throw new Error("V Excelu nebyl nalezen list se sloupci Jméno a Počet zapsaných hodin.");
  elements.sheetSelect.replaceChildren(...compatible.map(name => new Option(name, name)));
  const currentPeriod = firstDayOfMonth(new Date());
  const currentSheet = compatible.find(name => periodFromSheetName(name) === currentPeriod);
  if (requireCurrentMonth && !currentSheet) throw new Error("V Google tabulce nebyl nalezen list pro aktuální měsíc.");
  elements.sheetSelect.value = currentSheet || compatible[compatible.length - 1];
  elements.sheetSelectWrap.hidden = false;
  importWorkbookSheet(elements.sheetSelect.value);
}

function findWorkbookHeader(sheet) {
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
  for (let rowIndex = 0; rowIndex < Math.min(matrix.length, 12); rowIndex += 1) {
    const cells = matrix[rowIndex].map(normalize);
    const nameIndex = cells.findIndex(cell => ["jmeno", "brigadnik", "name"].includes(cell));
    const hoursIndex = cells.findIndex(cell => ["pocet zapsanych hodin", "pocet hodin", "hodiny", "hours"].includes(cell));
    if (nameIndex >= 0 && hoursIndex >= 0) return { matrix, rowIndex, nameIndex, hoursIndex };
  }
  return null;
}

async function importWorkbookSheet(sheetName) {
  if (!pendingWorkbook || !sheetName) return;
  try {
    const match = findWorkbookHeader(pendingWorkbook.Sheets[sheetName]);
    if (!match) throw new Error("Vybraný list nemá očekávaný souhrn hodin.");
    const rows = [];
    for (let index = match.rowIndex + 1; index < match.matrix.length; index += 1) {
      const name = String(match.matrix[index][match.nameIndex] || "").trim();
      const hours = match.matrix[index][match.hoursIndex];
      if (!name) continue;
      if (["pocet volnych smen", "pocet obsazenych smen", "% obsazeni", "planovane hodiny", "z toho log (obsazene)"].includes(normalize(name))) break;
      rows.push({ Jméno: name, Hodiny: hours });
    }
    currentImportPeriod = periodFromSheetName(sheetName) || firstDayOfMonth(new Date());
    await importRows(rows, `${pendingWorkbookName} — ${sheetName}`);
  } catch (error) {
    setMessage(error.message || "List se nepodařilo načíst.", true);
  }
}

async function importRows(rows, sourceName) {
  if (!rows.length) throw new Error("Soubor neobsahuje žádné datové řádky.");
  const columns = Object.keys(rows[0]);
  const nameColumn = findColumn(columns, ["jméno", "jmeno", "brigádník", "brigadnik", "name"]);
  const hoursColumn = findColumn(columns, ["hodiny", "počet zapsaných hodin", "pocet zapsanych hodin", "počet hodin", "pocet hodin", "hours"]);
  const photoColumn = findColumn(columns, ["foto", "fotka", "photo", "image"], false);
  const emailColumn = findColumn(columns, ["email", "e-mail"], false);
  if (!nameColumn || !hoursColumn) throw new Error("Chybí sloupec Jméno nebo Hodiny.");

  const totals = new Map();
  rows.forEach(row => {
    const importedName = String(row[nameColumn] || "").trim();
    const activeWorker = findActiveWorker(importedName);
    if (!activeWorker) return;
    const name = activeWorker.name;
    const id = slugify(name);
    if (!totals.has(id)) totals.set(id, { id, name, hours: 0, email: activeWorker.email, photo: "" });
    const imported = totals.get(id);
    imported.hours += parseHours(row[hoursColumn]);
    if (emailColumn && row[emailColumn]) imported.email = String(row[emailColumn]).trim();
    if (photoColumn && row[photoColumn]) imported.photo = String(row[photoColumn]).trim();
  });

  Object.values(state.people).forEach(person => { person.hours = 0; });
  totals.forEach(imported => {
    if (!state.people[imported.id]) {
      state.people[imported.id] = {
        ...imported, skills: 50, reliability: 50, positive: 0, negative: 0, notes: "", feedback: []
      };
    } else {
      state.people[imported.id].name = imported.name;
      state.people[imported.id].hours = imported.hours;
      if (imported.email) state.people[imported.id].email = imported.email;
      if (imported.photo) state.people[imported.id].photo = imported.photo;
    }
  });

  state.lastImport = new Date().toISOString();
  if (supabaseClient && remoteUser) await saveAttendanceRemote(totals, sourceName);
  saveState();
  render();
  setMessage(`Načteno ${totals.size} brigádníků ze zdroje ${sourceName}.`);
}

async function saveAttendanceRemote(totals, sourceName) {
  const rows = [...totals.values()].flatMap(imported => {
    const person = state.people[imported.id];
    return person?.remoteId ? [{
      worker_id: person.remoteId,
      period: currentImportPeriod,
      hours: imported.hours,
      source_name: sourceName,
      imported_by: remoteUser.id,
      imported_at: new Date().toISOString()
    }] : [];
  });
  if (!rows.length) return;
  const { error } = await supabaseClient.from("attendance_totals").upsert(rows, {
    onConflict: "worker_id,period"
  });
  if (error) throw new Error(`Docházku se nepodařilo uložit: ${error.message}`);
}

function parseCsv(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const delimiter = firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";
  const records = [];
  let row = [], value = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(value); value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(value); value = "";
      if (row.some(cell => cell.trim())) records.push(row);
      row = [];
    } else value += char;
  }
  if (value || row.length) { row.push(value); records.push(row); }
  if (records.length < 2) return [];
  const headers = records[0].map(header => header.trim().replace(/^\uFEFF/, ""));
  return records.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() || ""])));
}

function findColumn(columns, aliases, required = true) {
  const normalized = new Map(columns.map(column => [normalize(column), column]));
  for (const alias of aliases) if (normalized.has(normalize(alias))) return normalized.get(normalize(alias));
  return required ? null : undefined;
}

function normalize(value) {
  return String(value ?? "").toLocaleLowerCase("cs").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function slugify(value) {
  return normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function parseHours(value) {
  const normalized = String(value || "0").replace(",", ".").replace(/[^0-9.-]/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function render() {
  const query = normalize(elements.searchInput.value);
  const selectedDepartments = elements.departmentFilters.filter(input => input.checked).map(input => input.value);
  const people = Object.values(state.people).filter(person => {
    if (!normalize(person.name).includes(query)) return false;
    if (!selectedDepartments.length) return true;
    const trained = Array.isArray(person.departments) ? person.departments : [];
    return elements.departmentMatchMode.value === "all"
      ? selectedDepartments.every(department => trained.includes(department))
      : selectedDepartments.some(department => trained.includes(department));
  });
  const sort = elements.sortSelect.value;
  people.sort((a, b) => {
    if (sort === "hours-desc") return b.hours - a.hours || a.name.localeCompare(b.name, "cs");
    if (sort === "rating-desc") return score(b) - score(a) || a.name.localeCompare(b.name, "cs");
    return a.name.localeCompare(b.name, "cs");
  });

  elements.peopleGrid.replaceChildren(...people.map(createCard));
  elements.currentPeriodLabel.textContent = new Intl.DateTimeFormat("cs-CZ", { month: "long", year: "numeric" }).format(new Date());
  elements.peopleCount.textContent = people.length;
  elements.hoursTotal.textContent = formatNumber(people.reduce((total, person) => total + Number(person.hours || 0), 0));
  elements.emptyState.hidden = people.length > 0;
  elements.peopleGrid.hidden = people.length === 0;
  renderAlerts();
}

function renderAlerts() {
  const people = Object.values(state.people);
  const workedHours = people.map(person => Number(person.hours || 0)).filter(hours => hours > 0).sort((a, b) => a - b);
  const medianHours = workedHours.length ? workedHours[Math.floor(workedHours.length / 2)] : 0;
  const alerts = [];

  people.forEach(person => {
    const reasons = [];
    const previousReliability = previousAuditValue(person, "reliability");
    if (previousReliability !== null && Number(person.reliability) < Number(previousReliability)) {
      reasons.push({ type: "attendance", text: `Docházka klesla z ${previousReliability} na ${person.reliability} %` });
    } else if (Number(person.reliability) < 40) {
      reasons.push({ type: "attendance", text: `Nízká docházková morálka (${person.reliability} %)` });
    }
    if (medianHours > 0 && Number(person.hours || 0) > 0 && Number(person.hours || 0) < medianHours * 0.5) {
      reasons.push({ type: "hours", text: `Málo hodin (${formatNumber(person.hours || 0)} oproti mediánu ${formatNumber(medianHours)})` });
    }
    const negative = feedbackCount(person, "negative");
    const positive = feedbackCount(person, "positive");
    if (negative >= 2 && negative > positive) {
      reasons.push({ type: "feedback", text: `Převažují palce dolů (${negative} 👎 / ${positive} 👍)` });
    }
    if (reasons.length) alerts.push({ person, reasons });
  });

  elements.alertsCount.textContent = alerts.length;
  elements.alertsEarCount.textContent = alerts.length;
  elements.alertsToggle.classList.toggle("has-alerts", alerts.length > 0);
  elements.alertsEmpty.hidden = alerts.length > 0;
  elements.alertsList.hidden = alerts.length === 0;
  elements.alertsList.replaceChildren(...alerts.map(({ person, reasons }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "alert-item";
    const title = document.createElement("strong");
    title.textContent = person.name;
    const badges = document.createElement("span");
    badges.className = "alert-reasons";
    reasons.forEach(reason => {
      const badge = document.createElement("span");
      badge.className = `alert-reason ${reason.type}`;
      badge.textContent = reason.text;
      badges.append(badge);
    });
    button.append(title, badges);
    button.addEventListener("click", () => {
      setAlertsOpen(false);
      openPerson(person.id);
    });
    return button;
  }));
}

function setAlertsOpen(open) {
  elements.alertsPanel.classList.toggle("is-open", open);
  elements.alertsPanel.setAttribute("aria-hidden", String(!open));
  elements.alertsToggle.setAttribute("aria-expanded", String(open));
}

function previousAuditValue(person, field) {
  const audit = Array.isArray(person.audit) ? person.audit : [];
  const change = audit.find(item => item.operation === "UPDATE" && item.before?.[field] !== item.after?.[field]);
  return change ? change.before[field] : null;
}

function createCard(person) {
  const card = elements.cardTemplate.content.firstElementChild.cloneNode(true);
  card.tabIndex = 0;
  card.setAttribute("aria-label", `Zobrazit detail: ${person.name}`);
  card.querySelector("h3").textContent = person.name;
  const email = card.querySelector(".email");
  email.textContent = person.email || "Bez e-mailu";
  const avatar = card.querySelector(".avatar");
  if (person.photo) avatar.style.backgroundImage = `url("${safeCssUrl(person.photo)}")`;
  else avatar.textContent = initials(person.name);
  card.querySelector(".hours-value").textContent = formatNumber(person.hours || 0);
  renderDepartmentBadges(card.querySelector(".department-badges"), person.departments);
  setMetric(card, "skills", person.skills);
  setMetric(card, "reliability", person.reliability);
  const note = card.querySelector(".note-preview");
  note.textContent = person.notes || "Zatím bez poznámky.";

  const positive = card.querySelector(".positive");
  const negative = card.querySelector(".negative");
  positive.querySelector("span").textContent = feedbackCount(person, "positive");
  negative.querySelector("span").textContent = feedbackCount(person, "negative");
  positive.addEventListener("click", event => { event.stopPropagation(); openFeedback(person.id, "positive"); });
  negative.addEventListener("click", event => { event.stopPropagation(); openFeedback(person.id, "negative"); });
  card.querySelector(".edit-button").addEventListener("click", event => { event.stopPropagation(); openPerson(person.id); });
  card.addEventListener("click", event => { if (!event.target.closest("button")) openPerson(person.id); });
  card.addEventListener("keydown", event => {
    if (event.target === card && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      openPerson(person.id);
    }
  });
  const scoreElement = card.querySelector(".score");
  const currentScore = score(person);
  scoreElement.textContent = currentScore > 0 ? `+${currentScore}` : `${currentScore}`;
  scoreElement.classList.toggle("positive-score", currentScore > 0);
  scoreElement.classList.toggle("negative-score", currentScore < 0);
  return card;
}

function setMetric(card, key, value = 50) {
  const safeValue = Math.min(100, Math.max(0, Number(value)));
  card.querySelector(`.${key}-value`).textContent = `${safeValue} %`;
  card.querySelector(`.${key}-bar`).style.width = `${safeValue}%`;
}

function renderDepartmentBadges(container, departments) {
  const trained = Array.isArray(departments) ? departments.filter(item => DEPARTMENTS.includes(item)) : [];
  if (!trained.length) {
    const empty = document.createElement("span");
    empty.className = "department-badge empty";
    empty.textContent = "Zaškolení nezadané";
    container.append(empty);
    return;
  }
  trained.forEach(department => {
    const badge = document.createElement("span");
    badge.className = "department-badge";
    badge.textContent = department;
    container.append(badge);
  });
}

function openFeedback(id, type) {
  const person = state.people[id];
  elements.feedbackPersonId.value = id;
  elements.feedbackType.value = type;
  elements.feedbackCategory.value = "";
  elements.feedbackNote.value = "";
  elements.feedbackDialogTitle.textContent = `${type === "positive" ? "👍 Palec nahoru" : "👎 Palec dolů"} — ${person.name}`;
  elements.feedbackDialog.showModal();
  elements.feedbackNote.focus();
}

function feedbackCount(person, type) {
  const legacy = Number(person[type] || 0);
  const recorded = Array.isArray(person.feedback) ? person.feedback.filter(item => item.type === type).length : 0;
  return legacy + recorded;
}

function calculateAutomaticMetrics(feedback = [], departments = []) {
  const net = category => feedback.reduce((total, item) => {
    if ((item.category || "general") !== category) return total;
    return total + (item.type === "positive" ? 1 : -1);
  }, 0);
  const trainedDepartments = new Set(departments.filter(department => DEPARTMENTS.includes(department))).size;
  return {
    skills: Math.round((trainedDepartments / DEPARTMENTS.length) * 100),
    reliability: clampMetric(100 + net("attendance") * 5)
  };
}

function clampMetric(value) {
  return Math.min(100, Math.max(0, Number(value)));
}

function score(person) { return feedbackCount(person, "positive") - feedbackCount(person, "negative"); }

function openPerson(id) {
  const person = state.people[id];
  elements.dialogTitle.textContent = person.name;
  elements.personId.value = id;
  elements.profileUserId.textContent = person.userId || "—";
  elements.profileRole.textContent = person.role || "—";
  elements.profileStatus.textContent = person.status || "—";
  elements.profileEmail.textContent = person.email || "—";
  elements.skillsRange.value = person.skills ?? 50;
  updateRangeControl(elements.skillsRange, elements.skillsOutput);
  elements.reliabilityRange.value = person.reliability ?? 50;
  updateRangeControl(elements.reliabilityRange, elements.reliabilityOutput);
  const trained = Array.isArray(person.departments) ? person.departments : [];
  elements.personDepartments.forEach(input => { input.checked = trained.includes(input.value); });
  elements.notesInput.value = person.notes || "";
  elements.clearNotesButton.hidden = !person.notes;
  renderFeedbackHistory(person);
  renderAuditHistory(person);
  elements.dialog.showModal();
}

function renderFeedbackHistory(person) {
  const feedback = Array.isArray(person.feedback) ? [...person.feedback].reverse() : [];
  renderFeedbackBreakdown(feedback);
  if (!feedback.length) {
    elements.feedbackHistory.innerHTML = '<p class="no-feedback">Zatím bez hodnocení s poznámkou.</p>';
    return;
  }
  const list = document.createElement("ul");
  list.className = "feedback-history-list";
  feedback.forEach(item => {
    const entry = document.createElement("li");
    entry.className = "feedback-entry";
    const icon = document.createElement("span");
    icon.textContent = item.type === "positive" ? "👍" : "👎";
    const category = document.createElement("span");
    category.className = `feedback-category ${item.category || "general"}`;
    category.textContent = feedbackCategoryLabel(item.category);
    const time = document.createElement("time");
    time.dateTime = item.createdAt;
    time.textContent = new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt));
    const note = document.createElement("p");
    note.textContent = item.note;
    const heading = document.createElement("div");
    heading.className = "feedback-entry-heading";
    heading.append(category, time);
    entry.append(icon, heading, note);
    list.append(entry);
  });
  elements.feedbackHistory.replaceChildren(list);
}

function renderFeedbackBreakdown(feedback) {
  const categories = ["attendance", "training", "general"];
  elements.feedbackBreakdown.replaceChildren(...categories.map(category => {
    const items = feedback.filter(item => (item.category || "general") === category);
    const positive = items.filter(item => item.type === "positive").length;
    const negative = items.filter(item => item.type === "negative").length;
    const card = document.createElement("div");
    card.className = `feedback-breakdown-item ${category}`;
    const label = document.createElement("span");
    label.textContent = feedbackCategoryLabel(category);
    const counts = document.createElement("strong");
    counts.textContent = `${positive} 👍  ${negative} 👎`;
    card.append(label, counts);
    return card;
  }));
}

function feedbackCategoryLabel(category) {
  return ({ attendance: "Docházka", training: "Zaškolení", general: "Obecné" })[category] || "Obecné";
}

function renderAuditHistory(person) {
  const audit = Array.isArray(person.audit) ? person.audit : [];
  const relevant = audit.map(item => ({ ...item, changes: describeAuditChanges(item) }))
    .filter(item => item.operation !== "UPDATE" || item.changes.length);
  if (!relevant.length) {
    elements.auditHistory.innerHTML = '<p class="no-feedback">Zatím bez zaznamenané změny profilu.</p>';
    return;
  }
  const list = document.createElement("ul");
  list.className = "audit-history-list";
  relevant.slice(0, 20).forEach(item => {
    const entry = document.createElement("li");
    entry.className = "audit-entry";
    const meta = document.createElement("div");
    meta.className = "audit-meta";
    const author = document.createElement("strong");
    author.textContent = item.changedBy;
    const time = document.createElement("time");
    time.dateTime = item.changedAt;
    time.textContent = new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.changedAt));
    meta.append(author, time);
    const description = document.createElement("p");
    description.textContent = item.operation === "INSERT" ? "Profil byl vytvořen." : item.changes.join(" · ");
    entry.append(meta, description);
    list.append(entry);
  });
  elements.auditHistory.replaceChildren(list);
}

function describeAuditChanges(item) {
  if (item.operation !== "UPDATE" || !item.before || !item.after) return [];
  const fields = [
    ["skills", "Schopnosti"],
    ["reliability", "Docházka"],
    ["departments", "Zaškolení"],
    ["notes", "Poznámka"],
    ["photo_url", "Fotografie"]
  ];
  return fields.flatMap(([field, label]) => {
    const before = item.before[field];
    const after = item.after[field];
    if (JSON.stringify(before) === JSON.stringify(after)) return [];
    if (field === "notes") return [`${label} upravena`];
    if (field === "photo_url") return [`${label} změněna`];
    return [`${label}: ${formatAuditValue(before)} → ${formatAuditValue(after)}`];
  });
}

function formatAuditValue(value) {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "bez zaškolení";
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

async function refreshWorkerAudit(person) {
  const { data, error } = await supabaseClient
    .from("worker_audit")
    .select("*")
    .eq("worker_id", person.remoteId)
    .order("changed_at", { ascending: false })
    .limit(20);
  if (error) return;
  person.audit = data.map(item => ({
    id: item.id,
    changedAt: item.changed_at,
    changedBy: item.changed_by_email || (item.changed_by === remoteUser.id ? remoteUser.email : "Dřívější uživatel"),
    operation: item.operation,
    before: item.before_data,
    after: item.after_data
  }));
}

async function submitAppFeedback(event) {
  event.preventDefault();
  const message = elements.appFeedbackMessage.value.trim();
  if (!message || !supabaseClient || !remoteUser) return;
  elements.sendAppFeedback.disabled = true;
  elements.sendAppFeedback.textContent = "Odesílám…";
  elements.appFeedbackStatus.textContent = "";
  elements.appFeedbackStatus.classList.remove("error");
  const { error } = await supabaseClient.from("app_feedback").insert({
    category: elements.appFeedbackCategory.value,
    message,
    page_url: window.location.href,
    created_by: remoteUser.id,
    created_by_email: remoteUser.email.toLocaleLowerCase()
  });
  elements.sendAppFeedback.disabled = false;
  elements.sendAppFeedback.textContent = "Odeslat zpětnou vazbu";
  if (error) {
    elements.appFeedbackStatus.textContent = `Zpětnou vazbu se nepodařilo odeslat: ${error.message}`;
    elements.appFeedbackStatus.classList.add("error");
    return;
  }
  elements.appFeedbackStatus.textContent = "Děkujeme, zpětná vazba byla odeslána.";
  setTimeout(() => elements.appFeedbackDialog.close(), 900);
}

function setMessage(text, error = false) {
  clearTimeout(messageTimer);
  elements.importMessage.textContent = text;
  elements.importMessage.classList.toggle("error", error);
  elements.importMessage.hidden = !text;
  if (text) {
    messageTimer = setTimeout(() => {
      elements.importMessage.hidden = true;
    }, error ? 8000 : 4000);
  }
}

function initials(name) { return name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toLocaleUpperCase("cs"); }
function formatNumber(value) { return new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2 }).format(value); }
function safeCssUrl(value) { return String(value).replace(/["\\\n\r]/g, ""); }

function firstDayOfMonth(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

function periodFromSheetName(sheetName) {
  const match = normalize(sheetName).match(/^(leden|unor|brezen|duben|kveten|cerven|cervenec|srpen|zari|rijen|listopad|prosinec)(\d{2}|\d{4})$/);
  if (!match) return null;
  const months = ["leden", "unor", "brezen", "duben", "kveten", "cerven", "cervenec", "srpen", "zari", "rijen", "listopad", "prosinec"];
  const year = match[2].length === 2 ? 2000 + Number(match[2]) : Number(match[2]);
  return `${year}-${String(months.indexOf(match[1]) + 1).padStart(2, "0")}-01`;
}

void initializeApp();
