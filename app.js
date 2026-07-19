const STORAGE_KEY = "brigadnici-dashboard-v1";
const VIEW_KEY = "brigadnici-dashboard-view";
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
let currentView = localStorage.getItem(VIEW_KEY) === "table" ? "table" : "cards";
const activeQuickFilters = new Set();

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
  syncRefreshButton: document.querySelector("#syncRefreshButton"),
  attendanceInput: document.querySelector("#attendanceInput"),
  dropZone: document.querySelector("#dropZone"),
  importPanel: document.querySelector("#importPanel"),
  importPanelToggle: document.querySelector("#importPanelToggle"),
  syncStatusTitle: document.querySelector("#syncStatusTitle"),
  syncStatusMeta: document.querySelector("#syncStatusMeta"),
  importMessage: document.querySelector("#importMessage"),
  toastText: document.querySelector("#toastText"),
  toastUndo: document.querySelector("#toastUndo"),
  sheetSelectWrap: document.querySelector("#sheetSelectWrap"),
  sheetSelect: document.querySelector("#sheetSelect"),
  peopleGrid: document.querySelector("#peopleGrid"),
  skeletonGrid: document.querySelector("#skeletonGrid"),
  peopleTableWrap: document.querySelector("#peopleTableWrap"),
  peopleTableBody: document.querySelector("#peopleTableBody"),
  cardViewButton: document.querySelector("#cardViewButton"),
  tableViewButton: document.querySelector("#tableViewButton"),
  emptyState: document.querySelector("#emptyState"),
  peopleCount: document.querySelector("#peopleCount"),
  hoursTotal: document.querySelector("#hoursTotal"),
  alertsPanel: document.querySelector("#alertsPanel"),
  alertsDrawer: document.querySelector("#alertsDrawer"),
  alertsToggle: document.querySelector("#alertsToggle"),
  alertsClose: document.querySelector("#alertsClose"),
  alertsHandleIcon: document.querySelector("#alertsHandleIcon"),
  alertsEarCount: document.querySelector("#alertsEarCount"),
  alertsList: document.querySelector("#alertsList"),
  alertsCount: document.querySelector("#alertsCount"),
  alertsEmpty: document.querySelector("#alertsEmpty"),
  currentPeriodLabel: document.querySelector("#currentPeriodLabel"),
  searchInput: document.querySelector("#searchInput"),
  sortSelect: document.querySelector("#sortSelect"),
  addWorkerButton: document.querySelector("#addWorkerButton"),
  departmentFilters: [...document.querySelectorAll(".department-filter")],
  departmentMatchMode: document.querySelector("#departmentMatchMode"),
  clearDepartmentFilters: document.querySelector("#clearDepartmentFilters"),
  quickFilters: [...document.querySelectorAll(".quick-filter")],
  clearQuickFilters: document.querySelector("#clearQuickFilters"),
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
  profileEmail: document.querySelector("#profileEmail"),
  profileHours60: document.querySelector("#profileHours60"),
  feedbackHistory: document.querySelector("#feedbackHistory"),
  feedbackBreakdown: document.querySelector("#feedbackBreakdown"),
  auditHistory: document.querySelector("#auditHistory"),
  profileTabs: [...document.querySelectorAll("[data-profile-tab]")],
  profilePanels: [...document.querySelectorAll("[data-profile-panel]")],
  feedbackDialog: document.querySelector("#feedbackDialog"),
  feedbackForm: document.querySelector("#feedbackForm"),
  feedbackDialogTitle: document.querySelector("#feedbackDialogTitle"),
  feedbackKindBadge: document.querySelector("#feedbackKindBadge"),
  feedbackPersonId: document.querySelector("#feedbackPersonId"),
  feedbackType: document.querySelector("#feedbackType"),
  feedbackCategoryInputs: [...document.querySelectorAll('input[name="feedbackCategory"]')],
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
  sendAppFeedback: document.querySelector("#sendAppFeedback"),
  addWorkerDialog: document.querySelector("#addWorkerDialog"),
  addWorkerForm: document.querySelector("#addWorkerForm"),
  newWorkerName: document.querySelector("#newWorkerName"),
  newWorkerId: document.querySelector("#newWorkerId"),
  newWorkerEmail: document.querySelector("#newWorkerEmail"),
  addWorkerPassword: document.querySelector("#addWorkerPassword"),
  addWorkerStatus: document.querySelector("#addWorkerStatus"),
  confirmAddWorker: document.querySelector("#confirmAddWorker"),
  closeAddWorker: document.querySelector("#closeAddWorker"),
  cancelAddWorker: document.querySelector("#cancelAddWorker"),
  deleteWorkerButton: document.querySelector("#deleteWorkerButton"),
  deleteWorkerDialog: document.querySelector("#deleteWorkerDialog"),
  deleteWorkerForm: document.querySelector("#deleteWorkerForm"),
  deleteWorkerName: document.querySelector("#deleteWorkerName"),
  deleteWorkerPassword: document.querySelector("#deleteWorkerPassword"),
  deleteWorkerStatus: document.querySelector("#deleteWorkerStatus"),
  confirmDeleteWorker: document.querySelector("#confirmDeleteWorker"),
  closeDeleteWorker: document.querySelector("#closeDeleteWorker"),
  cancelDeleteWorker: document.querySelector("#cancelDeleteWorker"),
  inactiveWorkersButton: document.querySelector("#inactiveWorkersButton"),
  inactiveWorkersDialog: document.querySelector("#inactiveWorkersDialog"),
  inactiveWorkersForm: document.querySelector("#inactiveWorkersForm"),
  inactiveWorkersList: document.querySelector("#inactiveWorkersList"),
  inactiveWorkersEmpty: document.querySelector("#inactiveWorkersEmpty"),
  closeInactiveWorkers: document.querySelector("#closeInactiveWorkers"),
  restoreWorkerConfirm: document.querySelector("#restoreWorkerConfirm"),
  restoreWorkerName: document.querySelector("#restoreWorkerName"),
  restoreWorkerPassword: document.querySelector("#restoreWorkerPassword"),
  restoreWorkerStatus: document.querySelector("#restoreWorkerStatus"),
  cancelRestoreWorker: document.querySelector("#cancelRestoreWorker"),
  confirmRestoreWorker: document.querySelector("#confirmRestoreWorker")
};

elements.loginForm.addEventListener("submit", signInWithPassword);
elements.themeToggles.forEach(button => button.addEventListener("click", toggleTheme));
updateThemeControls();
elements.signOutButton.addEventListener("click", async () => {
  if (supabaseClient) await supabaseClient.auth.signOut();
});
elements.googleSheetsButton.addEventListener("click", () => syncGoogleSheets(false));
elements.syncRefreshButton.addEventListener("click", () => syncGoogleSheets(false));
elements.importPanelToggle.addEventListener("click", () => setImportCollapsed(!elements.importPanel.classList.contains("is-collapsed")));
elements.cardViewButton.addEventListener("click", () => setViewMode("cards"));
elements.tableViewButton.addEventListener("click", () => setViewMode("table"));
elements.profileTabs.forEach(button => button.addEventListener("click", () => activateProfileTab(button.dataset.profileTab)));
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
elements.personDepartments.forEach(input => input.addEventListener("change", saveDepartmentTraining));
elements.notesInput.addEventListener("blur", saveDetailNotes);
elements.clearNotesButton.addEventListener("click", () => {
  elements.notesInput.value = "";
  void saveDetailNotes();
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
elements.quickFilters.forEach(button => button.addEventListener("click", () => toggleQuickFilter(button)));
elements.clearQuickFilters.addEventListener("click", clearQuickFilters);
elements.addWorkerButton.addEventListener("click", openAddWorkerDialog);
elements.closeAddWorker.addEventListener("click", () => elements.addWorkerDialog.close());
elements.cancelAddWorker.addEventListener("click", () => elements.addWorkerDialog.close());
elements.addWorkerForm.addEventListener("submit", addWorker);
elements.deleteWorkerButton.addEventListener("click", openDeleteWorkerDialog);
elements.closeDeleteWorker.addEventListener("click", () => elements.deleteWorkerDialog.close());
elements.cancelDeleteWorker.addEventListener("click", () => elements.deleteWorkerDialog.close());
elements.deleteWorkerForm.addEventListener("submit", removeWorker);
elements.addWorkerDialog.addEventListener("click", closeDialogFromBackdrop);
elements.deleteWorkerDialog.addEventListener("click", closeDialogFromBackdrop);
elements.inactiveWorkersButton.addEventListener("click", openInactiveWorkers);
elements.closeInactiveWorkers.addEventListener("click", () => elements.inactiveWorkersDialog.close());
elements.cancelRestoreWorker.addEventListener("click", cancelRestoreWorker);
elements.inactiveWorkersForm.addEventListener("submit", restoreWorker);
elements.inactiveWorkersDialog.addEventListener("click", closeDialogFromBackdrop);

["dragenter", "dragover"].forEach(type => elements.dropZone.addEventListener(type, (event) => {
  event.preventDefault();
  elements.dropZone.classList.add("is-dragging");
}));
["dragleave", "drop"].forEach(type => elements.dropZone.addEventListener(type, (event) => {
  event.preventDefault();
  elements.dropZone.classList.remove("is-dragging");
}));
elements.dropZone.addEventListener("drop", (event) => importAttendance(event.dataTransfer.files[0]));

elements.feedbackForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const person = state.people[elements.feedbackPersonId.value];
  const note = elements.feedbackNote.value.trim();
  if (!person || !note) return;
  const feedbackItem = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: elements.feedbackType.value,
    category: elements.feedbackCategoryInputs.find(input => input.checked)?.value,
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

function openAddWorkerDialog() {
  elements.addWorkerForm.reset();
  setDialogStatus(elements.addWorkerStatus, "");
  elements.addWorkerDialog.showModal();
  elements.newWorkerName.focus();
}

function openDeleteWorkerDialog() {
  const person = state.people[elements.personId.value];
  if (!person) return;
  elements.deleteWorkerForm.reset();
  elements.deleteWorkerName.textContent = person.name;
  elements.deleteWorkerDialog.dataset.personId = person.id;
  setDialogStatus(elements.deleteWorkerStatus, "");
  elements.deleteWorkerDialog.showModal();
  elements.deleteWorkerPassword.focus();
}

async function verifyCurrentPassword(password) {
  if (!supabaseClient || !remoteUser?.email) throw new Error("Přihlášení není aktivní.");
  const { error } = await supabaseClient.auth.signInWithPassword({ email: remoteUser.email, password });
  if (error) throw new Error("Zadané heslo není správné.");
}

async function addWorker(event) {
  event.preventDefault();
  const name = elements.newWorkerName.value.trim();
  const externalId = elements.newWorkerId.value.trim();
  const email = elements.newWorkerEmail.value.trim() || null;
  elements.confirmAddWorker.disabled = true;
  setDialogStatus(elements.addWorkerStatus, "Ověřuji heslo…");
  try {
    await verifyCurrentPassword(elements.addWorkerPassword.value);
    setDialogStatus(elements.addWorkerStatus, "Vytvářím kartu…");
    const { data: createdWorker, error } = await supabaseClient.from("workers").insert({
      external_user_id: externalId,
      full_name: name,
      email,
      role: "Sales Support",
      status: "Aktivní",
      active: true,
      skills: 0,
      reliability: 100,
      departments: [],
      aliases: [],
      notes: ""
    }).select("id").single();
    if (error) {
      if (error.code === "23505") throw new Error("Brigádník s tímto interním ID už existuje.");
      throw new Error(error.message);
    }
    await loadRemoteState();
    render();
    elements.addWorkerDialog.close();
    setMessage(`Karta pro ${name} byla vytvořena.`, false, async () => {
      const { error: undoError } = await supabaseClient.from("workers").update({ active: false, status: "Neaktivní" }).eq("id", createdWorker.id);
      if (undoError) throw undoError;
      await loadRemoteState();
      render();
    });
  } catch (error) {
    setDialogStatus(elements.addWorkerStatus, error.message || "Kartu se nepodařilo vytvořit.", true);
  } finally {
    elements.confirmAddWorker.disabled = false;
    elements.addWorkerPassword.value = "";
  }
}

async function removeWorker(event) {
  event.preventDefault();
  const person = state.people[elements.deleteWorkerDialog.dataset.personId];
  if (!person?.remoteId) return;
  elements.confirmDeleteWorker.disabled = true;
  setDialogStatus(elements.deleteWorkerStatus, "Ověřuji heslo…");
  try {
    await verifyCurrentPassword(elements.deleteWorkerPassword.value);
    setDialogStatus(elements.deleteWorkerStatus, "Odebírám z přehledu…");
    const { error } = await supabaseClient.from("workers").update({ active: false, status: "Neaktivní" }).eq("id", person.remoteId);
    if (error) throw new Error(error.message);
    delete state.people[person.id];
    saveState();
    elements.deleteWorkerDialog.close();
    elements.dialog.close();
    render();
    setMessage(`${person.name} byl odebrán z aktivního přehledu.`, false, async () => {
      const { error: undoError } = await supabaseClient.from("workers").update({ active: true, status: "Aktivní" }).eq("id", person.remoteId);
      if (undoError) throw undoError;
      await loadRemoteState();
      render();
    });
  } catch (error) {
    setDialogStatus(elements.deleteWorkerStatus, error.message || "Brigádníka se nepodařilo odebrat.", true);
  } finally {
    elements.confirmDeleteWorker.disabled = false;
    elements.deleteWorkerPassword.value = "";
  }
}

async function openInactiveWorkers() {
  elements.inactiveWorkersList.replaceChildren();
  elements.inactiveWorkersEmpty.hidden = true;
  cancelRestoreWorker();
  elements.inactiveWorkersDialog.showModal();
  const { data, error } = await supabaseClient.from("workers")
    .select("id, external_user_id, full_name, email")
    .eq("active", false)
    .order("full_name");
  if (error) {
    elements.inactiveWorkersEmpty.hidden = false;
    elements.inactiveWorkersEmpty.textContent = `Seznam se nepodařilo načíst: ${error.message}`;
    return;
  }
  elements.inactiveWorkersEmpty.textContent = "Žádní neaktivní brigádníci.";
  elements.inactiveWorkersEmpty.hidden = data.length > 0;
  elements.inactiveWorkersList.replaceChildren(...data.map(worker => {
    const row = document.createElement("div");
    row.className = "inactive-worker-row";
    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = worker.full_name;
    const meta = document.createElement("small");
    meta.textContent = [worker.external_user_id, worker.email].filter(Boolean).join(" · ");
    info.append(name, meta);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-secondary compact-button";
    button.textContent = "Obnovit";
    button.addEventListener("click", () => selectWorkerForRestore(worker));
    row.append(info, button);
    return row;
  }));
}

function selectWorkerForRestore(worker) {
  elements.inactiveWorkersDialog.dataset.workerId = worker.id;
  elements.inactiveWorkersDialog.dataset.workerName = worker.full_name;
  elements.restoreWorkerName.textContent = worker.full_name;
  elements.restoreWorkerConfirm.hidden = false;
  elements.cancelRestoreWorker.hidden = false;
  elements.confirmRestoreWorker.hidden = false;
  elements.restoreWorkerPassword.value = "";
  setDialogStatus(elements.restoreWorkerStatus, "");
  elements.restoreWorkerPassword.focus();
}

function cancelRestoreWorker() {
  delete elements.inactiveWorkersDialog.dataset.workerId;
  delete elements.inactiveWorkersDialog.dataset.workerName;
  elements.restoreWorkerConfirm.hidden = true;
  elements.cancelRestoreWorker.hidden = true;
  elements.confirmRestoreWorker.hidden = true;
  elements.restoreWorkerPassword.value = "";
  setDialogStatus(elements.restoreWorkerStatus, "");
}

async function restoreWorker(event) {
  event.preventDefault();
  const workerId = elements.inactiveWorkersDialog.dataset.workerId;
  const workerName = elements.inactiveWorkersDialog.dataset.workerName;
  if (!workerId) return;
  elements.confirmRestoreWorker.disabled = true;
  setDialogStatus(elements.restoreWorkerStatus, "Ověřuji heslo…");
  try {
    await verifyCurrentPassword(elements.restoreWorkerPassword.value);
    const { error } = await supabaseClient.from("workers").update({ active: true, status: "Aktivní" }).eq("id", workerId);
    if (error) throw error;
    await loadRemoteState();
    render();
    elements.inactiveWorkersDialog.close();
    setMessage(`${workerName} byl obnoven.`, false, async () => {
      const { error: undoError } = await supabaseClient.from("workers").update({ active: false, status: "Neaktivní" }).eq("id", workerId);
      if (undoError) throw undoError;
      await loadRemoteState();
      render();
    });
  } catch (error) {
    setDialogStatus(elements.restoreWorkerStatus, error.message || "Brigádníka se nepodařilo obnovit.", true);
  } finally {
    elements.confirmRestoreWorker.disabled = false;
    elements.restoreWorkerPassword.value = "";
  }
}

function setDialogStatus(element, text, error = false) {
  element.textContent = text;
  element.classList.toggle("error", error);
}

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
    button.querySelector(".theme-icon").innerHTML = dark
      ? '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
      : '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.4A8 8 0 0 1 8.6 4 8 8 0 1 0 20 15.4Z"/></svg>';
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
  if (input === elements.reliabilityRange) input.style.setProperty("--metric-color", reliabilityColor(input.value));
}

function activateProfileTab(tab) {
  elements.profileTabs.forEach(button => {
    const active = button.dataset.profileTab === tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  elements.profilePanels.forEach(panel => {
    const active = panel.dataset.profilePanel === tab;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  });
}

function setImportCollapsed(collapsed) {
  elements.importPanel.classList.toggle("is-collapsed", collapsed);
  elements.importPanelToggle.setAttribute("aria-expanded", String(!collapsed));
  elements.importPanelToggle.querySelector("span").textContent = collapsed ? "Rozbalit" : "Sbalit";
}

function setViewMode(view) {
  currentView = view;
  localStorage.setItem(VIEW_KEY, view);
  elements.cardViewButton.classList.toggle("is-active", view === "cards");
  elements.tableViewButton.classList.toggle("is-active", view === "table");
  render();
}

function previewDepartmentSkills() {
  const trainedCount = elements.personDepartments.filter(input => input.checked).length;
  elements.skillsRange.value = Math.round((trainedCount / DEPARTMENTS.length) * 100);
  updateRangeControl(elements.skillsRange, elements.skillsOutput);
}

async function saveDepartmentTraining() {
  const person = state.people[elements.personId.value];
  if (!person) return;
  const previous = [...(person.departments || [])];
  const next = elements.personDepartments.filter(input => input.checked).map(input => input.value);
  previewDepartmentSkills();
  if (JSON.stringify(previous) === JSON.stringify(next)) return;
  const metrics = calculateAutomaticMetrics(person.feedback, next);
  elements.personDepartments.forEach(input => { input.disabled = true; });
  try {
    if (supabaseClient && remoteUser && person.remoteId) {
      const { error } = await supabaseClient.from("workers").update({ departments: next, skills: metrics.skills }).eq("id", person.remoteId);
      if (error) throw error;
      await refreshWorkerAudit(person);
    }
    person.departments = next;
    person.skills = metrics.skills;
    saveState();
    render();
    setMessage("Zaškolení bylo uloženo.", false, () => restoreDepartments(person, previous));
  } catch (error) {
    elements.personDepartments.forEach(input => { input.checked = previous.includes(input.value); });
    previewDepartmentSkills();
    setMessage(`Zaškolení se nepodařilo uložit: ${error.message}`, true);
  } finally {
    elements.personDepartments.forEach(input => { input.disabled = false; });
  }
}

async function restoreDepartments(person, departments) {
  const metrics = calculateAutomaticMetrics(person.feedback, departments);
  if (supabaseClient && remoteUser && person.remoteId) {
    const { error } = await supabaseClient.from("workers").update({ departments, skills: metrics.skills }).eq("id", person.remoteId);
    if (error) throw error;
  }
  person.departments = [...departments];
  person.skills = metrics.skills;
  saveState();
  if (elements.dialog.open && elements.personId.value === person.id) {
    elements.personDepartments.forEach(input => { input.checked = departments.includes(input.value); });
    elements.skillsRange.value = metrics.skills;
    updateRangeControl(elements.skillsRange, elements.skillsOutput);
  }
  render();
}

async function saveDetailNotes() {
  const person = state.people[elements.personId.value];
  if (!person) return;
  const previous = person.notes || "";
  const next = elements.notesInput.value.trim();
  if (previous === next) return;
  try {
    if (supabaseClient && remoteUser && person.remoteId) {
      const { error } = await supabaseClient.from("workers").update({ notes: next }).eq("id", person.remoteId);
      if (error) throw error;
      await refreshWorkerAudit(person);
    }
    person.notes = next;
    elements.clearNotesButton.hidden = !next;
    saveState();
    render();
    setMessage("Poznámka byla uložena.", false, () => restoreNote(person, previous));
  } catch (error) {
    elements.notesInput.value = previous;
    setMessage(`Poznámku se nepodařilo uložit: ${error.message}`, true);
  }
}

async function restoreNote(person, note) {
  if (supabaseClient && remoteUser && person.remoteId) {
    const { error } = await supabaseClient.from("workers").update({ notes: note }).eq("id", person.remoteId);
    if (error) throw error;
  }
  person.notes = note;
  saveState();
  if (elements.dialog.open && elements.personId.value === person.id) {
    elements.notesInput.value = note;
    elements.clearNotesButton.hidden = !note;
  }
  render();
}

function toggleQuickFilter(button) {
  const filter = button.dataset.quickFilter;
  if (activeQuickFilters.has(filter)) activeQuickFilters.delete(filter);
  else activeQuickFilters.add(filter);
  button.classList.toggle("is-active", activeQuickFilters.has(filter));
  elements.clearQuickFilters.hidden = activeQuickFilters.size === 0;
  render();
}

function clearQuickFilters() {
  activeQuickFilters.clear();
  elements.quickFilters.forEach(button => button.classList.remove("is-active"));
  elements.clearQuickFilters.hidden = true;
  render();
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
      hours60: state.people[id]?.hours60 || 0,
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
  elements.syncRefreshButton.disabled = true;
  elements.syncRefreshButton.classList.add("is-loading");
  button.textContent = "Načítám…";
  elements.syncStatusTitle.textContent = "Načítám změny…";
  elements.syncStatusMeta.textContent = "Kontroluji aktuální data v Google Sheets";
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
    elements.syncStatusTitle.textContent = "Synchronizace se nezdařila";
    elements.syncStatusMeta.textContent = "Kliknutím na ikonu ji můžete zopakovat";
    setMessage(`${automatic ? "Automatická synchronizace: " : ""}${error.message || "Google tabulku se nepodařilo načíst."}`, true);
  } finally {
    button.disabled = false;
    elements.syncRefreshButton.disabled = false;
    elements.syncRefreshButton.classList.remove("is-loading");
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
  const imported = await importWorkbookSheet(elements.sheetSelect.value);
  if (requireCurrentMonth && !imported) throw new Error("Aktuální list se nepodařilo načíst.");
  if (imported) applyRolling60Hours(pendingWorkbook);
}

function applyRolling60Hours(workbook) {
  const today = startOfDay(new Date());
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - 59);
  const totals = new Map();

  workbook.SheetNames.forEach(sheetName => {
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: "" });
    for (let rowIndex = 0; rowIndex < matrix.length; rowIndex += 1) {
      const nextRowLabel = normalize(matrix[rowIndex + 1]?.[0]).replace(/:$/, "");
      if (nextRowLabel !== "urceni") continue;
      const date = excelCellDate(matrix[rowIndex].slice(0, 8));
      if (!date || date < cutoff || date > today) continue;
      for (let shiftRow = rowIndex + 2; shiftRow < matrix.length; shiftRow += 1) {
        const row = matrix[shiftRow];
        if (row.some(cell => normalize(cell).startsWith("celkem hod"))) break;
        if (!/^\d{1,2}(?::\d{2})?\s*-\s*\d{1,2}(?::\d{2})?\s*h?$/.test(normalize(row[0]))) continue;
        row.slice(1, 7).forEach(cell => {
          const worker = findActiveWorker(String(cell || "").trim());
          if (!worker) return;
          totals.set(worker.id, (totals.get(worker.id) || 0) + 1);
        });
      }
    }
  });

  Object.values(state.people).forEach(person => { person.hours60 = totals.get(person.id) || 0; });
  saveState();
  render();
}

function excelCellDate(cells) {
  for (const value of cells) {
    if (value instanceof Date && !Number.isNaN(value.valueOf())) return startOfDay(value);
    if (typeof value === "number" && value > 30000 && value < 70000) {
      const parsed = XLSX.SSF.parse_date_code(value);
      if (parsed) return new Date(parsed.y, parsed.m - 1, parsed.d);
    }
    if (typeof value === "string" && /^\d{1,2}[./]\d{1,2}[./]\d{2,4}$/.test(value.trim())) {
      const [day, month, rawYear] = value.trim().split(/[./]/).map(Number);
      const year = rawYear < 100 ? 2000 + rawYear : rawYear;
      return new Date(year, month - 1, day);
    }
  }
  return null;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
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
  if (!pendingWorkbook || !sheetName) return false;
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
    return true;
  } catch (error) {
    setMessage(error.message || "List se nepodařilo načíst.", true);
    return false;
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
  setImportCollapsed(true);
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
    if (activeQuickFilters.has("no-training") && (person.departments || []).length > 0) return false;
    if (activeQuickFilters.has("no-note") && String(person.notes || "").trim()) return false;
    if (activeQuickFilters.has("low-attendance") && Number(person.reliability) >= 75) return false;
    if (activeQuickFilters.has("negative") && feedbackCount(person, "negative") === 0) return false;
    if (activeQuickFilters.has("zero-hours") && Number(person.hours || 0) !== 0) return false;
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
  renderPeopleTable(people);
  elements.skeletonGrid.hidden = true;
  elements.peopleGrid.hidden = people.length === 0 || currentView !== "cards";
  elements.peopleTableWrap.hidden = people.length === 0 || currentView !== "table";
  elements.cardViewButton.classList.toggle("is-active", currentView === "cards");
  elements.tableViewButton.classList.toggle("is-active", currentView === "table");
  elements.currentPeriodLabel.textContent = new Intl.DateTimeFormat("cs-CZ", { month: "long", year: "numeric" }).format(new Date(currentImportPeriod));
  elements.peopleCount.textContent = people.length;
  elements.hoursTotal.textContent = formatNumber(people.reduce((total, person) => total + Number(person.hours || 0), 0));
  elements.emptyState.hidden = people.length > 0;
  renderSyncStatus();
  renderAlerts();
}

function renderSyncStatus() {
  const period = new Intl.DateTimeFormat("cs-CZ", { month: "long", year: "numeric" }).format(new Date(currentImportPeriod));
  if (!state.lastImport) {
    elements.syncStatusTitle.textContent = "Docházka není načtená";
    elements.syncStatusMeta.textContent = "Připraveno k synchronizaci";
    return;
  }
  const imported = new Date(state.lastImport);
  const today = imported.toDateString() === new Date().toDateString() ? "dnes" : new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric" }).format(imported);
  elements.syncStatusTitle.textContent = `Docházka · ${period}`;
  elements.syncStatusMeta.textContent = `Synchronizováno ${today} v ${new Intl.DateTimeFormat("cs-CZ", { hour: "2-digit", minute: "2-digit" }).format(imported)}`;
}

function renderPeopleTable(people) {
  elements.peopleTableBody.replaceChildren(...people.map(person => {
    const row = document.createElement("tr");
    row.tabIndex = 0;
    const departments = Array.isArray(person.departments) && person.departments.length ? person.departments.join(", ") : "—";
    const rating = score(person);
    row.innerHTML = `<td><strong></strong><small></small></td><td class="table-hours"><strong>${formatNumber(person.hours || 0)} h</strong><small>${formatNumber(person.hours60 || 0)} h / 60 dní</small></td><td>${metricCell(person.skills, "skills")}</td><td>${metricCell(person.reliability, "reliability")}</td><td class="table-departments"></td><td class="table-note"><textarea class="inline-note" rows="2" placeholder="Přidat poznámku…" aria-label="Obecná poznámka"></textarea></td><td class="table-score"><div class="table-feedback"><button class="feedback-button positive" type="button" aria-label="Přidat palec nahoru">👍 <span>0</span></button><button class="feedback-button negative" type="button" aria-label="Přidat palec dolů">👎 <span>0</span></button><strong class="score"></strong></div></td>`;
    row.querySelector("strong").textContent = person.name;
    row.querySelector("small").textContent = person.email || "Bez e-mailu";
    row.querySelector(".table-departments").textContent = departments;
    setupInlineNote(row.querySelector(".inline-note"), person);
    const positive = row.querySelector(".feedback-button.positive");
    const negative = row.querySelector(".feedback-button.negative");
    positive.querySelector("span").textContent = feedbackCount(person, "positive");
    negative.querySelector("span").textContent = feedbackCount(person, "negative");
    positive.addEventListener("click", event => { event.stopPropagation(); openFeedback(person.id, "positive"); });
    negative.addEventListener("click", event => { event.stopPropagation(); openFeedback(person.id, "negative"); });
    const scoreCell = row.querySelector(".score");
    scoreCell.textContent = rating > 0 ? `+${rating}` : String(rating);
    scoreCell.classList.toggle("positive-score", rating > 0);
    scoreCell.classList.toggle("negative-score", rating < 0);
    row.addEventListener("click", event => { if (!event.target.closest("textarea, button, input, select")) openPerson(person.id); });
    row.addEventListener("keydown", event => { if (event.target === row && event.key === "Enter") openPerson(person.id); });
    return row;
  }));
}

function metricCell(value, type) {
  const safeValue = clampMetric(value);
  const color = type === "reliability" ? reliabilityColor(safeValue) : "var(--brand)";
  return `<span class="table-metric"><span>${safeValue} %</span><i><b style="width:${safeValue}%;background:${color}"></b></i></span>`;
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
  elements.alertsDrawer.classList.toggle("is-open", open);
  elements.alertsPanel.classList.toggle("is-open", open);
  elements.alertsToggle.classList.toggle("is-open", open);
  elements.alertsPanel.setAttribute("aria-hidden", String(!open));
  elements.alertsToggle.setAttribute("aria-expanded", String(open));
  elements.alertsHandleIcon.textContent = open ? "‹" : "›";
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
  card.querySelector(".hours-60-value").textContent = `${formatNumber(person.hours60 || 0)} h`;
  renderDepartmentBadges(card.querySelector(".department-badges"), person.departments);
  setMetric(card, "skills", person.skills);
  setMetric(card, "reliability", person.reliability);
  setupInlineNote(card.querySelector(".inline-note"), person);
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

function setupInlineNote(input, person) {
  input.value = person.notes || "";
  input.addEventListener("click", event => event.stopPropagation());
  input.addEventListener("keydown", event => {
    event.stopPropagation();
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) input.blur();
  });
  input.addEventListener("blur", () => saveInlineNote(person, input));
}

async function saveInlineNote(person, input) {
  const previous = person.notes || "";
  const next = input.value.trim();
  if (next === previous) return;
  input.classList.add("is-saving");
  input.disabled = true;
  if (supabaseClient && remoteUser && person.remoteId) {
    const { error } = await supabaseClient.from("workers").update({ notes: next }).eq("id", person.remoteId);
    if (error) {
      input.value = previous;
      input.disabled = false;
      input.classList.remove("is-saving");
      input.classList.add("has-error");
      setMessage(`Poznámku se nepodařilo uložit: ${error.message}`, true);
      return;
    }
    await refreshWorkerAudit(person);
  }
  person.notes = next;
  saveState();
  input.disabled = false;
  input.classList.remove("is-saving", "has-error");
  input.classList.add("is-saved");
  setTimeout(() => input.classList.remove("is-saved"), 1200);
  setMessage("Poznámka byla uložena.", false, () => restoreNote(person, previous));
}

function setMetric(card, key, value = 50) {
  const safeValue = Math.min(100, Math.max(0, Number(value)));
  card.querySelector(`.${key}-value`).textContent = `${safeValue} %`;
  const bar = card.querySelector(`.${key}-bar`);
  bar.style.width = `${safeValue}%`;
  if (key === "reliability") bar.style.background = reliabilityColor(safeValue);
}

function reliabilityColor(value) {
  const metric = clampMetric(value);
  if (metric < 25) return "#dc2626";
  if (metric < 50) return "#f97316";
  if (metric < 75) return "#eab308";
  return "#16a34a";
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
  elements.feedbackCategoryInputs.forEach(input => { input.checked = false; });
  elements.feedbackNote.value = "";
  elements.feedbackDialogTitle.textContent = person.name;
  elements.feedbackKindBadge.textContent = type === "positive" ? "👍 Palec nahoru" : "👎 Palec dolů";
  elements.feedbackKindBadge.className = `feedback-kind-badge ${type}`;
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
  activateProfileTab("overview");
  elements.dialogTitle.textContent = person.name;
  elements.personId.value = id;
  elements.profileUserId.textContent = person.userId || "—";
  elements.profileRole.textContent = person.role || "—";
  elements.profileEmail.textContent = person.email || "—";
  elements.profileHours60.textContent = `${formatNumber(person.hours60 || 0)} hodin`;
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
  elements.dialog.querySelector('[data-profile-tab="overview"]').focus({ preventScroll: true });
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

function setMessage(text, error = false, undoAction = null) {
  clearTimeout(messageTimer);
  elements.toastText.textContent = text;
  elements.importMessage.classList.toggle("error", error);
  elements.importMessage.hidden = !text;
  elements.toastUndo.hidden = !undoAction || error;
  elements.toastUndo.disabled = false;
  elements.toastUndo.onclick = undoAction ? async () => {
    clearTimeout(messageTimer);
    elements.toastUndo.disabled = true;
    elements.toastText.textContent = "Vracím změnu…";
    try {
      await undoAction();
      setMessage("Změna byla vrácena.");
    } catch (undoError) {
      setMessage(`Změnu se nepodařilo vrátit: ${undoError.message}`, true);
    }
  } : null;
  if (text) {
    messageTimer = setTimeout(() => {
      elements.importMessage.hidden = true;
    }, undoAction ? 7000 : (error ? 8000 : 4000));
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
