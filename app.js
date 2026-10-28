import {
  DEPARTMENTS, SALES_ASR_TARGET, addMonths, addRosterOnlyWorkers, automaticWorkerId, calculateAutomaticMetrics,
  calculateFreeShiftHours, clampMetric, dateKey, firstDayOfMonth, forEachShiftCell, formatShiftDepartment,
  incompleteOnboardingTasks, isIgnoredShiftName, isLikelyWorkerName, matchesSearch, median, normalizeText,
  parseCsv, parseHours, periodFromSheetName, recentPeriods, slugFromName, startOfDay, stripTrailingTime,
  summarizeSales, toCsv
} from "./logic.mjs?v=86";

const STORAGE_KEY = "brigadnici-dashboard-v1";
const VIEW_KEY = "brigadnici-dashboard-view";
const DISMISSED_ALERTS_KEY = "brigadnici-dismissed-alerts";
const SORT_KEY = "brigadnici-dashboard-sort";
const SORT_OPTIONS = {
  name: { key: "name", direction: "asc" },
  "hours-desc": { key: "hours", direction: "desc" },
  "hours-asc": { key: "hours", direction: "asc" },
  "hours60-desc": { key: "hours60", direction: "desc" },
  "rating-desc": { key: "rating", direction: "desc" },
  "rating-asc": { key: "rating", direction: "asc" },
  "reliability-asc": { key: "reliability", direction: "asc" }
};
const GOOGLE_SHEET_ID = "1mEke18XDi76U_92N_HifkWSFlrsrTWs962_yPWjuYDA";
const GOOGLE_SHEET_EXPORT_URL = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/export?format=xlsx`;
let pendingWorkbook = null;
let pendingWorkbookName = "";
let currentImportPeriod = firstDayOfMonth(new Date());
let supabaseClient = null;
let remoteUser = null;
let messageTimer = null;
let loaderHideTimer = null;
let sessionLoadPromise = null;
let hasAutoSynced = false;
let workerNotesTableAvailable = true;
let salesDaysTableAvailable = true;
let onboardingTableAvailable = true;
let salesDays = [];
let visibleSalesRows = [];
let visibleTeamPeople = [];
const nextShiftsByPerson = new Map();
let currentView = localStorage.getItem(VIEW_KEY) === "table" ? "table" : "cards";
let currentSort = loadSavedSort();
let currentSalesSort = { key: "date", direction: "desc" };
const activeQuickFilters = new Set();
const dismissedAlertSignatures = new Set(loadDismissedAlerts());
let visibleAlertSignatures = [];
let teamRenderFrame = 0;
let monthRosterKnown = false;
const monthRosterPersonIds = new Set();
const monthRosterRemoteIds = new Set();

const state = loadState();
const elements = {
  authGate: document.querySelector("#authGate"),
  loginForm: document.querySelector("#loginForm"),
  loginEmail: document.querySelector("#loginEmail"),
  loginPassword: document.querySelector("#loginPassword"),
  loginButton: document.querySelector("#loginButton"),
  themeToggles: [...document.querySelectorAll("[data-theme-toggle]")],
  authMessage: document.querySelector("#authMessage"),
  appLoader: document.querySelector("#appLoader"),
  appLoaderStatus: document.querySelector("#appLoaderStatus"),
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
  monthPickerButton: document.querySelector("#monthPickerButton"),
  monthPickerValue: document.querySelector("#monthPickerValue"),
  monthPickerMenu: document.querySelector("#monthPickerMenu"),
  onboardingEditor: document.querySelector("#onboardingEditor"),
  onboardingTraining: document.querySelector("#onboardingTraining"),
  onboardingContracts: document.querySelector("#onboardingContracts"),
  onboardingTaxes: document.querySelector("#onboardingTaxes"),
  onboardingAttribution: document.querySelector("#onboardingAttribution"),
  peopleGrid: document.querySelector("#peopleGrid"),
  skeletonGrid: document.querySelector("#skeletonGrid"),
  peopleTableWrap: document.querySelector("#peopleTableWrap"),
  peopleTableBody: document.querySelector("#peopleTableBody"),
  cardViewButton: document.querySelector("#cardViewButton"),
  tableViewButton: document.querySelector("#tableViewButton"),
  emptyState: document.querySelector("#emptyState"),
  emptyStateText: document.querySelector("#emptyStateText"),
  resetAllFilters: document.querySelector("#resetAllFilters"),
  attendancePeople: document.querySelector("#attendancePeople"),
  attendanceHours: document.querySelector("#attendanceHours"),
  alertsPanel: document.querySelector("#alertsPanel"),
  alertsDrawer: document.querySelector("#alertsDrawer"),
  alertsToggle: document.querySelector("#alertsToggle"),
  alertsClose: document.querySelector("#alertsClose"),
  alertsClear: document.querySelector("#alertsClear"),
  alertsHandleIcon: document.querySelector("#alertsHandleIcon"),
  alertsEarCount: document.querySelector("#alertsEarCount"),
  alertsList: document.querySelector("#alertsList"),
  alertsCount: document.querySelector("#alertsCount"),
  alertsSummary: document.querySelector("#alertsSummary"),
  alertsEmpty: document.querySelector("#alertsEmpty"),
  searchInput: document.querySelector("#searchInput"),
  clearSearchButton: document.querySelector("#clearSearchButton"),
  visiblePeopleKpi: document.querySelector("#visiblePeopleKpi"),
  averageSkillsKpi: document.querySelector("#averageSkillsKpi"),
  plannedHoursKpi: document.querySelector("#plannedHoursKpi"),
  freeHoursKpi: document.querySelector("#freeHoursKpi"),
  freeHoursShareKpi: document.querySelector("#freeHoursShareKpi"),
  sortSelect: document.querySelector("#sortSelect"),
  exportTeamButton: document.querySelector("#exportTeamButton"),
  exportSalesButton: document.querySelector("#exportSalesButton"),
  salesPersonFilter: document.querySelector("#salesPersonFilter"),
  attendanceHistoryStats: document.querySelector("#attendanceHistoryStats"),
  attendanceHistoryChart: document.querySelector("#attendanceHistoryChart"),
  tableSortButtons: [...document.querySelectorAll(".people-table .table-sort")],
  salesSortButtons: [...document.querySelectorAll(".sales-table .table-sort")],
  addWorkerButton: document.querySelector("#addWorkerButton"),
  teamViewButton: document.querySelector("#teamViewButton"), salesViewButton: document.querySelector("#salesViewButton"), salesPendingBadge: document.querySelector("#salesPendingBadge"),
  teamViewSections: [...document.querySelectorAll(".team-view-section")], salesDashboard: document.querySelector("#salesDashboard"),
  salesRevenueKpi: document.querySelector("#salesRevenueKpi"), salesHoursKpi: document.querySelector("#salesHoursKpi"), salesAsrKpi: document.querySelector("#salesAsrKpi"), salesArosKpi: document.querySelector("#salesArosKpi"), salesTargetKpi: document.querySelector("#salesTargetKpi"), salesMissingKpi: document.querySelector("#salesMissingKpi"),
  salesPeriodFilter: document.querySelector("#salesPeriodFilter"), salesStatusFilter: document.querySelector("#salesStatusFilter"), salesTableBody: document.querySelector("#salesTableBody"), salesEmpty: document.querySelector("#salesEmpty"),
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
  detailNoteAttribution: document.querySelector("#detailNoteAttribution"),
  clearNotesButton: document.querySelector("#clearNotesButton"),
  workerNoteInput: document.querySelector("#workerNoteInput"),
  addWorkerNoteButton: document.querySelector("#addWorkerNoteButton"),
  workerNotesStatus: document.querySelector("#workerNotesStatus"),
  workerNotesList: document.querySelector("#workerNotesList"),
  profileUserId: document.querySelector("#profileUserId"),
  profileRole: document.querySelector("#profileRole"),
  profileEmail: document.querySelector("#profileEmail"),
  profileHours60: document.querySelector("#profileHours60"),
  feedbackHistory: document.querySelector("#feedbackHistory"),
  feedbackBreakdown: document.querySelector("#feedbackBreakdown"),
  auditHistory: document.querySelector("#auditHistory"),
  profileSalesSummary: document.querySelector("#profileSalesSummary"), profileSalesHistory: document.querySelector("#profileSalesHistory"),
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
  salesReportDialog: document.querySelector("#salesReportDialog"), salesReportForm: document.querySelector("#salesReportForm"), salesReportTitle: document.querySelector("#salesReportTitle"), salesReportDate: document.querySelector("#salesReportDate"), salesReportId: document.querySelector("#salesReportId"), salesReportHours: document.querySelector("#salesReportHours"), salesReportHardware: document.querySelector("#salesReportHardware"), salesReportServices: document.querySelector("#salesReportServices"), salesReportNote: document.querySelector("#salesReportNote"), salesReportPreview: document.querySelector("#salesReportPreview"), salesReportStatus: document.querySelector("#salesReportStatus"), closeSalesReport: document.querySelector("#closeSalesReport"), markNotSalesButton: document.querySelector("#markNotSalesButton"),
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
elements.teamViewButton.addEventListener("click", () => setMainView("team"));
elements.salesViewButton.addEventListener("click", () => setMainView("sales"));
elements.salesPeriodFilter.addEventListener("change", renderSalesDashboard);
elements.salesStatusFilter.addEventListener("change", renderSalesDashboard);
elements.profileTabs.forEach(button => button.addEventListener("click", () => activateProfileTab(button.dataset.profileTab)));
elements.attendanceInput.addEventListener("change", (event) => importAttendance(event.target.files[0]));
elements.searchInput.addEventListener("input", () => {
  elements.clearSearchButton.hidden = !elements.searchInput.value;
  scheduleTeamRender();
});
elements.clearSearchButton.addEventListener("click", () => {
  elements.searchInput.value = "";
  elements.clearSearchButton.hidden = true;
  elements.searchInput.focus();
  renderTeam();
});
elements.sortSelect.value = sortOptionValue(currentSort);
elements.sortSelect.addEventListener("change", () => {
  currentSort = { ...(SORT_OPTIONS[elements.sortSelect.value] || SORT_OPTIONS.name) };
  saveSort();
  render();
});
elements.exportTeamButton.addEventListener("click", exportTeamCsv);
elements.exportSalesButton.addEventListener("click", exportSalesCsv);
elements.salesPersonFilter.addEventListener("change", renderSalesDashboard);
elements.tableSortButtons.forEach(button => button.addEventListener("click", () => setTableSort(button.dataset.sortKey)));
elements.salesSortButtons.forEach(button => button.addEventListener("click", () => setSalesTableSort(button.dataset.salesSortKey)));
elements.departmentFilters.forEach(input => input.addEventListener("change", renderTeam));
elements.departmentMatchMode.addEventListener("change", renderTeam);
elements.clearDepartmentFilters.addEventListener("click", () => {
  elements.departmentFilters.forEach(input => { input.checked = false; });
  render();
});
elements.resetAllFilters.addEventListener("click", resetAllFilters);
elements.sheetSelect.addEventListener("change", () => importWorkbookSheet(elements.sheetSelect.value));
elements.monthPickerButton.addEventListener("click", event => {
  event.stopPropagation();
  const willOpen = elements.monthPickerMenu.hidden;
  elements.monthPickerMenu.hidden = !willOpen;
  elements.monthPickerButton.setAttribute("aria-expanded", String(willOpen));
  elements.importPanel.classList.toggle("month-picker-open", willOpen);
});
document.addEventListener("click", event => {
  if (!elements.sheetSelectWrap.contains(event.target)) closeMonthPicker();
});
elements.cancelFeedbackButton.addEventListener("click", () => elements.feedbackDialog.close());
elements.feedbackNote.addEventListener("input", () => elements.feedbackNote.setCustomValidity(""));
elements.cancelFeedbackAction.addEventListener("click", () => elements.feedbackDialog.close());
elements.personDepartments.forEach(input => input.addEventListener("change", saveDepartmentTraining));
elements.onboardingTraining.addEventListener("change", saveOnboarding);
elements.onboardingContracts.addEventListener("change", saveOnboarding);
elements.onboardingTaxes.addEventListener("change", saveOnboarding);
elements.notesInput.addEventListener("blur", saveDetailNotes);
elements.clearNotesButton.addEventListener("click", () => {
  elements.notesInput.value = "";
  void saveDetailNotes();
});
elements.addWorkerNoteButton.addEventListener("click", addWorkerNote);
elements.closeSalesReport.addEventListener("click", () => elements.salesReportDialog.close());
elements.salesReportForm.addEventListener("submit", saveSalesReport);
elements.salesReportDialog.addEventListener("click", closeDialogFromBackdrop);
elements.markNotSalesButton.addEventListener("click", markSalesDayNotSales);
[elements.salesReportHours, elements.salesReportHardware, elements.salesReportServices].forEach(input => input.addEventListener("input", updateSalesReportPreview));
elements.alertsToggle.addEventListener("click", () => setAlertsOpen(!elements.alertsPanel.classList.contains("is-open")));
elements.alertsClose.addEventListener("click", () => setAlertsOpen(false));
elements.alertsClear.addEventListener("click", clearCurrentAlerts);
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && elements.alertsPanel.classList.contains("is-open")) setAlertsOpen(false);
  const typing = event.target.matches?.("input, textarea, select, [contenteditable='true']");
  if (event.key === "/" && !typing) {
    event.preventDefault();
    elements.searchInput.focus();
  }
  if (event.key === "Escape" && document.activeElement === elements.searchInput && elements.searchInput.value) {
    elements.searchInput.value = "";
    elements.clearSearchButton.hidden = true;
    renderTeam();
  }
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
elements.addWorkerButton.addEventListener("click", () => {
  elements.addWorkerButton.closest("details").open = false;
  openAddWorkerDialog();
});
elements.closeAddWorker.addEventListener("click", () => elements.addWorkerDialog.close());
elements.cancelAddWorker.addEventListener("click", () => elements.addWorkerDialog.close());
elements.addWorkerForm.addEventListener("submit", addWorker);
elements.deleteWorkerButton.addEventListener("click", openDeleteWorkerDialog);
elements.closeDeleteWorker.addEventListener("click", () => elements.deleteWorkerDialog.close());
elements.cancelDeleteWorker.addEventListener("click", () => elements.deleteWorkerDialog.close());
elements.deleteWorkerForm.addEventListener("submit", removeWorker);
elements.addWorkerDialog.addEventListener("click", closeDialogFromBackdrop);
elements.deleteWorkerDialog.addEventListener("click", closeDialogFromBackdrop);
elements.inactiveWorkersButton.addEventListener("click", () => {
  elements.inactiveWorkersButton.closest("details").open = false;
  void openInactiveWorkers();
});
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
  const submitButton = elements.feedbackForm.querySelector('button[type="submit"]');
  if (submitButton.disabled) return;
  submitButton.disabled = true;
  try {
    await saveFeedback();
  } finally {
    submitButton.disabled = false;
  }
});

async function saveFeedback() {
  const person = state.people[elements.feedbackPersonId.value];
  const note = elements.feedbackNote.value.trim();
  if (!person || !note) return;
  const feedbackItem = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: elements.feedbackType.value,
    category: elements.feedbackCategoryInputs.find(input => input.checked)?.value,
    note,
    createdByEmail: remoteUser?.email || "",
    createdAt: new Date().toISOString()
  };
  if (supabaseClient && remoteUser && person.remoteId) {
    const { data, error } = await supabaseClient.from("feedback").insert({
      worker_id: person.remoteId,
      kind: feedbackItem.type,
      category: feedbackItem.category,
      note: feedbackItem.note,
      created_by: remoteUser.id,
      created_by_email: remoteUser.email.toLowerCase()
    }).select("id, kind, category, note, created_by_email, created_at").single();
    if (error) {
      elements.feedbackNote.setCustomValidity(error.message);
      elements.feedbackNote.reportValidity();
      return;
    }
    elements.feedbackNote.setCustomValidity("");
    feedbackItem.id = data.id;
    feedbackItem.category = data.category;
    feedbackItem.createdByEmail = data.created_by_email;
    feedbackItem.createdAt = data.created_at;
  }
  elements.feedbackNote.setCustomValidity("");
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
}

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
    const { data: createdWorkerId, error } = await supabaseClient.rpc("admin_create_worker", {
      p_external_user_id: externalId,
      p_full_name: name,
      p_email: email
    });
    if (error) {
      if (error.code === "23505") throw new Error("Brigádník s tímto interním ID už existuje.");
      throw new Error(error.message);
    }
    await loadRemoteState();
    render();
    elements.addWorkerDialog.close();
    setMessage(`Karta pro ${name} byla vytvořena.`, false, async () => {
      const { error: undoError } = await supabaseClient.rpc("admin_set_worker_active", { p_worker_id: createdWorkerId, p_active: false });
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
    const { error } = await supabaseClient.rpc("admin_set_worker_active", { p_worker_id: person.remoteId, p_active: false });
    if (error) throw new Error(error.message);
    delete state.people[person.id];
    saveState();
    elements.deleteWorkerDialog.close();
    elements.dialog.close();
    render();
    setMessage(`${person.name} byl odebrán z aktivního přehledu.`, false, async () => {
      const { error: undoError } = await supabaseClient.rpc("admin_set_worker_active", { p_worker_id: person.remoteId, p_active: true });
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
    const { error } = await supabaseClient.rpc("admin_set_worker_active", { p_worker_id: workerId, p_active: true });
    if (error) throw error;
    await loadRemoteState();
    render();
    elements.inactiveWorkersDialog.close();
    setMessage(`${workerName} byl obnoven.`, false, async () => {
      const { error: undoError } = await supabaseClient.rpc("admin_set_worker_active", { p_worker_id: workerId, p_active: false });
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
    return {
      people: {},
      lastImport: parsed?.lastImport || null,
      plannedHours: Number.isFinite(parsed?.plannedHours) ? parsed.plannedHours : null,
      freeHours: Number.isFinite(parsed?.freeHours) ? parsed.freeHours : null
    };
  } catch {
    return { people: {}, lastImport: null, plannedHours: null, freeHours: null };
  }
}

function saveState() {
  // Osobní údaje patří pouze do Supabase. V prohlížeči zůstává jen neosobní stav synchronizace.
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ lastImport: state.lastImport, plannedHours: state.plannedHours, freeHours: state.freeHours }));
}

async function initializeApp() {
  const config = window.APP_CONFIG;
  if (!config?.supabaseUrl || !config?.supabasePublishableKey || !window.supabase?.createClient) {
    hideAppLoader();
    showAuthMessage("Chybí konfigurace Supabase nebo se nenačetla jeho knihovna.", true);
    return;
  }
  supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
  supabaseClient.auth.onAuthStateChange((event, session) => {
    // Ověření hesla při přidání/odebrání brigádníka, obnova tokenu i návrat
    // na kartu prohlížeče vyvolají událost pro stejného uživatele. Data jsou
    // už načtená, takže znovu neukazujeme loader ani nenačítáme vše od začátku.
    const sameUser = session?.user && remoteUser?.id === session.user.id && elements.authGate.hidden;
    if (sameUser && event !== "SIGNED_OUT") {
      remoteUser = session.user;
      return;
    }
    // Supabase nedoporučuje volat jeho API přímo v obsluze události (hrozí zablokování).
    setTimeout(() => { void processSession(session); }, 0);
  });
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) showAuthMessage(error.message, true);
  else await processSession(data.session);
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
  if (error) hideAppLoader();
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

function renderOnboardingAttribution(onboarding = {}) {
  if (!onboarding.updatedByEmail) {
    elements.onboardingAttribution.textContent = "Zatím bez zaznamenané změny.";
    return;
  }
  const when = onboarding.updatedAt
    ? new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium", timeStyle: "short" }).format(new Date(onboarding.updatedAt))
    : "";
  elements.onboardingAttribution.textContent = [`Upravil ${onboarding.updatedByEmail}`, when].filter(Boolean).join(" · ");
}

function renderDetailNoteAttribution(person) {
  const change = (person.audit || []).find(item =>
    item.operation === "UPDATE" && item.before?.notes !== item.after?.notes
  );
  if (!change) {
    elements.detailNoteAttribution.textContent = "Autor poslední změny je v historii profilu.";
    return;
  }
  const when = new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium", timeStyle: "short" }).format(new Date(change.changedAt));
  elements.detailNoteAttribution.textContent = `Upravil ${change.changedBy} · ${when}`;
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
  elements.importPanelToggle.querySelector("span").textContent = collapsed ? "Možnosti" : "Skrýt";
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
  const previousStatus = person.status;
  const next = elements.personDepartments.filter(input => input.checked).map(input => input.value);
  const nextStatus = normalize(person.status) === "novacek" && next.length ? "Aktivní" : person.status;
  previewDepartmentSkills();
  if (JSON.stringify(previous) === JSON.stringify(next)) return;
  const metrics = calculateAutomaticMetrics(person.feedback, next);
  elements.personDepartments.forEach(input => { input.disabled = true; });
  try {
    if (supabaseClient && remoteUser && person.remoteId) {
      const { error } = await supabaseClient.from("workers").update({ departments: next, skills: metrics.skills, status: nextStatus }).eq("id", person.remoteId);
      if (error) throw error;
      await refreshWorkerAudit(person);
    }
    person.departments = next;
    person.skills = metrics.skills;
    person.status = nextStatus;
    saveState();
    render();
    setMessage(nextStatus !== previousStatus ? "Zaškolení bylo uloženo a označení nováčka odebráno." : "Zaškolení bylo uloženo.", false, () => restoreDepartments(person, previous, previousStatus));
  } catch (error) {
    elements.personDepartments.forEach(input => { input.checked = previous.includes(input.value); });
    previewDepartmentSkills();
    setMessage(`Zaškolení se nepodařilo uložit: ${error.message}`, true);
  } finally {
    elements.personDepartments.forEach(input => { input.disabled = false; });
  }
}

async function saveOnboarding() {
  const person = state.people[elements.personId.value];
  if (!person || !person.remoteId || !onboardingTableAvailable) return;
  const next = {
    training: elements.onboardingTraining.checked,
    contracts: elements.onboardingContracts.checked,
    taxes: elements.onboardingTaxes.checked
  };
  const payload = {
    worker_id: person.remoteId,
    training_completed: next.training,
    contracts_completed: next.contracts,
    taxes_completed: next.taxes,
    updated_by: remoteUser.id,
    updated_by_email: remoteUser.email.toLowerCase()
  };
  const { error } = await supabaseClient.from("worker_onboarding").upsert(payload, { onConflict: "worker_id" });
  if (error) {
    setMessage(`Nástupní úkol se nepodařilo uložit: ${error.message}`, true);
    return;
  }
  person.onboarding = {
    ...next,
    updatedByEmail: remoteUser.email.toLowerCase(),
    updatedAt: new Date().toISOString()
  };
  if (elements.dialog.open && elements.personId.value === person.id) {
    renderOnboardingAttribution(person.onboarding);
  }
  if (next.training && normalize(person.status) === "novacek") {
    const { error: statusError } = await supabaseClient.from("workers").update({ status: "Aktivní" }).eq("id", person.remoteId);
    if (!statusError) person.status = "Aktivní";
  }
  renderTeam();
  renderAlerts();
  setMessage("Nástupní úkoly byly uloženy.");
}

async function restoreDepartments(person, departments, status = person.status) {
  const metrics = calculateAutomaticMetrics(person.feedback, departments);
  if (supabaseClient && remoteUser && person.remoteId) {
    const { error } = await supabaseClient.from("workers").update({ departments, skills: metrics.skills, status }).eq("id", person.remoteId);
    if (error) throw error;
  }
  person.departments = [...departments];
  person.skills = metrics.skills;
  person.status = status;
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
    renderDetailNoteAttribution(person);
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
    await refreshWorkerAudit(person);
  }
  person.notes = note;
  saveState();
  if (elements.dialog.open && elements.personId.value === person.id) {
    elements.notesInput.value = note;
    elements.clearNotesButton.hidden = !note;
    renderDetailNoteAttribution(person);
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

function setTableSort(key) {
  const defaultDirection = ["name", "notes"].includes(key) ? "asc" : "desc";
  currentSort = currentSort.key === key
    ? { key, direction: currentSort.direction === "asc" ? "desc" : "asc" }
    : { key, direction: defaultDirection };
  saveSort();
  updateTableSortIndicators();
  render();
}

function loadSavedSort() {
  try {
    const saved = JSON.parse(localStorage.getItem(SORT_KEY));
    if (saved && typeof saved.key === "string" && ["asc", "desc"].includes(saved.direction)) return saved;
  } catch { /* poškozená hodnota – použije se výchozí řazení */ }
  return { ...SORT_OPTIONS.name };
}

function saveSort() {
  localStorage.setItem(SORT_KEY, JSON.stringify(currentSort));
  elements.sortSelect.value = sortOptionValue(currentSort);
  elements.sortSelect.syncCustomSelect?.();
}

// Řazení z hlavičky tabulky nemusí mít odpovídající položku v seznamu.
function sortOptionValue(sort) {
  const match = Object.entries(SORT_OPTIONS).find(([, option]) => option.key === sort.key && option.direction === sort.direction);
  return match ? match[0] : "";
}

function updateTableSortIndicators() {
  elements.tableSortButtons.forEach(button => {
    const active = button.dataset.sortKey === currentSort.key;
    button.classList.toggle("is-active", active);
    button.querySelector("span").textContent = active ? (currentSort.direction === "asc" ? "↑" : "↓") : "↕";
    button.closest("th").setAttribute("aria-sort", active ? (currentSort.direction === "asc" ? "ascending" : "descending") : "none");
  });
}

function setSalesTableSort(key) {
  const defaultDirection = key === "name" ? "asc" : "desc";
  currentSalesSort = currentSalesSort.key === key
    ? { key, direction: currentSalesSort.direction === "asc" ? "desc" : "asc" }
    : { key, direction: defaultDirection };
  renderSalesDashboard();
}

function updateSalesSortIndicators() {
  elements.salesSortButtons.forEach(button => {
    const active = button.dataset.salesSortKey === currentSalesSort.key;
    button.classList.toggle("is-active", active);
    button.querySelector("span").textContent = active ? (currentSalesSort.direction === "asc" ? "↑" : "↓") : "↕";
    button.closest("th").setAttribute("aria-sort", active ? (currentSalesSort.direction === "asc" ? "ascending" : "descending") : "none");
  });
}

async function processSession(session) {
  if (!session?.user) return handleSession(session);
  if (sessionLoadPromise) return sessionLoadPromise;
  const currentLoad = handleSession(session);
  sessionLoadPromise = currentLoad;
  try {
    return await currentLoad;
  } finally {
    if (sessionLoadPromise === currentLoad) sessionLoadPromise = null;
  }
}

async function handleSession(session) {
  if (!session?.user) {
    hideAppLoader();
    remoteUser = null;
    hasAutoSynced = false;
    elements.authGate.hidden = false;
    elements.appContent.forEach(element => { element.hidden = true; });
    return;
  }
  showAppLoader("Ověřuji přístup…");
  remoteUser = session.user;
  const { data: membership, error: membershipError } = await supabaseClient
    .from("app_members")
    .select("email")
    .eq("email", remoteUser.email.toLocaleLowerCase())
    .maybeSingle();
  if (membershipError) {
    hideAppLoader();
    showAuthMessage(`Databáze ještě není připravená: ${membershipError.message}`, true);
    return;
  }
  if (!membership) {
    hideAppLoader();
    showAuthMessage("Tento e-mail není na seznamu povolených vedoucích.", true);
    await supabaseClient.auth.signOut();
    return;
  }
  elements.authGate.hidden = true;
  elements.appContent.forEach(element => { element.hidden = true; });
  elements.signedInUser.textContent = remoteUser.email;
  try {
    updateAppLoader("Načítám profily brigádníků…");
    await loadRemoteState();
    render();
    if (!hasAutoSynced) {
      hasAutoSynced = true;
      updateAppLoader("Synchronizuji docházku…");
      await syncGoogleSheets(true);
    }
    render();
    elements.appContent.forEach(element => { element.hidden = false; });
    updateAppLoader("Přehled je připravený");
    await waitForAppPaint();
    hideAppLoader();
  } catch (error) {
    hideAppLoader();
    elements.authGate.hidden = false;
    elements.appContent.forEach(element => { element.hidden = true; });
    showAuthMessage(error.message, true);
  }
}

function waitForAppPaint() {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function showAppLoader(text = "Načítám týmový přehled…") {
  clearTimeout(loaderHideTimer);
  elements.appLoaderStatus.textContent = text;
  elements.appLoader.hidden = false;
  requestAnimationFrame(() => elements.appLoader.classList.add("is-visible"));
}

function updateAppLoader(text) {
  elements.appLoaderStatus.textContent = text;
}

function hideAppLoader() {
  if (!elements.appLoader || elements.appLoader.hidden) return;
  elements.appLoader.classList.remove("is-visible");
  clearTimeout(loaderHideTimer);
  loaderHideTimer = setTimeout(() => { elements.appLoader.hidden = true; }, 240);
}

function showAuthMessage(text, error = false) {
  elements.authMessage.textContent = text;
  elements.authMessage.classList.toggle("error", error);
}

async function loadRemoteState() {
  const workersResult = await supabaseClient.from("workers").select("*").eq("active", true).order("full_name");
  if (workersResult.error) throw workersResult.error;
  const workerIds = workersResult.data.map(worker => worker.id);
  const latestPeriod = firstDayOfMonth(new Date());
  const scoped = query => workerIds.length ? query.in("worker_id", workerIds) : query.eq("worker_id", "00000000-0000-0000-0000-000000000000");
  const [attendanceResult, feedbackResult, auditResult, workerNotesResult, salesDaysResult, onboardingResult] = await Promise.all([
    scoped(supabaseClient.from("attendance_totals").select("worker_id, period, hours")).eq("period", latestPeriod),
    scoped(supabaseClient.from("feedback").select("id, worker_id, kind, category, note, created_by_email, created_at")).order("created_at"),
    Promise.resolve({ data: [], error: null }),
    Promise.resolve({ data: [], error: null }),
    scoped(supabaseClient.from("sales_days").select("*")).gte("shift_date", salesCutoffKey()).order("shift_date", { ascending: false }),
    scoped(supabaseClient.from("worker_onboarding").select("worker_id, training_completed, contracts_completed, taxes_completed, updated_by_email, updated_at"))
  ]);
  const error = workersResult.error || attendanceResult.error || feedbackResult.error || auditResult.error;
  if (error) throw new Error(`Data se nepodařilo načíst: ${error.message}`);
  workerNotesTableAvailable = !workerNotesResult.error;
  salesDaysTableAvailable = !salesDaysResult.error;
  onboardingTableAvailable = !onboardingResult.error;
  salesDays = (salesDaysResult.data || []).map(mapSalesDay);

  const currentAttendance = attendanceResult.data.filter(row => row.period === latestPeriod);
  monthRosterPersonIds.clear();
  monthRosterRemoteIds.clear();
  currentAttendance.forEach(row => monthRosterRemoteIds.add(row.worker_id));
  monthRosterKnown = true;
  const hoursByWorker = new Map(currentAttendance
    .map(row => [row.worker_id, Number(row.hours)]));
  const feedbackByWorker = new Map();
  feedbackResult.data.forEach(item => {
    if (!feedbackByWorker.has(item.worker_id)) feedbackByWorker.set(item.worker_id, []);
    feedbackByWorker.get(item.worker_id).push({
      id: item.id,
      type: item.kind,
      category: item.category || "general",
      note: item.note,
      createdByEmail: item.created_by_email || "",
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
  const notesByWorker = new Map();
  (workerNotesResult.data || []).forEach(item => {
    if (!notesByWorker.has(item.worker_id)) notesByWorker.set(item.worker_id, []);
    notesByWorker.get(item.worker_id).push({
      id: item.id,
      body: item.body,
      createdBy: item.created_by,
      createdByEmail: item.created_by_email,
      createdAt: item.created_at
    });
  });
  const onboardingByWorker = new Map((onboardingResult.data || []).map(item => [item.worker_id, {
    training: item.training_completed,
    contracts: item.contracts_completed,
    taxes: item.taxes_completed,
    updatedByEmail: item.updated_by_email || "",
    updatedAt: item.updated_at || ""
  }]));

  const remotePeople = {};
  workersResult.data.forEach(worker => {
    const identity = resolveWorkerIdentity(worker);
    const id = slugify(identity.name);
    const workerFeedback = feedbackByWorker.get(worker.id) || [];
    const metrics = calculateAutomaticMetrics(workerFeedback, worker.departments || []);
    remotePeople[id] = {
      id,
      remoteId: worker.id,
      name: identity.name,
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
      workerNotes: notesByWorker.get(worker.id) || [],
      notesLoaded: false,
      audit: auditByWorker.get(worker.id) || [],
      auditLoaded: false,
      onboarding: onboardingByWorker.get(worker.id) || {
        training: normalize(worker.status) !== "novacek",
        contracts: normalize(worker.status) !== "novacek",
        taxes: normalize(worker.status) !== "novacek"
      },
      aliases: identity.aliases
    };
  });
  state.people = remotePeople;
  if (latestPeriod) currentImportPeriod = latestPeriod;
  saveState();
}

function resolveWorkerIdentity(worker) {
  return { name: worker.full_name, aliases: [...new Set(worker.aliases || [])] };
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
    const response = await fetch(`${GOOGLE_SHEET_EXPORT_URL}&cache=${Date.now()}`, { cache: "no-store" })
      .catch(() => { throw new Error("Google tabulku se nepodařilo stáhnout. Zkontrolujte připojení k internetu a zkuste to znovu."); });
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
  renderMonthPicker(compatible);
  elements.sheetSelectWrap.hidden = false;
  const imported = await importWorkbookSheet(elements.sheetSelect.value);
  if (requireCurrentMonth && !imported) throw new Error("Aktuální list se nepodařilo načíst.");
  if (imported) {
    applyRolling60Hours(pendingWorkbook);
    applyNextShifts(pendingWorkbook);
    await syncSalesExpectations(pendingWorkbook);
  }
}

function mapSalesDay(row) {
  return { id: row.id, workerId: row.worker_id, date: row.shift_date, plannedHours: Number(row.planned_hours || 0), salesHours: Number(row.sales_hours || 0), hardware: Number(row.hardware_revenue || 0), services: Number(row.services_revenue || 0), status: row.status, note: row.note || "", updatedByEmail: row.updated_by_email || "", updatedAt: row.updated_at };
}

async function syncSalesExpectations(workbook) {
  if (!salesDaysTableAvailable || !supabaseClient || !remoteUser) return;
  const totals = new Map();
  const scannedDates = new Set();
  const today = startOfDay(new Date());
  workbook.SheetNames.forEach(sheetName => {
    forEachShiftCell(sheetMatrix(workbook.Sheets[sheetName]), ({ date, slot, text, assignment }) => {
      // Upozornění vzniká až po skončení dne. Dnešní směna ještě nemusí být
      // dokončená a její report tedy nemá být označený jako chybějící.
      if (!date || date >= today) return;
      scannedDates.add(dateKey(date));
      // Popisky v tabulce obsahují šipky a více variant názvu, například
      // „↓ Prodej ↓“, „Prodej / Výdej“ nebo „Prodej (Lenovo)“.
      if (!normalize(assignment).includes("prodej")) return;
      workersInShiftCell(text).forEach(worker => {
        if (!worker.remoteId) return;
        const key = `${worker.remoteId}|${dateKey(date)}`;
        totals.set(key, { worker_id: worker.remoteId, shift_date: dateKey(date), planned_hours: (totals.get(key)?.planned_hours || 0) + slot.hours });
      });
    });
  });
  if (!scannedDates.size) return;
  const { error } = totals.size
    ? await supabaseClient.from("sales_days").upsert([...totals.values()], { onConflict: "worker_id,shift_date" })
    : { error: null };
  if (error) { setMessage(`Prodejní směny se nepodařilo synchronizovat: ${error.message}`, true); return; }
  const orderedDates = [...scannedDates].sort();
  const { data: pendingRows } = await supabaseClient.from("sales_days").select("id, worker_id, shift_date")
    .eq("status", "pending").gte("shift_date", orderedDates[0]).lte("shift_date", orderedDates[orderedDates.length - 1]);
  const staleIds = (pendingRows || []).filter(row => !totals.has(`${row.worker_id}|${row.shift_date}`)).map(row => row.id);
  if (staleIds.length) await supabaseClient.from("sales_days").delete().in("id", staleIds).eq("status", "pending");
  const { data } = await supabaseClient.from("sales_days").select("*").gte("shift_date", salesCutoffKey()).order("shift_date", { ascending: false });
  if (data) salesDays = data.map(mapSalesDay);
  renderSalesDashboard(); renderAlerts();
}

function salesCutoffKey() {
  return dateKey(addMonths(new Date(), -12));
}

// sheet_to_json je u celého ročního sešitu drahé a stejný list se čte
// několikrát (hodiny za 60 dní, další směny, prodejní směny), proto výsledek ukládáme.
const sheetMatrixCache = new WeakMap();
function sheetMatrix(sheet) {
  if (!sheetMatrixCache.has(sheet)) sheetMatrixCache.set(sheet, XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" }));
  return sheetMatrixCache.get(sheet);
}

// Jedna buňka rozpisu může obsahovat více jmen (oddělených novým řádkem,
// čárkou nebo středníkem) a za jménem může být uvedený čas příchodu.
function workersInShiftCell(text) {
  const found = new Map();
  const add = worker => { if (worker) found.set(worker.id, worker); };
  const whole = findActiveWorker(text) || findActiveWorker(stripTrailingTime(text));
  if (whole) return [whole];
  String(text).split(/[\n,;]+/).forEach(part => add(findActiveWorker(part.trim()) || findActiveWorker(stripTrailingTime(part))));
  return [...found.values()];
}


function renderMonthPicker(months) {
  elements.monthPickerValue.textContent = elements.sheetSelect.value || "Vyberte měsíc";
  elements.monthPickerMenu.replaceChildren(...months.map(month => {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "option";
    button.textContent = month;
    button.classList.toggle("is-selected", month === elements.sheetSelect.value);
    button.setAttribute("aria-selected", String(month === elements.sheetSelect.value));
    button.addEventListener("click", async () => {
      if (month === elements.sheetSelect.value) return closeMonthPicker();
      elements.sheetSelect.value = month;
      elements.monthPickerValue.textContent = month;
      closeMonthPicker();
      await importWorkbookSheet(month);
      renderMonthPicker(months);
    });
    return button;
  }));
}

function closeMonthPicker() {
  elements.monthPickerMenu.hidden = true;
  elements.monthPickerButton.setAttribute("aria-expanded", "false");
  elements.importPanel.classList.remove("month-picker-open");
}

function applyRolling60Hours(workbook) {
  const today = startOfDay(new Date());
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - 59);
  const totals = new Map();
  workbook.SheetNames.forEach(sheetName => {
    forEachShiftCell(sheetMatrix(workbook.Sheets[sheetName]), ({ date, slot, text }) => {
      if (!date || date < cutoff || date > today) return;
      workersInShiftCell(text).forEach(worker => totals.set(worker.id, (totals.get(worker.id) || 0) + slot.hours));
    });
  });
  Object.values(state.people).forEach(person => { person.hours60 = Math.round((totals.get(person.id) || 0) * 100) / 100; });
  saveState();
  render();
}

function applyNextShifts(workbook) {
  const today = startOfDay(new Date());
  const shifts = new Map();
  workbook.SheetNames.forEach(sheetName => {
    forEachShiftCell(sheetMatrix(workbook.Sheets[sheetName]), ({ date, slot, text, assignment }) => {
      if (!date || date < today) return;
      const department = formatShiftDepartment(assignment) || "Oddělení neuvedeno";
      workersInShiftCell(text).forEach(worker => {
        const key = `${worker.id}|${dateKey(date)}|${department}`;
        const existing = shifts.get(key);
        if (!existing) {
          shifts.set(key, { personId: worker.id, date, department, ...slot });
          return;
        }
        if (slot.startMinutes < existing.startMinutes) Object.assign(existing, { startMinutes: slot.startMinutes, start: slot.start });
        if (slot.endMinutes > existing.endMinutes) Object.assign(existing, { endMinutes: slot.endMinutes, end: slot.end });
      });
    });
  });
  nextShiftsByPerson.clear();
  [...shifts.values()]
    .sort((a, b) => a.date - b.date || a.startMinutes - b.startMinutes)
    .forEach(shift => {
      if (!nextShiftsByPerson.has(shift.personId)) nextShiftsByPerson.set(shift.personId, shift);
    });
  render();
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
    const sheet = pendingWorkbook.Sheets[sheetName];
    const match = findWorkbookHeader(sheet);
    if (!match) throw new Error("Vybraný list nemá očekávaný souhrn hodin.");
    const { newcomers: shiftNewcomers, rosterNames: shiftRosterNames } = await ensureWorkersFromShiftSheet(sheet);
    const rows = [];
    for (let index = match.rowIndex + 1; index < match.matrix.length; index += 1) {
      const name = String(match.matrix[index][match.nameIndex] || "").trim();
      const hours = match.matrix[index][match.hoursIndex];
      if (!name) continue;
      if (["pocet volnych smen", "pocet obsazenych smen", "% obsazeni", "planovane hodiny", "z toho log (obsazene)"].includes(normalize(name))) break;
      rows.push({ Jméno: name, Hodiny: hours });
    }
    state.plannedHours = findWorkbookSummaryValue(match.matrix, ["plánované hodiny", "planovane hodiny"]);
    state.freeHours = calculateFreeShiftHours(sheetMatrix(sheet));
    currentImportPeriod = periodFromSheetName(sheetName) || firstDayOfMonth(new Date());
    await importRows(rows, `${pendingWorkbookName} — ${sheetName}`, shiftNewcomers, shiftRosterNames);
    return true;
  } catch (error) {
    setMessage(error.message || "List se nepodařilo načíst.", true);
    return false;
  }
}

function findWorkbookSummaryValue(matrix, labels) {
  const normalizedLabels = labels.map(normalize);
  for (const row of matrix) {
    const labelIndex = row.findIndex(cell => normalizedLabels.includes(normalize(cell)));
    if (labelIndex < 0) continue;
    const value = parseHours(row[labelIndex + 1]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

async function importRows(rows, sourceName, precreatedNewcomers = [], shiftRosterNames = []) {
  if (!rows.length) throw new Error("Soubor neobsahuje žádné datové řádky.");
  const columns = Object.keys(rows[0]);
  const nameColumn = findColumn(columns, ["jméno", "jmeno", "brigádník", "brigadnik", "name"]);
  const hoursColumn = findColumn(columns, ["hodiny", "počet zapsaných hodin", "pocet zapsanych hodin", "počet hodin", "pocet hodin", "hours"]);
  const photoColumn = findColumn(columns, ["foto", "fotka", "photo", "image"], false);
  const emailColumn = findColumn(columns, ["email", "e-mail"], false);
  if (!nameColumn || !hoursColumn) throw new Error("Chybí sloupec Jméno nebo Hodiny.");

  const createdNewcomers = [...new Set([...precreatedNewcomers, ...await ensureImportedWorkers(rows, nameColumn, emailColumn)])];

  const totals = new Map();
  const unmatchedNames = new Set();
  rows.forEach(row => {
    const importedName = String(row[nameColumn] || "").trim();
    if (!importedName) return;
    const activeWorker = findActiveWorker(importedName);
    if (!activeWorker) {
      unmatchedNames.add(importedName);
      return;
    }
    const name = activeWorker.name;
    const id = activeWorker.id;
    if (!totals.has(id)) totals.set(id, { id, name, hours: 0, email: activeWorker.email, photo: "" });
    const imported = totals.get(id);
    imported.hours += parseHours(row[hoursColumn]);
    if (emailColumn && row[emailColumn]) imported.email = String(row[emailColumn]).trim();
    if (photoColumn && row[photoColumn]) imported.photo = String(row[photoColumn]).trim();
  });

  // Preserve sheet-assigned people even when the monthly hours summary has no row yet.
  addRosterOnlyWorkers(totals, shiftRosterNames, findActiveWorker);

  monthRosterPersonIds.clear();
  monthRosterRemoteIds.clear();
  totals.forEach(imported => {
    monthRosterPersonIds.add(imported.id);
    const person = state.people[imported.id];
    if (person?.remoteId) monthRosterRemoteIds.add(person.remoteId);
  });
  monthRosterKnown = true;

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
  const newcomerText = createdNewcomers.length
    ? ` Nově vytvořené karty: ${createdNewcomers.join(", ")}.`
    : "";
  const unmatchedText = unmatchedNames.size
    ? ` Nepřiřazená jména: ${[...unmatchedNames].join(", ")}. Jejich existující hodiny nebyly přepsány.`
    : " Všechna jména byla úspěšně spárována.";
  setMessage(`Načteno ${totals.size} brigádníků ze zdroje ${sourceName}.${newcomerText}${unmatchedText}`, unmatchedNames.size > 0);
}

async function ensureWorkersFromShiftSheet(sheet) {
  const names = new Set();
  forEachShiftCell(sheetMatrix(sheet), ({ text }) => {
    text.split(/[\n,;]+/).forEach(value => {
      const name = stripTrailingTime(value);
      if (isLikelyWorkerName(name)) names.add(name);
    });
  });
  const rows = [...names].map(name => ({ Jméno: name }));
  const newcomers = await ensureImportedWorkers(rows, "Jméno", null);
  return { newcomers, rosterNames: [...names] };
}



async function ensureImportedWorkers(rows, nameColumn, emailColumn) {
  if (!supabaseClient || !remoteUser) return [];
  const imported = new Map();
  rows.forEach(row => {
    const name = String(row[nameColumn] || "").trim();
    if (!name) return;
    const key = slugify(name);
    if (!key || imported.has(key)) return;
    imported.set(key, { name, email: emailColumn && row[emailColumn] ? String(row[emailColumn]).trim() : null });
  });
  if (!imported.size) return [];

  const { data: existingWorkers, error: existingError } = await supabaseClient
    .from("workers")
    .select("id, external_user_id, full_name, aliases, active");
  if (existingError) throw new Error(`Kontrola nových brigádníků selhala: ${existingError.message}`);

  const existingByName = new Map();
  const orderedWorkers = [...(existingWorkers || [])].sort((a, b) => {
    const aPriority = String(a.external_user_id).startsWith("AUTO_") ? 1 : 0;
    const bPriority = String(b.external_user_id).startsWith("AUTO_") ? 1 : 0;
    return aPriority - bPriority;
  });
  orderedWorkers.forEach(worker => {
    const candidates = [worker.full_name, ...(worker.aliases || [])];
    candidates.filter(Boolean).forEach(candidate => {
      const key = slugify(candidate);
      if (!existingByName.has(key)) existingByName.set(key, worker);
    });
  });

  const duplicateIds = orderedWorkers.filter(worker => {
    if (!worker.active || !String(worker.external_user_id).startsWith("AUTO_")) return false;
    const canonical = existingByName.get(slugify(worker.full_name));
    return canonical && canonical.id !== worker.id && !String(canonical.external_user_id).startsWith("AUTO_");
  }).map(worker => worker.id);
  const ignoredLabelIds = orderedWorkers
    .filter(worker => worker.active && String(worker.external_user_id).startsWith("AUTO_") && isIgnoredShiftName(worker.full_name))
    .map(worker => worker.id);
  const cleanupIds = [...new Set([...duplicateIds, ...ignoredLabelIds])];
  if (cleanupIds.length) {
    const { error } = await supabaseClient.from("workers").update({ active: false, status: "Neaktivní" }).in("id", cleanupIds);
    if (error) throw new Error(`Oprava duplicitních karet selhala: ${error.message}`);
  }

  const newcomers = [];
  const inactiveIds = [];
  const inserts = [];
  imported.forEach((worker, key) => {
    const existing = existingByName.get(key);
    if (existing) {
      if (!existing.active) {
        inactiveIds.push(existing.id);
        newcomers.push(worker.name);
      }
      return;
    }
    inserts.push({
      external_user_id: automaticWorkerId(key),
      full_name: worker.name,
      email: worker.email,
      role: "Sales Support",
      status: "Nováček",
      active: true,
      skills: 0,
      reliability: 100,
      departments: [],
      aliases: [],
      notes: ""
    });
    newcomers.push(worker.name);
  });

  if (inactiveIds.length) {
    const { error } = await supabaseClient.from("workers").update({ active: true, status: "Nováček" }).in("id", inactiveIds);
    if (error) throw new Error(`Obnovení nových brigádníků selhalo: ${error.message}`);
  }
  if (inserts.length) {
    const { error } = await supabaseClient.from("workers").insert(inserts);
    if (error) throw new Error(`Vytvoření karet nováčků selhalo: ${error.message}`);
  }
  if (newcomers.length || cleanupIds.length) await loadRemoteState();
  return newcomers;
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
  const { data: savedRows, error: verifyError } = await supabaseClient
    .from("attendance_totals")
    .select("worker_id, hours")
    .eq("period", currentImportPeriod)
    .in("worker_id", rows.map(row => row.worker_id));
  if (verifyError) throw new Error(`Uloženou docházku se nepodařilo ověřit: ${verifyError.message}`);
  const savedByWorker = new Map(savedRows.map(row => [row.worker_id, Number(row.hours)]));
  const mismatches = rows.filter(row => {
    const saved = savedByWorker.get(row.worker_id);
    return !Number.isFinite(saved) || Math.abs(saved - Number(row.hours)) > 0.001;
  });
  if (mismatches.length) throw new Error(`Kontrola zápisu selhala u ${mismatches.length} brigádníků. Data nebyla potvrzena jako správná.`);
  // Historie docházky v profilu se při příštím otevření načte znovu.
  Object.values(state.people).forEach(person => { if (savedByWorker.has(person.remoteId)) person.attendanceLoaded = false; });
}


function findColumn(columns, aliases, required = true) {
  const normalized = new Map(columns.map(column => [normalize(column), column]));
  for (const alias of aliases) if (normalized.has(normalize(alias))) return normalized.get(normalize(alias));
  return required ? null : undefined;
}

function normalize(value) {
  return normalizeText(value);
}

function slugify(value) {
  return slugFromName(value);
}


function render() {
  renderTeam();
  renderSyncStatus();
  renderSalesDashboard();
  renderAlerts();
}

function scheduleTeamRender() {
  cancelAnimationFrame(teamRenderFrame);
  teamRenderFrame = requestAnimationFrame(renderTeam);
}

function renderTeam() {
  const query = elements.searchInput.value;
  const selectedDepartments = elements.departmentFilters.filter(input => input.checked).map(input => input.value);
  const allPeople = Object.values(state.people).filter(isPersonInSelectedMonth);
  const people = allPeople.filter(person => {
    if (!matchesSearch(person, query)) return false;
    if (activeQuickFilters.has("newcomer") && !isNewcomer(person)) return false;
    if (activeQuickFilters.has("onboarding") && !incompleteOnboardingTasks(person.onboarding).length) return false;
    if (activeQuickFilters.has("no-training") && (person.departments || []).length > 0) return false;
    if (activeQuickFilters.has("no-note") && String(person.notes || "").trim()) return false;
    if (activeQuickFilters.has("negative") && feedbackCount(person, "negative") === 0) return false;
    if (activeQuickFilters.has("zero-hours") && Number(person.hours || 0) !== 0) return false;
    if (!selectedDepartments.length) return true;
    const trained = Array.isArray(person.departments) ? person.departments : [];
    return elements.departmentMatchMode.value === "all"
      ? selectedDepartments.every(department => trained.includes(department))
      : selectedDepartments.some(department => trained.includes(department));
  });
  people.sort((a, b) => {
    const comparison = comparePeople(a, b, currentSort.key);
    return (currentSort.direction === "asc" ? comparison : -comparison) || a.name.localeCompare(b.name, "cs");
  });
  updateTableSortIndicators();

  visibleTeamPeople = people;
  elements.exportTeamButton.disabled = people.length === 0;
  elements.peopleGrid.replaceChildren(...people.map(createCard));
  renderPeopleTable(people);
  elements.skeletonGrid.hidden = true;
  elements.peopleGrid.hidden = people.length === 0 || currentView !== "cards";
  elements.peopleTableWrap.hidden = people.length === 0 || currentView !== "table";
  elements.cardViewButton.classList.toggle("is-active", currentView === "cards");
  elements.tableViewButton.classList.toggle("is-active", currentView === "table");
  elements.attendancePeople.textContent = allPeople.length;
  elements.attendanceHours.textContent = Number.isFinite(state.plannedHours) ? formatNumber(state.plannedHours) : "—";
  elements.visiblePeopleKpi.textContent = `${people.length} / ${allPeople.length}`;
  elements.averageSkillsKpi.textContent = `${averageMetric(people, "skills")} %`;
  elements.plannedHoursKpi.textContent = Number.isFinite(state.plannedHours) ? `${formatNumber(state.plannedHours)} h` : "—";
  elements.freeHoursKpi.textContent = Number.isFinite(state.freeHours) ? `${formatNumber(state.freeHours)} h` : "—";
  const freeShare = Number.isFinite(state.freeHours) && Number(state.plannedHours) > 0
    ? state.freeHours / state.plannedHours * 100
    : null;
  elements.freeHoursShareKpi.textContent = Number.isFinite(freeShare)
    ? `${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 }).format(freeShare)} % není obsazeno`
    : "Podíl zatím není dostupný";
  updateQuickFilterCounts(allPeople);
  elements.emptyState.hidden = people.length > 0;
  if (!people.length) {
    elements.emptyStateText.textContent = query.trim()
      ? `Pro hledání „${query.trim()}“ nebyl nalezen žádný brigádník.`
      : "Aktivní filtry neodpovídají žádnému brigádníkovi.";
  }
}

function averageMetric(people, key) {
  if (!people.length) return 0;
  return Math.round(people.reduce((sum, person) => sum + Number(person[key] || 0), 0) / people.length);
}

function updateQuickFilterCounts(people) {
  const counts = {
    newcomer: people.filter(isNewcomer).length,
    onboarding: people.filter(person => incompleteOnboardingTasks(person.onboarding).length).length,
    "no-training": people.filter(person => !(person.departments || []).length).length,
    "no-note": people.filter(person => !String(person.notes || "").trim()).length,
    negative: people.filter(person => feedbackCount(person, "negative") > 0).length,
    "zero-hours": people.filter(person => Number(person.hours || 0) === 0).length
  };
  elements.quickFilters.forEach(button => {
    const badge = button.querySelector("span");
    if (badge) badge.textContent = counts[button.dataset.quickFilter] ?? 0;
  });
}

function isNewcomer(person) {
  return normalize(person.status) === "novacek";
}

function resetAllFilters() {
  elements.searchInput.value = "";
  elements.clearSearchButton.hidden = true;
  activeQuickFilters.clear();
  elements.quickFilters.forEach(button => button.classList.remove("is-active"));
  elements.clearQuickFilters.hidden = true;
  elements.departmentFilters.forEach(input => { input.checked = false; });
  elements.departmentMatchMode.value = "all";
  elements.departmentMatchMode.syncCustomSelect?.();
  render();
}

function comparePeople(a, b, key) {
  if (key === "hours") return Number(a.hours || 0) - Number(b.hours || 0);
  if (key === "hours60") return Number(a.hours60 || 0) - Number(b.hours60 || 0);
  if (key === "skills") return Number(a.skills || 0) - Number(b.skills || 0);
  if (key === "reliability") return Number(a.reliability || 0) - Number(b.reliability || 0);
  if (key === "departments") return (a.departments || []).length - (b.departments || []).length;
  if (key === "notes") return String(a.notes || "").localeCompare(String(b.notes || ""), "cs");
  if (key === "rating") return score(a) - score(b);
  return a.name.localeCompare(b.name, "cs");
}

function renderSyncStatus() {
  if (!state.lastImport) {
    elements.syncStatusTitle.textContent = "Docházka není načtená";
    elements.syncStatusMeta.textContent = "Připraveno k synchronizaci";
    return;
  }
  const imported = new Date(state.lastImport);
  const today = imported.toDateString() === new Date().toDateString() ? "dnes" : new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric" }).format(imported);
  elements.syncStatusTitle.textContent = "Docházka synchronizována";
  elements.syncStatusMeta.textContent = `Synchronizováno ${today} v ${new Intl.DateTimeFormat("cs-CZ", { hour: "2-digit", minute: "2-digit" }).format(imported)}`;
}

function renderPeopleTable(people) {
  elements.peopleTableBody.replaceChildren(...people.map((person, index) => {
    const row = document.createElement("tr");
    row.style.setProperty("--item-index", index);
    row.tabIndex = 0;
    const departments = Array.isArray(person.departments) && person.departments.length ? person.departments.join(", ") : "—";
    const rating = score(person);
    row.innerHTML = `<td><strong></strong><small></small></td><td class="table-hours"><strong>${formatNumber(person.hours || 0)} h</strong><small>${formatNumber(person.hours60 || 0)} h / 60 dní</small></td><td>${metricCell(person.skills, "skills")}</td><td>${metricCell(person.reliability, "reliability")}</td><td class="table-departments"></td><td class="table-note"><textarea class="inline-note" rows="2" placeholder="Poznámka viditelná v přehledu…" aria-label="Poznámka v přehledu"></textarea></td><td class="table-score"><div class="table-feedback"><button class="feedback-button positive" type="button" aria-label="Přidat palec nahoru">👍 <span>0</span></button><button class="feedback-button negative" type="button" aria-label="Přidat palec dolů">👎 <span>0</span></button><strong class="score"></strong></div></td>`;
    const name = row.querySelector("strong");
    name.textContent = person.name;
    setupNextShiftTooltip(name, person);
    if (normalize(person.status) === "novacek") {
      const newcomerBadge = document.createElement("span");
      newcomerBadge.className = "table-newcomer-badge";
      newcomerBadge.textContent = "Nováček";
      name.after(newcomerBadge);
    }
    row.querySelector("small").textContent = person.email || "";
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
  const color = type === "reliability" ? reliabilityColor(safeValue) : "var(--skills-color)";
  return `<span class="table-metric"><span>${safeValue} %</span><i><b style="width:${safeValue}%;background:${color}"></b></i></span>`;
}

function renderAlerts() {
  const people = Object.values(state.people).filter(isPersonInSelectedMonth);
  const medianHours = median(people.map(person => Number(person.hours || 0)).filter(hours => hours > 0));
  const alerts = [];

  people.forEach(person => {
    const reasons = [];
    incompleteOnboardingTasks(person.onboarding).forEach(text => reasons.push({ type: "onboarding", text }));
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
    const pendingSales = salesDays.filter(day => day.workerId === person.remoteId && day.status === "pending" && day.date < dateKey(new Date()));
    if (pendingSales.length) reasons.push({ type: "sales", text: `Chybí ${pendingSales.length} prodejní report${pendingSales.length > 1 ? "y" : ""}`, salesDayId: pendingSales[0].id });
    if (reasons.length) alerts.push({ person, reasons });
  });

  alerts.forEach(alert => { alert.signature = alertSignature(alert.person, alert.reasons); });
  const currentSignatures = new Set(alerts.map(alert => alert.signature));
  let dismissedChanged = false;
  [...dismissedAlertSignatures].forEach(signature => {
    if (!currentSignatures.has(signature)) {
      dismissedAlertSignatures.delete(signature);
      dismissedChanged = true;
    }
  });
  if (dismissedChanged) saveDismissedAlerts();
  const visibleAlerts = alerts.filter(alert => !dismissedAlertSignatures.has(alert.signature));
  visibleAlertSignatures = visibleAlerts.map(alert => alert.signature);
  elements.alertsCount.textContent = visibleAlerts.length;
  elements.alertsEarCount.textContent = visibleAlerts.length;
  elements.alertsSummary.textContent = visibleAlerts.length
    ? `${visibleAlerts.length} ${visibleAlerts.length === 1 ? "člověk potřebuje" : visibleAlerts.length < 5 ? "lidé potřebují" : "lidí potřebuje"} pozornost.`
    : "Vše důležité na jednom místě.";
  elements.alertsClear.hidden = visibleAlerts.length === 0;
  elements.alertsToggle.classList.toggle("has-alerts", visibleAlerts.length > 0);
  elements.alertsEmpty.hidden = visibleAlerts.length > 0;
  elements.alertsList.hidden = visibleAlerts.length === 0;
  elements.alertsList.replaceChildren(...visibleAlerts.map(({ person, reasons }) => {
    const item = document.createElement("article");
    item.className = "alert-item";
    item.tabIndex = 0;
    const title = document.createElement("strong");
    title.textContent = person.name;
    const head = document.createElement("span");
    head.className = "alert-item-head";
    const action = document.createElement("span");
    action.className = "alert-item-action";
    action.textContent = reasons.some(reason => reason.salesDayId) ? "Doplnit report" : "Otevřít detail";
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "alert-dismiss";
    dismiss.setAttribute("aria-label", `Skrýt upozornění pro ${person.name}`);
    dismiss.title = "Označit jako přečtené";
    dismiss.textContent = "×";
    head.append(title, action, dismiss);
    const badges = document.createElement("span");
    badges.className = "alert-reasons";
    reasons.forEach(reason => {
      const badge = document.createElement("span");
      badge.className = `alert-reason ${reason.type}`;
      badge.textContent = reason.text;
      badges.append(badge);
    });
    item.append(head, badges);
    const openAlert = () => {
      setAlertsOpen(false);
      const salesReason = reasons.find(reason => reason.salesDayId);
      if (salesReason) openSalesReport(salesDays.find(day => day.id === salesReason.salesDayId));
      else openPerson(person.id);
    };
    item.addEventListener("click", event => { if (!event.target.closest(".alert-dismiss")) openAlert(); });
    item.addEventListener("keydown", event => { if (event.key === "Enter") openAlert(); });
    dismiss.addEventListener("click", event => {
      event.stopPropagation();
      dismissedAlertSignatures.add(alertSignature(person, reasons));
      saveDismissedAlerts();
      renderAlerts();
    });
    return item;
  }));
}

function alertSignature(person, reasons) {
  return `${person.remoteId || person.id}|${reasons.map(reason => `${reason.type}:${reason.text}`).sort().join("|")}`;
}

function loadDismissedAlerts() {
  try {
    const saved = JSON.parse(localStorage.getItem(DISMISSED_ALERTS_KEY));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function saveDismissedAlerts() {
  localStorage.setItem(DISMISSED_ALERTS_KEY, JSON.stringify([...dismissedAlertSignatures]));
}

function clearCurrentAlerts() {
  visibleAlertSignatures.forEach(signature => dismissedAlertSignatures.add(signature));
  saveDismissedAlerts();
  renderAlerts();
  setMessage("Aktuální upozornění byla vyprázdněna.");
}

function setAlertsOpen(open) {
  elements.alertsDrawer.classList.toggle("is-open", open);
  elements.alertsPanel.classList.toggle("is-open", open);
  elements.alertsToggle.classList.toggle("is-open", open);
  elements.alertsPanel.setAttribute("aria-hidden", String(!open));
  elements.alertsToggle.setAttribute("aria-expanded", String(open));
  elements.alertsHandleIcon.textContent = open ? "‹" : "›";
  if (open) requestAnimationFrame(() => elements.alertsClose.focus({ preventScroll: true }));
}

function isPersonInSelectedMonth(person) {
  if (!monthRosterKnown) return true;
  // Nováček přidaný ručně ještě nemusí mít směnu v rozpisu, ale jeho nástup
  // je potřeba dotáhnout, proto zůstává v přehledu viditelný.
  if (isNewcomer(person)) return true;
  return monthRosterPersonIds.has(person.id) || (person.remoteId && monthRosterRemoteIds.has(person.remoteId));
}

function previousAuditValue(person, field) {
  const audit = Array.isArray(person.audit) ? person.audit : [];
  const change = audit.find(item => item.operation === "UPDATE" && item.before?.[field] !== item.after?.[field]);
  return change ? change.before[field] : null;
}

function setMainView(view) {
  const sales = view === "sales";
  elements.teamViewSections.forEach(section => { section.hidden = sales; });
  elements.salesDashboard.hidden = !sales;
  elements.teamViewButton.classList.toggle("is-active", !sales);
  elements.salesViewButton.classList.toggle("is-active", sales);
  if (sales) {
    renderSalesDashboard();
    if (!salesDaysTableAvailable) setMessage("Prodejní výkon vyžaduje spuštění migrace sales-performance-migration.sql v Supabase.", true);
  }
}

function personByRemoteId(id) { return Object.values(state.people).find(person => person.remoteId === id); }
function salesRevenue(day) { return Number(day.hardware || 0) + Number(day.services || 0); }
function salesAsr(day) { return day.salesHours > 0 ? salesRevenue(day) / day.salesHours : 0; }
function salesAros(day) { return day.hardware > 0 ? day.services / day.hardware * 100 : null; }
function formatAros(value) { return Number.isFinite(value) ? `${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 }).format(value)} %` : "—"; }
function salesTargetPercent(day) { return day.salesHours > 0 ? salesAsr(day) / SALES_ASR_TARGET * 100 : 0; }
function formatCurrency(value) { return new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 }).format(Number(value || 0)) + " Kč"; }
function salesPerformanceClass(percent) { return percent >= 120 ? "excellent" : percent >= 100 ? "met" : percent >= 80 ? "near" : "below"; }

function renderSalesDashboard() {
  const now = new Date();
  syncSalesMonthOptions();
  const selectedMonth = elements.salesPeriodFilter.value;
  syncSalesPersonOptions();
  const selectedPerson = elements.salesPersonFilter.value;
  const periodRows = salesDays.filter(day => (selectedMonth === "all" || String(day.date).startsWith(`${selectedMonth}-`))
    && (selectedPerson === "all" || day.workerId === selectedPerson));
  let rows = [...periodRows];
  const status = elements.salesStatusFilter.value;
  if (status === "pending") rows = rows.filter(day => day.status === "pending");
  if (status === "not_sales") rows = rows.filter(day => day.status === "not_sales");
  if (status === "below") rows = rows.filter(day => day.status === "reported" && salesTargetPercent(day) < 100);
  if (status === "met") rows = rows.filter(day => day.status === "reported" && salesTargetPercent(day) >= 100);
  rows.sort((a, b) => {
    const comparison = compareSalesDays(a, b, currentSalesSort.key);
    return (currentSalesSort.direction === "asc" ? comparison : -comparison)
      || String(b.date).localeCompare(String(a.date));
  });
  updateSalesSortIndicators();
  const { revenue, hours, asr, aros, targetPercent } = summarizeSales(rows);
  const missing = periodRows.filter(day => day.status === "pending" && day.date < dateKey(now)).length;
  const globalMissing = salesDays.filter(day => day.status === "pending" && day.date < dateKey(now)).length;
  elements.salesRevenueKpi.textContent = formatCurrency(revenue);
  elements.salesHoursKpi.textContent = `${formatNumber(hours)} h`;
  elements.salesAsrKpi.textContent = `${formatCurrency(asr)}/h`;
  elements.salesArosKpi.textContent = formatAros(aros);
  elements.salesTargetKpi.textContent = `${Math.round(targetPercent || 0)} %`;
  elements.salesMissingKpi.textContent = missing;
  elements.salesPendingBadge.hidden = globalMissing === 0;
  elements.salesPendingBadge.textContent = globalMissing;
  elements.salesEmpty.hidden = rows.length > 0;
  elements.exportSalesButton.disabled = rows.length === 0;
  visibleSalesRows = rows;
  elements.salesTableBody.replaceChildren(...rows.map(day => {
    const person = personByRemoteId(day.workerId);
    const row = document.createElement("tr");
    const percent = salesTargetPercent(day);
    const stateLabel = day.status === "pending" ? "Chybí report" : day.status === "not_sales" ? "Nebyl na prodeji" : `${Math.round(percent)} % TGT`;
    row.innerHTML = `<td><strong></strong></td><td>${new Intl.DateTimeFormat("cs-CZ").format(new Date(`${day.date}T00:00:00`))}</td><td>${formatNumber(day.status === "reported" ? day.salesHours : day.plannedHours)} h</td><td>${day.status === "reported" ? formatCurrency(day.hardware) : "—"}</td><td>${day.status === "reported" ? formatCurrency(day.services) : "—"}</td><td>${day.status === "reported" ? formatCurrency(salesRevenue(day)) : "—"}</td><td>${day.status === "reported" ? formatCurrency(salesAsr(day)) + "/h" : "—"}</td><td>${day.status === "reported" ? formatAros(salesAros(day)) : "—"}</td><td><span class="sales-result ${day.status === "reported" ? salesPerformanceClass(percent) : day.status}">${stateLabel}</span></td><td class="sales-author"></td><td><button class="sales-row-action" type="button">${day.status === "pending" ? "Doplnit" : "Detail"}</button></td>`;
    row.querySelector("strong").textContent = person?.name || "Neznámý brigádník";
    row.querySelector(".sales-author").textContent = day.updatedByEmail || "";
    row.querySelector("button").addEventListener("click", () => openSalesReport(day));
    return row;
  }));
}

function syncSalesPersonOptions() {
  const select = elements.salesPersonFilter;
  const people = [...new Set(salesDays.map(day => day.workerId))]
    .map(id => ({ id, name: personByRemoteId(id)?.name }))
    .filter(person => person.name)
    .sort((a, b) => a.name.localeCompare(b.name, "cs"));
  const signature = people.map(person => person.id).join("|");
  if (select.dataset.signature === signature) return;
  const previous = select.value;
  select.replaceChildren(new Option("Všichni brigádníci", "all"), ...people.map(person => new Option(person.name, person.id)));
  select.value = people.some(person => person.id === previous) ? previous : "all";
  select.dataset.signature = signature;
  select.syncCustomSelect?.();
}

function syncSalesMonthOptions() {
  const months = [...new Set(salesDays.map(day => String(day.date || "").slice(0, 7)).filter(month => /^\d{4}-\d{2}$/.test(month)))]
    .sort((a, b) => b.localeCompare(a));
  if (!months.length) return;

  const previous = elements.salesPeriodFilter.value;
  const currentMonth = dateKey(new Date()).slice(0, 7);
  const keepPrevious = elements.salesPeriodFilter.dataset.ready === "true"
    && (previous === "all" || months.includes(previous));
  const selected = keepPrevious ? previous : (months.includes(currentMonth) ? currentMonth : months[0]);
  const monthFormatter = new Intl.DateTimeFormat("cs-CZ", { month: "long", year: "numeric" });
  elements.salesPeriodFilter.replaceChildren(
    new Option("Všechny měsíce", "all"),
    ...months.map(month => {
      const [year, monthNumber] = month.split("-").map(Number);
      const label = monthFormatter.format(new Date(year, monthNumber - 1, 1));
      return new Option(label.charAt(0).toLocaleUpperCase("cs") + label.slice(1), month);
    })
  );
  elements.salesPeriodFilter.value = selected;
  elements.salesPeriodFilter.dataset.ready = "true";
  elements.salesPeriodFilter.syncCustomSelect?.();
}

function compareSalesDays(a, b, key) {
  if (key === "name") {
    const aName = personByRemoteId(a.workerId)?.name || "";
    const bName = personByRemoteId(b.workerId)?.name || "";
    return aName.localeCompare(bName, "cs");
  }
  if (key === "date") return String(a.date).localeCompare(String(b.date));
  if (key === "hours") return Number(a.status === "reported" ? a.salesHours : a.plannedHours) - Number(b.status === "reported" ? b.salesHours : b.plannedHours);
  if (key === "hardware") return Number(a.hardware || 0) - Number(b.hardware || 0);
  if (key === "services") return Number(a.services || 0) - Number(b.services || 0);
  if (key === "revenue") return salesRevenue(a) - salesRevenue(b);
  if (key === "asr") return salesAsr(a) - salesAsr(b);
  if (key === "aros") return Number(salesAros(a) ?? -1) - Number(salesAros(b) ?? -1);
  if (key === "status") return salesStatusRank(a) - salesStatusRank(b);
  return 0;
}

function salesStatusRank(day) {
  if (day.status === "pending") return 0;
  if (day.status === "not_sales") return 1;
  if (salesTargetPercent(day) < 100) return 2;
  return 3;
}

function openSalesForPerson(person) {
  openPerson(person.id); activateProfileTab("sales"); renderProfileSales(person);
}

function renderProfileSales(person) {
  const rows = salesDays.filter(day => day.workerId === person.remoteId);
  const { revenue, hours, asr, aros, targetPercent } = summarizeSales(rows);
  elements.profileSalesSummary.innerHTML = `<article><span>Obrat</span><strong>${formatCurrency(revenue)}</strong></article><article><span>Hodiny</span><strong>${formatNumber(hours)} h</strong></article><article><span>ASR</span><strong>${formatCurrency(asr)}/h</strong></article><article><span>ARoS</span><strong>${formatAros(aros)}</strong></article><article><span>Plnění TGT</span><strong>${Math.round(targetPercent || 0)} %</strong></article>`;
  if (!rows.length) { elements.profileSalesHistory.innerHTML = '<p class="no-feedback">Zatím bez prodejních směn.</p>'; return; }
  elements.profileSalesHistory.replaceChildren(...rows.map(day => {
    const item = document.createElement("button"); item.type = "button"; item.className = "profile-sales-day";
    const percent = salesTargetPercent(day);
    item.innerHTML = `<span><strong>${new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium" }).format(new Date(`${day.date}T00:00:00`))}</strong><small>${day.status === "reported" ? `${formatNumber(day.salesHours)} h · ${formatCurrency(salesRevenue(day))} · ARoS ${formatAros(salesAros(day))}` : day.status === "pending" ? "Chybí report" : "Nebyl na prodeji"}</small></span><span class="sales-result ${day.status === "reported" ? salesPerformanceClass(percent) : day.status}">${day.status === "reported" ? `${Math.round(percent)} %` : ""}</span>`;
    item.addEventListener("click", () => openSalesReport(day)); return item;
  }));
}

function openSalesReport(day) {
  if (!day) return;
  const person = personByRemoteId(day.workerId);
  elements.salesReportId.value = day.id;
  elements.salesReportTitle.textContent = person?.name || "Report prodejů";
  elements.salesReportDate.textContent = new Intl.DateTimeFormat("cs-CZ", { dateStyle: "full" }).format(new Date(`${day.date}T00:00:00`));
  elements.salesReportHours.value = day.salesHours || day.plannedHours || "";
  elements.salesReportHardware.value = day.hardware || ""; elements.salesReportServices.value = day.services || ""; elements.salesReportNote.value = day.note || "";
  setDialogStatus(elements.salesReportStatus, ""); updateSalesReportPreview(); elements.salesReportDialog.showModal();
}

function updateSalesReportPreview() {
  const hours = Number(elements.salesReportHours.value || 0), revenue = Number(elements.salesReportHardware.value || 0) + Number(elements.salesReportServices.value || 0);
  const asr = hours ? revenue / hours : 0, percent = asr / SALES_ASR_TARGET * 100;
  const hardware = Number(elements.salesReportHardware.value || 0), services = Number(elements.salesReportServices.value || 0);
  const aros = hardware > 0 ? services / hardware * 100 : null;
  elements.salesReportPreview.innerHTML = `<span>Celkem <strong>${formatCurrency(revenue)}</strong></span><span>ASR <strong>${formatCurrency(asr)}/h</strong></span><span>ARoS <strong>${formatAros(aros)}</strong></span><span class="sales-result ${salesPerformanceClass(percent)}">${Math.round(percent || 0)} % TGT</span>`;
}

async function saveSalesReport(event) {
  event.preventDefault();
  await updateSalesDay({
    sales_hours: Number(elements.salesReportHours.value),
    hardware_revenue: Number(elements.salesReportHardware.value),
    services_revenue: Number(elements.salesReportServices.value),
    status: "reported",
    note: elements.salesReportNote.value.trim()
  }, "Prodejní report byl uložen.");
}

async function markSalesDayNotSales() {
  await updateSalesDay({
    status: "not_sales",
    sales_hours: null,
    hardware_revenue: null,
    services_revenue: null,
    note: elements.salesReportNote.value.trim()
  }, "Směna byla označena jako Nebyl na prodeji.");
}

async function updateSalesDay(changes, successMessage) {
  const day = salesDays.find(item => item.id === elements.salesReportId.value);
  if (!day || !supabaseClient || !remoteUser) return;
  const buttons = [...elements.salesReportForm.querySelectorAll("button")];
  if (buttons.some(button => button.disabled)) return;
  buttons.forEach(button => { button.disabled = true; });
  setDialogStatus(elements.salesReportStatus, "Ukládám…");
  try {
    const { data, error } = await supabaseClient.from("sales_days")
      .update({ ...changes, updated_by: remoteUser.id, updated_by_email: remoteUser.email.toLowerCase() })
      .eq("id", day.id).select("*").single();
    if (error) {
      setDialogStatus(elements.salesReportStatus, `Report se nepodařilo uložit: ${error.message}`, true);
      return;
    }
    Object.assign(day, mapSalesDay(data));
    elements.salesReportDialog.close();
    renderSalesDashboard();
    renderAlerts();
    renderTeam();
    const person = personByRemoteId(day.workerId);
    if (person && elements.dialog.open && elements.personId.value === person.id) renderProfileSales(person);
    setMessage(successMessage);
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
}

function createCard(person, index = 0) {
  const card = elements.cardTemplate.content.firstElementChild.cloneNode(true);
  card.style.setProperty("--item-index", index);
  card.tabIndex = 0;
  card.setAttribute("aria-label", `Zobrazit detail: ${person.name}`);
  const name = card.querySelector("h3");
  name.textContent = person.name;
  setupNextShiftTooltip(name, person);
  const email = card.querySelector(".email");
  email.textContent = person.email || "";
  const avatar = card.querySelector(".avatar");
  if (person.photo) avatar.style.backgroundImage = `url("${safeCssUrl(person.photo)}")`;
  else avatar.textContent = initials(person.name);
  card.querySelector(".hours-value").textContent = formatNumber(person.hours || 0);
  card.querySelector(".hours-60-value").textContent = `${formatNumber(person.hours60 || 0)} h`;
  const departmentBadges = card.querySelector(".department-badges");
  renderDepartmentBadges(departmentBadges, person.departments);
  if (normalize(person.status) === "novacek") {
    const newcomerBadge = document.createElement("span");
    newcomerBadge.className = "department-badge newcomer-badge";
    newcomerBadge.textContent = "Nováček";
    departmentBadges.prepend(newcomerBadge);
  }
  setMetric(card, "skills", person.skills);
  setMetric(card, "reliability", person.reliability);
  setupInlineNote(card.querySelector(".inline-note"), person);
  const personSales = salesDays.filter(day => day.workerId === person.remoteId);
  const pendingSales = personSales.filter(day => day.status === "pending" && day.date < dateKey(new Date())).length;
  const { asr } = summarizeSales(personSales);
  const salesStatus = card.querySelector(".sales-card-status");
  salesStatus.textContent = pendingSales ? `Chybí ${pendingSales} report${pendingSales > 1 ? "y" : ""}` : (asr ? `ASR ${formatCurrency(asr)}/h` : "Bez prodejních dat");
  salesStatus.classList.toggle("pending", pendingSales > 0);
  card.querySelector(".sales-card-button").addEventListener("click", event => { event.stopPropagation(); openSalesForPerson(person); });
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

function downloadCsv(fileName, headers, rows) {
  const blob = new Blob([toCsv(headers, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportFileStamp() {
  return dateKey(new Date());
}

function exportTeamCsv() {
  if (!visibleTeamPeople.length) return;
  const period = elements.sheetSelect.value || currentImportPeriod.slice(0, 7);
  downloadCsv(`brigadnici-${slugify(period) || exportFileStamp()}.csv`,
    ["Jméno", "Interní ID", "E-mail", "Stav", "Hodiny v měsíci", "Hodiny za 60 dní", "Schopnosti %", "Docházková morálka %", "Zaškolení", "👍", "👎", "Skóre", "Nedokončený nástup", "Další směna", "Poznámka"],
    visibleTeamPeople.map(person => {
      const shift = nextShiftsByPerson.get(person.id);
      return [
        person.name,
        person.userId || "",
        person.email || "",
        person.status || "",
        Number(person.hours || 0),
        Number(person.hours60 || 0),
        clampMetric(person.skills),
        clampMetric(person.reliability),
        (person.departments || []).join(", "),
        feedbackCount(person, "positive"),
        feedbackCount(person, "negative"),
        score(person),
        incompleteOnboardingTasks(person.onboarding).join(", "),
        shift ? `${new Intl.DateTimeFormat("cs-CZ").format(shift.date)} ${shift.start}–${shift.end} ${shift.department}` : "",
        person.notes || ""
      ];
    }));
  setMessage(`Exportováno ${visibleTeamPeople.length} brigádníků.`);
}

function exportSalesCsv() {
  if (!visibleSalesRows.length) return;
  const month = elements.salesPeriodFilter.value;
  downloadCsv(`prodejni-vykon-${month === "all" ? "vse" : month}.csv`,
    ["Brigádník", "Datum", "Stav", "Plánované hodiny", "Prodejní hodiny", "Železo Kč", "Služby Kč", "Celkem Kč", "ASR Kč/h", "ARoS %", "Plnění TGT %", "Poznámka", "Upravil"],
    visibleSalesRows.map(day => {
      const reported = day.status === "reported";
      const aros = salesAros(day);
      return [
        personByRemoteId(day.workerId)?.name || "Neznámý brigádník",
        new Intl.DateTimeFormat("cs-CZ").format(new Date(`${day.date}T00:00:00`)),
        day.status === "pending" ? "Chybí report" : day.status === "not_sales" ? "Nebyl na prodeji" : "Vyplněno",
        Number(day.plannedHours || 0),
        reported ? day.salesHours : "",
        reported ? day.hardware : "",
        reported ? day.services : "",
        reported ? salesRevenue(day) : "",
        reported ? Math.round(salesAsr(day)) : "",
        reported && Number.isFinite(aros) ? Math.round(aros * 10) / 10 : "",
        reported ? Math.round(salesTargetPercent(day)) : "",
        day.note || "",
        day.updatedByEmail || ""
      ];
    }));
  setMessage(`Exportováno ${visibleSalesRows.length} prodejních dní.`);
}

function setupNextShiftTooltip(nameElement, person) {
  const shift = nextShiftsByPerson.get(person.id);
  nameElement.classList.add("shift-name-anchor");
  nameElement.tabIndex = 0;
  nameElement.setAttribute("aria-label", shift ? `${person.name}, zobrazit další směnu` : `${person.name}, další směna není naplánována`);

  const tooltip = document.createElement("span");
  tooltip.className = "next-shift-tooltip";
  tooltip.setAttribute("role", "tooltip");
  if (!shift) {
    tooltip.innerHTML = '<span class="next-shift-label">Další směna</span><strong>Zatím není naplánována</strong>';
  } else {
    const date = new Intl.DateTimeFormat("cs-CZ", { weekday: "long", day: "numeric", month: "long" }).format(shift.date);
    tooltip.innerHTML = '<span class="next-shift-label">Další směna</span><strong class="next-shift-date"></strong><span class="next-shift-detail"><b class="next-shift-time"></b><i class="next-shift-department"></i></span>';
    tooltip.querySelector(".next-shift-date").textContent = date;
    tooltip.querySelector(".next-shift-time").textContent = `${shift.start}–${shift.end}`;
    tooltip.querySelector(".next-shift-department").textContent = shift.department;
  }
  nameElement.append(tooltip);
  nameElement.addEventListener("click", event => {
    event.stopPropagation();
    nameElement.classList.toggle("is-tooltip-open");
  });
  nameElement.addEventListener("keydown", event => {
    if (event.key === "Escape") nameElement.classList.remove("is-tooltip-open");
  });
  nameElement.addEventListener("blur", () => nameElement.classList.remove("is-tooltip-open"));
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
  renderDetailNoteAttribution(person);
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



function score(person) { return feedbackCount(person, "positive") - feedbackCount(person, "negative"); }

async function openPerson(id) {
  const person = state.people[id];
  activateProfileTab("overview");
  elements.dialogTitle.textContent = person.name;
  elements.personId.value = id;
  elements.profileUserId.textContent = person.userId || "—";
  elements.profileRole.textContent = person.role || "—";
  elements.profileEmail.textContent = person.email || "";
  elements.profileHours60.textContent = `${formatNumber(person.hours60 || 0)} hodin`;
  elements.skillsRange.value = person.skills ?? 50;
  updateRangeControl(elements.skillsRange, elements.skillsOutput);
  elements.reliabilityRange.value = person.reliability ?? 50;
  updateRangeControl(elements.reliabilityRange, elements.reliabilityOutput);
  const trained = Array.isArray(person.departments) ? person.departments : [];
  elements.personDepartments.forEach(input => { input.checked = trained.includes(input.value); });
  const onboarding = person.onboarding || {};
  elements.onboardingEditor.hidden = !onboardingTableAvailable;
  elements.onboardingTraining.checked = Boolean(onboarding.training);
  elements.onboardingContracts.checked = Boolean(onboarding.contracts);
  elements.onboardingTaxes.checked = Boolean(onboarding.taxes);
  renderOnboardingAttribution(onboarding);
  elements.notesInput.value = person.notes || "";
  elements.clearNotesButton.hidden = !person.notes;
  elements.workerNoteInput.value = "";
  elements.workerNotesStatus.textContent = "";
  renderWorkerNotes(person);
  renderDetailNoteAttribution(person);
  renderProfileSales(person);
  renderAttendanceHistory(person);
  renderFeedbackHistory(person);
  renderAuditHistory(person);
  elements.dialog.showModal();
  elements.dialog.querySelector('[data-profile-tab="overview"]').focus({ preventScroll: true });
  await loadWorkerDetails(person);
  if (elements.dialog.open && elements.personId.value === person.id) {
    renderWorkerNotes(person);
    renderDetailNoteAttribution(person);
    renderAttendanceHistory(person);
    renderAuditHistory(person);
  }
}

function renderAttendanceHistory(person) {
  const chart = elements.attendanceHistoryChart;
  const stats = elements.attendanceHistoryStats;
  if (!person.attendanceLoaded) {
    chart.innerHTML = '<p class="no-feedback">Načítám historii docházky…</p>';
    stats.replaceChildren();
    return;
  }
  const periods = recentPeriods(new Date(), 12);
  const byPeriod = new Map((person.attendanceHistory || []).map(row => [row.period, row.hours]));
  const values = periods.map(period => ({ period, hours: byPeriod.has(period) ? byPeriod.get(period) : null }));
  const known = values.filter(item => item.hours !== null);
  const max = Math.max(1, ...known.map(item => item.hours));
  const total = known.reduce((sum, item) => sum + item.hours, 0);
  const worked = known.filter(item => item.hours > 0);
  const average = worked.length ? total / worked.length : 0;
  const best = worked.reduce((top, item) => (!top || item.hours > top.hours ? item : top), null);
  const monthLabel = period => {
    const [year, month] = period.split("-").map(Number);
    return new Intl.DateTimeFormat("cs-CZ", { month: "short" }).format(new Date(year, month - 1, 1)).replace(".", "");
  };
  const longMonth = period => {
    const [year, month] = period.split("-").map(Number);
    return new Intl.DateTimeFormat("cs-CZ", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
  };
  stats.replaceChildren(...[
    ["Celkem", `${formatNumber(Math.round(total * 10) / 10)} h`],
    ["Průměr na odpracovaný měsíc", `${formatNumber(Math.round(average * 10) / 10)} h`],
    ["Nejsilnější měsíc", best ? `${longMonth(best.period)} · ${formatNumber(best.hours)} h` : "—"]
  ].map(([label, value]) => {
    const item = document.createElement("span");
    const small = document.createElement("small");
    small.textContent = label;
    const strong = document.createElement("strong");
    strong.textContent = value;
    item.append(small, strong);
    return item;
  }));
  if (!known.some(item => item.hours > 0)) {
    chart.innerHTML = '<p class="no-feedback">Za posledních 12 měsíců zatím bez zapsaných hodin.</p>';
    return;
  }
  chart.replaceChildren(...values.map(item => {
    const column = document.createElement("div");
    column.className = "attendance-bar";
    column.classList.toggle("is-current", item.period === periods[periods.length - 1]);
    column.classList.toggle("is-empty", item.hours === null);
    column.title = item.hours === null ? `${longMonth(item.period)}: bez záznamu` : `${longMonth(item.period)}: ${formatNumber(item.hours)} h`;
    const value = document.createElement("span");
    value.className = "attendance-bar-value";
    value.textContent = item.hours === null ? "" : formatNumber(Math.round(item.hours));
    const track = document.createElement("span");
    track.className = "attendance-bar-track";
    const fill = document.createElement("b");
    fill.style.height = `${item.hours ? Math.max(3, item.hours / max * 100) : 0}%`;
    track.append(fill);
    const label = document.createElement("span");
    label.className = "attendance-bar-label";
    label.textContent = monthLabel(item.period);
    column.append(value, track, label);
    return column;
  }));
  chart.setAttribute("aria-label", `Odpracované hodiny za posledních 12 měsíců, celkem ${formatNumber(Math.round(total))} hodin`);
}

async function loadWorkerDetails(person) {
  if (!supabaseClient || !person.remoteId || (person.notesLoaded && person.auditLoaded && person.attendanceLoaded)) return;
  const periods = recentPeriods(new Date(), 12);
  const [notesResult, auditResult, attendanceResult] = await Promise.all([
    supabaseClient.from("worker_notes").select("id, body, created_by, created_by_email, created_at").eq("worker_id", person.remoteId).order("created_at", { ascending: false }).limit(100),
    supabaseClient.from("worker_audit").select("*").eq("worker_id", person.remoteId).order("changed_at", { ascending: false }).limit(50),
    supabaseClient.from("attendance_totals").select("period, hours").eq("worker_id", person.remoteId).gte("period", periods[0]).order("period")
  ]);
  if (!attendanceResult.error) {
    person.attendanceHistory = attendanceResult.data.map(row => ({ period: row.period, hours: Number(row.hours) }));
    person.attendanceLoaded = true;
  }
  workerNotesTableAvailable = !notesResult.error;
  if (!notesResult.error) {
    person.workerNotes = notesResult.data.map(item => ({ id: item.id, body: item.body, createdBy: item.created_by, createdByEmail: item.created_by_email, createdAt: item.created_at }));
    person.notesLoaded = true;
  }
  if (!auditResult.error) {
    person.audit = auditResult.data.map(item => ({ id: item.id, changedAt: item.changed_at, changedBy: item.changed_by_email || "Dřívější uživatel", operation: item.operation, before: item.before_data, after: item.after_data }));
    person.auditLoaded = true;
  }
}

async function addWorkerNote() {
  const person = state.people[elements.personId.value];
  const body = elements.workerNoteInput.value.trim();
  if (!person || !body) {
    elements.workerNoteInput.focus();
    return;
  }
  if (!workerNotesTableAvailable) {
    elements.workerNotesStatus.textContent = "Nejprve spusťte v Supabase migraci worker-notes-migration.sql.";
    elements.workerNotesStatus.classList.add("error");
    return;
  }
  elements.addWorkerNoteButton.disabled = true;
  elements.workerNotesStatus.textContent = "Ukládám…";
  elements.workerNotesStatus.classList.remove("error");
  const note = {
    id: crypto.randomUUID(),
    body,
    createdBy: remoteUser?.id || "local",
    createdByEmail: remoteUser?.email || "",
    createdAt: new Date().toISOString()
  };
  if (supabaseClient && remoteUser && person.remoteId) {
    const { data, error } = await supabaseClient.from("worker_notes").insert({
      worker_id: person.remoteId,
      body,
      created_by: remoteUser.id,
      created_by_email: remoteUser.email.toLowerCase()
    }).select("id, body, created_by, created_by_email, created_at").single();
    if (error) {
      elements.addWorkerNoteButton.disabled = false;
      elements.workerNotesStatus.textContent = `Poznámku se nepodařilo uložit: ${error.message}`;
      elements.workerNotesStatus.classList.add("error");
      return;
    }
    Object.assign(note, {
      id: data.id,
      body: data.body,
      createdBy: data.created_by,
      createdByEmail: data.created_by_email,
      createdAt: data.created_at
    });
  }
  if (!Array.isArray(person.workerNotes)) person.workerNotes = [];
  person.workerNotes.unshift(note);
  elements.workerNoteInput.value = "";
  elements.workerNotesStatus.textContent = "Poznámka byla přidána.";
  elements.addWorkerNoteButton.disabled = false;
  saveState();
  renderWorkerNotes(person);
}

function renderWorkerNotes(person) {
  const notes = Array.isArray(person.workerNotes) ? person.workerNotes : [];
  if (!workerNotesTableAvailable) {
    elements.workerNotesList.innerHTML = '<p class="no-feedback">Pro více poznámek je potřeba spustit databázovou migraci.</p>';
    return;
  }
  if (!notes.length) {
    elements.workerNotesList.innerHTML = '<p class="no-feedback">Zatím nebyla přidána žádná další poznámka.</p>';
    return;
  }
  elements.workerNotesList.replaceChildren(...notes.map(note => {
    const article = document.createElement("article");
    article.className = "worker-note-entry";
    const meta = document.createElement("div");
    meta.className = "worker-note-meta";
    const author = document.createElement("strong");
    author.textContent = note.createdByEmail || "Uživatel";
    const time = document.createElement("time");
    time.dateTime = note.createdAt;
    time.textContent = new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium", timeStyle: "short" }).format(new Date(note.createdAt));
    const body = document.createElement("p");
    body.textContent = note.body;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "feedback-delete";
    remove.textContent = "Smazat";
    remove.addEventListener("click", () => deleteWorkerNote(person, note, remove));
    meta.append(author, time, remove);
    article.append(meta, body);
    return article;
  }));
}

async function deleteWorkerNote(person, note, button) {
  if (!confirm("Opravdu chcete tuto poznámku smazat?")) return;
  button.disabled = true;
  if (supabaseClient && remoteUser && person.remoteId) {
    const { error } = await supabaseClient.from("worker_notes").delete().eq("id", note.id).eq("worker_id", person.remoteId);
    if (error) {
      button.disabled = false;
      elements.workerNotesStatus.textContent = `Poznámku se nepodařilo smazat: ${error.message}`;
      elements.workerNotesStatus.classList.add("error");
      return;
    }
  }
  person.workerNotes = (person.workerNotes || []).filter(item => item.id !== note.id);
  saveState();
  renderWorkerNotes(person);
  elements.workerNotesStatus.textContent = "Poznámka byla smazána.";
  elements.workerNotesStatus.classList.remove("error");
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
    const author = document.createElement("span");
    author.className = "feedback-author";
    author.textContent = item.createdByEmail || "Neznámý uživatel";
    const time = document.createElement("time");
    time.dateTime = item.createdAt;
    time.textContent = new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt));
    const note = document.createElement("p");
    note.textContent = item.note;
    const heading = document.createElement("div");
    heading.className = "feedback-entry-heading";
    const actions = document.createElement("div");
    actions.className = "feedback-entry-actions";
    const deleteButton = document.createElement("button");
    deleteButton.className = "feedback-delete";
    deleteButton.type = "button";
    deleteButton.textContent = "Smazat";
    deleteButton.setAttribute("aria-label", `Smazat ${item.type === "positive" ? "palec nahoru" : "palec dolů"}`);
    deleteButton.addEventListener("click", () => deleteFeedback(person, item, deleteButton));
    actions.append(author, time, deleteButton);
    heading.append(category, actions);
    entry.append(icon, heading, note);
    list.append(entry);
  });
  elements.feedbackHistory.replaceChildren(list);
}

async function deleteFeedback(person, item, button) {
  if (!confirm("Opravdu chcete toto hodnocení smazat?")) return;
  button.disabled = true;
  if (supabaseClient && remoteUser && person.remoteId) {
    const { error } = await supabaseClient.from("feedback").delete().eq("id", item.id).eq("worker_id", person.remoteId);
    if (error) {
      button.disabled = false;
      setMessage(`Hodnocení se nepodařilo smazat: ${error.message}`, true);
      return;
    }
  }
  person.feedback = (person.feedback || []).filter(entry => entry.id !== item.id);
  const metrics = calculateAutomaticMetrics(person.feedback, person.departments);
  person.skills = metrics.skills;
  person.reliability = metrics.reliability;
  if (supabaseClient && remoteUser && person.remoteId) {
    const { error } = await supabaseClient.from("workers").update(metrics).eq("id", person.remoteId);
    if (error) setMessage(`Hodnocení je smazané, ale ukazatele se nepodařilo přepočítat: ${error.message}`, true);
    else await refreshWorkerAudit(person);
  }
  saveState();
  render();
  elements.skillsRange.value = person.skills;
  elements.reliabilityRange.value = person.reliability;
  updateRangeControl(elements.skillsRange, elements.skillsOutput);
  updateRangeControl(elements.reliabilityRange, elements.reliabilityOutput);
  renderFeedbackHistory(person);
  renderAuditHistory(person);
  setMessage("Hodnocení a příslušný palec byly smazány.");
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



function initializeCustomSelects() {
  [
    [elements.sortSelect, false],
    [elements.departmentMatchMode, false],
    [elements.salesPeriodFilter, true],
    [elements.salesPersonFilter, false],
    [elements.salesStatusFilter, false]
  ].forEach(([select, monthGrid]) => enhanceSelect(select, monthGrid));

  document.addEventListener("click", event => {
    document.querySelectorAll(".custom-select.is-open").forEach(wrapper => {
      if (!wrapper.contains(event.target)) closeCustomSelect(wrapper);
    });
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") document.querySelectorAll(".custom-select.is-open").forEach(closeCustomSelect);
  });
}

function enhanceSelect(select, monthGrid = false) {
  if (!select || select.dataset.enhanced === "true") return;
  select.dataset.enhanced = "true";
  select.classList.add("custom-select-native");
  const wrapper = document.createElement("div");
  wrapper.className = `custom-select${monthGrid ? " custom-select-months" : ""}`;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "custom-select-button";
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");
  const value = document.createElement("span");
  const chevron = document.createElement("i");
  chevron.setAttribute("aria-hidden", "true");
  button.append(value, chevron);
  const menu = document.createElement("div");
  menu.className = "custom-select-menu";
  menu.setAttribute("role", "listbox");
  menu.hidden = true;
  select.before(wrapper);
  wrapper.append(select, button, menu);

  const sync = () => {
    const selected = select.options[select.selectedIndex];
    value.textContent = selected?.textContent || "Vyberte…";
    menu.replaceChildren(...[...select.options].filter(option => !option.hidden).map(option => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "custom-select-option";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(option.value === select.value));
      item.textContent = option.textContent;
      if (option.value === select.value) item.classList.add("is-selected");
      item.addEventListener("click", event => {
        event.stopPropagation();
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        sync();
        closeCustomSelect(wrapper);
      });
      return item;
    }));
  };
  select.syncCustomSelect = sync;
  button.addEventListener("click", event => {
    event.stopPropagation();
    const opening = !wrapper.classList.contains("is-open");
    document.querySelectorAll(".custom-select.is-open").forEach(closeCustomSelect);
    if (opening) {
      wrapper.classList.add("is-open");
      menu.hidden = false;
      button.setAttribute("aria-expanded", "true");
    }
  });
  sync();
}

function closeCustomSelect(wrapper) {
  wrapper.classList.remove("is-open");
  const menu = wrapper.querySelector(".custom-select-menu");
  const button = wrapper.querySelector(".custom-select-button");
  if (menu) menu.hidden = true;
  button?.setAttribute("aria-expanded", "false");
}

initializeCustomSelects();
void initializeApp();
