const STORAGE_KEY = "brigadnici-dashboard-v1";
const DEPARTMENTS = ["Výdej", "Prodej", "Lego", "Pokladny", "Upsell", "MV", "LOG"];
let pendingWorkbook = null;
let pendingWorkbookName = "";
let currentImportPeriod = firstDayOfMonth(new Date());
let supabaseClient = null;
let remoteUser = null;

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
  attendanceInput: document.querySelector("#attendanceInput"),
  importBackupInput: document.querySelector("#importBackupInput"),
  exportButton: document.querySelector("#exportButton"),
  dropZone: document.querySelector("#dropZone"),
  importMessage: document.querySelector("#importMessage"),
  sheetSelectWrap: document.querySelector("#sheetSelectWrap"),
  sheetSelect: document.querySelector("#sheetSelect"),
  peopleGrid: document.querySelector("#peopleGrid"),
  emptyState: document.querySelector("#emptyState"),
  peopleCount: document.querySelector("#peopleCount"),
  hoursTotal: document.querySelector("#hoursTotal"),
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
  photoUrl: document.querySelector("#photoUrl"),
  skillsRange: document.querySelector("#skillsRange"),
  skillsOutput: document.querySelector("#skillsOutput"),
  reliabilityRange: document.querySelector("#reliabilityRange"),
  reliabilityOutput: document.querySelector("#reliabilityOutput"),
  notesInput: document.querySelector("#notesInput"),
  profileUserId: document.querySelector("#profileUserId"),
  profileRole: document.querySelector("#profileRole"),
  profileStatus: document.querySelector("#profileStatus"),
  profileEmail: document.querySelector("#profileEmail"),
  savePersonButton: document.querySelector("#savePersonButton"),
  feedbackHistory: document.querySelector("#feedbackHistory"),
  feedbackDialog: document.querySelector("#feedbackDialog"),
  feedbackForm: document.querySelector("#feedbackForm"),
  feedbackDialogTitle: document.querySelector("#feedbackDialogTitle"),
  feedbackPersonId: document.querySelector("#feedbackPersonId"),
  feedbackType: document.querySelector("#feedbackType"),
  feedbackNote: document.querySelector("#feedbackNote"),
  cancelFeedbackButton: document.querySelector("#cancelFeedbackButton"),
  cancelFeedbackAction: document.querySelector("#cancelFeedbackAction")
};

elements.loginForm.addEventListener("submit", signInWithPassword);
elements.themeToggles.forEach(button => button.addEventListener("click", toggleTheme));
updateThemeControls();
elements.signOutButton.addEventListener("click", async () => {
  if (supabaseClient) await supabaseClient.auth.signOut();
});
elements.attendanceInput.addEventListener("change", (event) => importAttendance(event.target.files[0]));
elements.importBackupInput.addEventListener("change", (event) => importBackup(event.target.files[0]));
elements.exportButton.addEventListener("click", exportBackup);
elements.searchInput.addEventListener("input", render);
elements.sortSelect.addEventListener("change", render);
elements.departmentFilters.forEach(input => input.addEventListener("change", render));
elements.departmentMatchMode.addEventListener("change", render);
elements.clearDepartmentFilters.addEventListener("click", () => {
  elements.departmentFilters.forEach(input => { input.checked = false; });
  render();
});
elements.sheetSelect.addEventListener("change", () => importWorkbookSheet(elements.sheetSelect.value));
elements.skillsRange.addEventListener("input", () => elements.skillsOutput.value = `${elements.skillsRange.value} %`);
elements.reliabilityRange.addEventListener("input", () => elements.reliabilityOutput.value = `${elements.reliabilityRange.value} %`);
elements.cancelFeedbackButton.addEventListener("click", () => elements.feedbackDialog.close());
elements.cancelFeedbackAction.addEventListener("click", () => elements.feedbackDialog.close());

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
  person.photo = elements.photoUrl.value.trim();
  person.skills = Number(elements.skillsRange.value);
  person.reliability = Number(elements.reliabilityRange.value);
  person.departments = elements.personDepartments.filter(input => input.checked).map(input => input.value);
  person.notes = elements.notesInput.value.trim();
  if (supabaseClient && remoteUser && person.remoteId) {
    const { error } = await supabaseClient.from("workers").update({
      photo_url: person.photo,
      skills: person.skills,
      reliability: person.reliability,
      departments: person.departments,
      notes: person.notes
    }).eq("id", person.remoteId);
    if (error) {
      setMessage(`Profil se nepodařilo uložit: ${error.message}`, true);
      return;
    }
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
    note,
    createdAt: new Date().toISOString()
  };
  if (supabaseClient && remoteUser && person.remoteId) {
    const { data, error } = await supabaseClient.from("feedback").insert({
      worker_id: person.remoteId,
      kind: feedbackItem.type,
      note: feedbackItem.note,
      created_by: remoteUser.id
    }).select("id, kind, note, created_at").single();
    if (error) {
      elements.feedbackNote.setCustomValidity(error.message);
      elements.feedbackNote.reportValidity();
      return;
    }
    elements.feedbackNote.setCustomValidity("");
    feedbackItem.id = data.id;
    feedbackItem.createdAt = data.created_at;
  }
  if (!Array.isArray(person.feedback)) person.feedback = [];
  person.feedback.push(feedbackItem);
  saveState();
  elements.feedbackDialog.close();
  render();
  if (elements.dialog.open && elements.personId.value === person.id) renderFeedbackHistory(person);
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

async function handleSession(session) {
  if (!session?.user) {
    remoteUser = null;
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
  const [workersResult, attendanceResult, feedbackResult] = await Promise.all([
    supabaseClient.from("workers").select("*").eq("active", true).order("full_name"),
    supabaseClient.from("attendance_totals").select("worker_id, period, hours"),
    supabaseClient.from("feedback").select("id, worker_id, kind, note, created_at").order("created_at")
  ]);
  const error = workersResult.error || attendanceResult.error || feedbackResult.error;
  if (error) throw new Error(`Data se nepodařilo načíst: ${error.message}`);

  const latestPeriod = attendanceResult.data.reduce((latest, row) => !latest || row.period > latest ? row.period : latest, null);
  const hoursByWorker = new Map(attendanceResult.data
    .filter(row => row.period === latestPeriod)
    .map(row => [row.worker_id, Number(row.hours)]));
  const feedbackByWorker = new Map();
  feedbackResult.data.forEach(item => {
    if (!feedbackByWorker.has(item.worker_id)) feedbackByWorker.set(item.worker_id, []);
    feedbackByWorker.get(item.worker_id).push({
      id: item.id,
      type: item.kind,
      note: item.note,
      createdAt: item.created_at
    });
  });

  const remotePeople = {};
  workersResult.data.forEach(worker => {
    const id = slugify(worker.full_name);
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
      skills: worker.skills,
      reliability: worker.reliability,
      departments: worker.departments || [],
      notes: worker.notes || "",
      positive: 0,
      negative: 0,
      feedback: feedbackByWorker.get(worker.id) || [],
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

async function prepareWorkbook(file) {
  if (typeof XLSX === "undefined") throw new Error("Knihovna pro Excel se nenačetla. Zkontrolujte připojení k internetu a zkuste to znovu.");
  pendingWorkbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  pendingWorkbookName = file.name;
  const compatible = pendingWorkbook.SheetNames.filter(name => findWorkbookHeader(pendingWorkbook.Sheets[name]));
  if (!compatible.length) throw new Error("V Excelu nebyl nalezen list se sloupci Jméno a Počet zapsaných hodin.");
  elements.sheetSelect.replaceChildren(...compatible.map(name => new Option(name, name)));
  elements.sheetSelect.value = compatible[compatible.length - 1];
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
  elements.peopleCount.textContent = people.length;
  elements.hoursTotal.textContent = formatNumber(people.reduce((total, person) => total + Number(person.hours || 0), 0));
  elements.emptyState.hidden = people.length > 0;
  elements.peopleGrid.hidden = people.length === 0;
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

function score(person) { return feedbackCount(person, "positive") - feedbackCount(person, "negative"); }

function openPerson(id) {
  const person = state.people[id];
  elements.dialogTitle.textContent = person.name;
  elements.personId.value = id;
  elements.profileUserId.textContent = person.userId || "—";
  elements.profileRole.textContent = person.role || "—";
  elements.profileStatus.textContent = person.status || "—";
  elements.profileEmail.textContent = person.email || "—";
  elements.photoUrl.value = person.photo || "";
  elements.skillsRange.value = person.skills ?? 50;
  elements.skillsOutput.value = `${elements.skillsRange.value} %`;
  elements.reliabilityRange.value = person.reliability ?? 50;
  elements.reliabilityOutput.value = `${elements.reliabilityRange.value} %`;
  const trained = Array.isArray(person.departments) ? person.departments : [];
  elements.personDepartments.forEach(input => { input.checked = trained.includes(input.value); });
  elements.notesInput.value = person.notes || "";
  renderFeedbackHistory(person);
  elements.dialog.showModal();
}

function renderFeedbackHistory(person) {
  const feedback = Array.isArray(person.feedback) ? [...person.feedback].reverse() : [];
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
    const time = document.createElement("time");
    time.dateTime = item.createdAt;
    time.textContent = new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt));
    const note = document.createElement("p");
    note.textContent = item.note;
    entry.append(icon, time, note);
    list.append(entry);
  });
  elements.feedbackHistory.replaceChildren(list);
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `brigadnici-zaloha-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importBackup(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.people || typeof data.people !== "object") throw new Error("Neplatný formát zálohy.");
    state.people = data.people;
    state.lastImport = data.lastImport || null;
    saveState();
    render();
    setMessage(`Záloha ${file.name} byla načtena.`);
    elements.importBackupInput.value = "";
  } catch (error) {
    setMessage(error.message || "Zálohu se nepodařilo načíst.", true);
  }
}

function setMessage(text, error = false) {
  elements.importMessage.textContent = text;
  elements.importMessage.classList.toggle("error", error);
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
