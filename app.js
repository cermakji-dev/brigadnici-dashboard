import {
  DEPARTMENTS, SALES_ASR_TARGET, addMonths, addRosterOnlyWorkers, automaticWorkerId, calculateAutomaticMetrics,
  calculateFreeShiftHours, clampMetric, dateKey, firstDayOfMonth, forEachShiftCell, formatShiftDepartment,
  incompleteOnboardingTasks, isIgnoredShiftName, isLikelyWorkerName, matchesSearch, median, normalizeText,
  parseCsv, parseHours, periodFromSheetName, recentPeriods, slugFromName, startOfDay, stripTrailingTime,
  summarizeSales, addDays, assignLanes, timelineRange, departmentsForLabel, formatClock, mergeShiftBlocks, parseDateKey,
  summarizeShifts, salesByPerson, salesByWeek, buildWorkerLookup
} from "./logic.mjs?v=125";

const STORAGE_KEY = "brigadnici-dashboard-v1";
const VIEW_KEY = "brigadnici-dashboard-view";
const SORT_KEY = "brigadnici-dashboard-sort";
const EDITOR_KEY = "brigadnici-editor-name";
const SORT_OPTIONS = {
  name: { key: "name", direction: "asc" },
  "hours-desc": { key: "hours", direction: "desc" },
  "hours-asc": { key: "hours", direction: "asc" },
  "hours60-desc": { key: "hours60", direction: "desc" },
  "rating-desc": { key: "rating", direction: "desc" },
  "rating-asc": { key: "rating", direction: "asc" },
  "reliability-asc": { key: "reliability", direction: "asc" }
};
let pendingWorkbook = null;
let pendingWorkbookName = "";
let currentImportPeriod = firstDayOfMonth(new Date());
// Měsíc, za který se ukazuje přehled týmu (aktuální = aktivní tým, dřívější =
// seznam z toho měsíčního listu). attendanceByPeriod: období → (ID → hodiny, v seznamu).
let teamPeriod = firstDayOfMonth(new Date());
let attendanceByPeriod = new Map();
let supabaseClient = null;
let messageTimer = null;
let loaderHideTimer = null;
let workerNotesTableAvailable = true;
let salesDaysTableAvailable = true;
let onboardingTableAvailable = true;
let salesDays = [];
let visibleSalesRows = [];
const SALES_MODE_KEY = "brigadnici-sales-mode";
let salesMode = (() => { try { return localStorage.getItem(SALES_MODE_KEY) === "people" ? "people" : "days"; } catch { return "days"; } })();
// Rozepsané reporty přímo v tabulce (id dne → hodnoty) a ručně rozbalené/sbalené dny.
const salesDrafts = new Map();
const salesDayOpen = new Map();
let visibleTeamPeople = [];
const nextShiftsByPerson = new Map();
// Rozpis směn z databáze (plní ho serverová synchronizace každých 5 minut).
let shiftRows = [];
let currentMainView = "team";
let selectedShiftDay = startOfDay(new Date());
const SHIFTS_MODE_KEY = "brigadnici-shifts-mode";
let shiftsMode = (() => { try { return localStorage.getItem(SHIFTS_MODE_KEY) === "month" ? "month" : "day"; } catch { return "day"; } })();
let selectedShiftMonth = new Date(selectedShiftDay.getFullYear(), selectedShiftDay.getMonth(), 1);
// Hodiny za měsíc ze souhrnu měsíčního listu Google tabulky (attendance_totals).
const monthAttendanceCache = new Map();
const MAIN_VIEW_KEY = "brigadnici-main-view";
let lastSyncRun = null;
const SHIFT_WINDOW_PAST_MONTHS = 3;
const SHIFT_WINDOW_FUTURE_DAYS = 45;
const AUTO_REFRESH_MS = 5 * 60 * 1000;
let currentView = localStorage.getItem(VIEW_KEY) === "table" ? "table" : "cards";
let currentSort = loadSavedSort();
let currentSalesSort = { key: "date", direction: "desc" };
const activeQuickFilters = new Set();
let teamRenderFrame = 0;
let monthRosterKnown = false;
const monthRosterPersonIds = new Set();
const monthRosterRemoteIds = new Set();

const state = loadState();
const elements = {
  editorDialog: document.querySelector("#editorDialog"),
  editorForm: document.querySelector("#editorForm"),
  editorNameInput: document.querySelector("#editorNameInput"),
  closeEditorDialog: document.querySelector("#closeEditorDialog"),
  skipEditorName: document.querySelector("#skipEditorName"),
  themeToggles: [...document.querySelectorAll("[data-theme-toggle]")],
  appLoader: document.querySelector("#appLoader"),
  appLoaderStatus: document.querySelector("#appLoaderStatus"),
  appContent: [...document.querySelectorAll(".app-content")],
  editorNameButton: document.querySelector("#editorNameButton"),
  editorNameLabel: document.querySelector("#editorNameLabel"),
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
  searchInput: document.querySelector("#searchInput"),
  clearSearchButton: document.querySelector("#clearSearchButton"),
  visiblePeopleKpi: document.querySelector("#visiblePeopleKpi"),
  teamPeriodSelect: document.querySelector("#teamPeriodSelect"), plannedHoursLabel: document.querySelector("#plannedHoursLabel"),
  plannedHoursNote: document.querySelector("#plannedHoursNote"), profileHoursLabel: document.querySelector("#profileHoursLabel"),
  profilePastShifts: document.querySelector("#profilePastShifts"), profilePastHeading: document.querySelector("#profilePastHeading"),
  averageSkillsKpi: document.querySelector("#averageSkillsKpi"),
  plannedHoursKpi: document.querySelector("#plannedHoursKpi"),
  freeHoursKpi: document.querySelector("#freeHoursKpi"),
  freeHoursShareKpi: document.querySelector("#freeHoursShareKpi"),
  sortSelect: document.querySelector("#sortSelect"),
  salesPersonFilter: document.querySelector("#salesPersonFilter"),
  attendanceHistoryStats: document.querySelector("#attendanceHistoryStats"),
  attendanceHistoryChart: document.querySelector("#attendanceHistoryChart"),
  tableSortButtons: [...document.querySelectorAll(".people-table .table-sort")],
  salesSortButtons: [...document.querySelectorAll(".sales-table .table-sort")],
  addWorkerButton: document.querySelector("#addWorkerButton"),
  teamViewButton: document.querySelector("#teamViewButton"), salesViewButton: document.querySelector("#salesViewButton"), salesPendingBadge: document.querySelector("#salesPendingBadge"),
  shiftsViewButton: document.querySelector("#shiftsViewButton"), shiftsFreeBadge: document.querySelector("#shiftsFreeBadge"),
  shiftsDashboard: document.querySelector("#shiftsDashboard"), shiftsDayTitle: document.querySelector("#shiftsDayTitle"),
  shiftsDaySubtitle: document.querySelector("#shiftsDaySubtitle"), shiftsDateInput: document.querySelector("#shiftsDateInput"),
  shiftsDatePicker: document.querySelector("#shiftsDatePicker"), shiftsDateLabel: document.querySelector("#shiftsDateLabel"),
  shiftsPrevDay: document.querySelector("#shiftsPrevDay"), shiftsNextDay: document.querySelector("#shiftsNextDay"),
  shiftsDayChips: [...document.querySelectorAll("[data-shift-offset]")], shiftsBoard: document.querySelector("#shiftsBoard"),
  shiftsAttention: document.querySelector("#shiftsAttention"), shiftsEmpty: document.querySelector("#shiftsEmpty"),
  shiftsPeopleKpi: document.querySelector("#shiftsPeopleKpi"), shiftsHoursKpi: document.querySelector("#shiftsHoursKpi"),
  shiftsFreeKpi: document.querySelector("#shiftsFreeKpi"), shiftsFreeCard: document.querySelector("#shiftsFreeCard"),
  shiftsReportsKpi: document.querySelector("#shiftsReportsKpi"), shiftsReportsLabel: document.querySelector("#shiftsReportsLabel"),
  shiftsReportsCard: document.querySelector("#shiftsReportsCard"),
  shiftsMonth: document.querySelector("#shiftsMonth"), shiftsModeButtons: [...document.querySelectorAll("[data-shifts-mode]")],
  shiftsPeopleLabel: document.querySelector("#shiftsPeopleLabel"), shiftsHoursLabel: document.querySelector("#shiftsHoursLabel"),
  shiftsFreeLabel: document.querySelector("#shiftsFreeLabel"),
  bulkSalesButton: document.querySelector("#bulkSalesButton"), bulkSalesDialog: document.querySelector("#bulkSalesDialog"),
  bulkSalesForm: document.querySelector("#bulkSalesForm"), bulkSalesTitle: document.querySelector("#bulkSalesTitle"),
  bulkSalesDate: document.querySelector("#bulkSalesDate"), bulkSalesBody: document.querySelector("#bulkSalesBody"),
  bulkSalesStatus: document.querySelector("#bulkSalesStatus"), saveBulkSales: document.querySelector("#saveBulkSales"),
  feedbackQuickReasons: document.querySelector("#feedbackQuickReasons"),
  topbarMenuButton: document.querySelector("#topbarMenuButton"), topbarMenu: document.querySelector("#topbarMenu"),
  teamViewSections: [...document.querySelectorAll(".team-view-section")], salesDashboard: document.querySelector("#salesDashboard"),
  salesNoData: document.querySelector("#salesNoData"), salesNoDataTitle: document.querySelector("#salesNoDataTitle"), salesNoDataText: document.querySelector("#salesNoDataText"),
  salesNoDataFill: document.querySelector("#salesNoDataFill"), salesKpis: document.querySelector(".sales-kpis"), salesTrend: document.querySelector("#salesTrend"),
  salesDaysWrap: document.querySelector("#salesDaysWrap"), salesPeopleWrap: document.querySelector("#salesPeopleWrap"), salesPeopleBody: document.querySelector("#salesPeopleBody"),
  salesModeButtons: [...document.querySelectorAll("[data-sales-mode]")], salesInlineBar: document.querySelector("#salesInlineBar"),
  salesInlineText: document.querySelector("#salesInlineText"), salesInlineSave: document.querySelector("#salesInlineSave"), salesInlineDiscard: document.querySelector("#salesInlineDiscard"),
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
  profileAvatar: document.querySelector("#profileAvatar"), profileStatus: document.querySelector("#profileStatus"),
  profileHours: document.querySelector("#profileHours"), profileNextShift: document.querySelector("#profileNextShift"),
  profileNextShiftMeta: document.querySelector("#profileNextShiftMeta"), profileScore: document.querySelector("#profileScore"),
  profileScoreMeta: document.querySelector("#profileScoreMeta"), profileThumbUp: document.querySelector("#profileThumbUp"),
  profileThumbDown: document.querySelector("#profileThumbDown"), profileTabShifts: document.querySelector("#profileTabShifts"),
  profileTabSales: document.querySelector("#profileTabSales"), profileTabFeedback: document.querySelector("#profileTabFeedback"),
  profileUpcomingShifts: document.querySelector("#profileUpcomingShifts"),
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
  addWorkerStatus: document.querySelector("#addWorkerStatus"),
  confirmAddWorker: document.querySelector("#confirmAddWorker"),
  closeAddWorker: document.querySelector("#closeAddWorker"),
  cancelAddWorker: document.querySelector("#cancelAddWorker"),
  deleteWorkerButton: document.querySelector("#deleteWorkerButton"),
  deleteWorkerDialog: document.querySelector("#deleteWorkerDialog"),
  deleteWorkerForm: document.querySelector("#deleteWorkerForm"),
  deleteWorkerName: document.querySelector("#deleteWorkerName"),
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
  restoreWorkerStatus: document.querySelector("#restoreWorkerStatus"),
  cancelRestoreWorker: document.querySelector("#cancelRestoreWorker"),
  confirmRestoreWorker: document.querySelector("#confirmRestoreWorker")
};

elements.themeToggles.forEach(button => button.addEventListener("click", toggleTheme));
updateThemeControls();
elements.editorNameButton.addEventListener("click", () => openEditorDialog());
elements.editorForm.addEventListener("submit", saveEditorName);
elements.closeEditorDialog.addEventListener("click", () => elements.editorDialog.close());
elements.skipEditorName.addEventListener("click", () => elements.editorDialog.close());
elements.editorDialog.addEventListener("click", closeDialogFromBackdrop);
renderEditorName();
renderEditorName();
elements.googleSheetsButton.addEventListener("click", () => syncGoogleSheets());
elements.syncRefreshButton.addEventListener("click", () => syncGoogleSheets());
elements.importPanelToggle.addEventListener("click", () => setImportCollapsed(!elements.importPanel.classList.contains("is-collapsed")));
elements.cardViewButton.addEventListener("click", () => setViewMode("cards"));
elements.tableViewButton.addEventListener("click", () => setViewMode("table"));
elements.teamViewButton.addEventListener("click", () => setMainView("team"));
elements.salesViewButton.addEventListener("click", () => setMainView("sales"));
elements.shiftsViewButton.addEventListener("click", () => setMainView("shifts"));
elements.shiftsDayChips.forEach(chip => chip.addEventListener("click", () => setShiftDay(addDays(startOfDay(new Date()), Number(chip.dataset.shiftOffset)))));
elements.shiftsPrevDay.addEventListener("click", () => shiftsMode === "month" ? setShiftMonth(-1) : setShiftDay(addDays(selectedShiftDay, -1)));
elements.shiftsNextDay.addEventListener("click", () => shiftsMode === "month" ? setShiftMonth(1) : setShiftDay(addDays(selectedShiftDay, 1)));
elements.shiftsModeButtons.forEach(button => button.addEventListener("click", () => setShiftsMode(button.dataset.shiftsMode)));
elements.teamPeriodSelect.addEventListener("change", () => setTeamPeriod(elements.teamPeriodSelect.value));
elements.shiftsDateInput.addEventListener("change", () => { if (elements.shiftsDateInput.value) setShiftDay(parseDateKey(elements.shiftsDateInput.value)); });
// Celé tlačítko s datem otevře kalendář prohlížeče.
elements.shiftsDatePicker.addEventListener("click", event => {
  if (event.target === elements.shiftsDateInput) return;
  event.preventDefault();
  try { elements.shiftsDateInput.showPicker(); } catch { elements.shiftsDateInput.focus(); }
});
elements.bulkSalesButton.addEventListener("click", () => openBulkSales());
elements.bulkSalesDate.addEventListener("change", () => renderBulkSalesRows(elements.bulkSalesDate.value));
elements.bulkSalesForm.addEventListener("submit", saveBulkSales);
elements.bulkSalesForm.querySelector("#closeBulkSales").addEventListener("click", () => elements.bulkSalesDialog.close());
elements.bulkSalesForm.querySelector("#cancelBulkSales").addEventListener("click", () => elements.bulkSalesDialog.close());
elements.bulkSalesDialog.addEventListener("click", closeDialogFromBackdrop);
elements.profileThumbUp.addEventListener("click", () => openFeedback(elements.personId.value, "positive"));
elements.profileThumbDown.addEventListener("click", () => openFeedback(elements.personId.value, "negative"));
elements.topbarMenuButton.addEventListener("click", event => { event.stopPropagation(); setTopbarMenuOpen(elements.topbarMenu.hidden); });
elements.topbarMenu.addEventListener("click", event => { if (event.target.closest("[role=menuitem]")) setTopbarMenuOpen(false); });
document.addEventListener("click", event => { if (!event.target.closest(".topbar-menu")) setTopbarMenuOpen(false); });
document.addEventListener("keydown", event => { if (event.key === "Escape" && !elements.topbarMenu.hidden) { setTopbarMenuOpen(false); elements.topbarMenuButton.focus(); } });
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
elements.salesPersonFilter.addEventListener("change", renderSalesDashboard);
elements.tableSortButtons.forEach(button => button.addEventListener("click", () => setTableSort(button.dataset.sortKey)));
elements.salesSortButtons.forEach(button => button.addEventListener("click", () => setSalesTableSort(button.dataset.salesSortKey)));
elements.salesModeButtons.forEach(button => button.addEventListener("click", () => {
  salesMode = button.dataset.salesMode === "people" ? "people" : "days";
  try { localStorage.setItem(SALES_MODE_KEY, salesMode); } catch { /* jen pohodlí */ }
  renderSalesDashboard();
}));
elements.salesNoDataFill.addEventListener("click", () => openBulkSales());
elements.salesInlineSave.addEventListener("click", () => saveInlineSales());
elements.salesInlineDiscard.addEventListener("click", () => { salesDrafts.clear(); renderSalesDashboard(); });
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
document.querySelector("#cancelSalesReport").addEventListener("click", () => elements.salesReportDialog.close());
elements.salesReportForm.addEventListener("submit", saveSalesReport);
elements.salesReportDialog.addEventListener("click", closeDialogFromBackdrop);
elements.markNotSalesButton.addEventListener("click", markSalesDayNotSales);
[elements.salesReportHours, elements.salesReportHardware, elements.salesReportServices].forEach(input => input.addEventListener("input", updateSalesReportPreview));
document.addEventListener("keydown", event => {
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
// Detail brigádníka je velké okno uprostřed (modální dialog). Mezi lidmi
// se přepíná šipkami v záhlaví nebo klávesami ← →, záložka zůstává stejná.
elements.dialog.addEventListener("close", () => markSelectedPerson(null));
elements.dialog.addEventListener("click", closeDialogFromBackdrop);
document.querySelector("#profilePrev").addEventListener("click", () => stepPerson(-1));
document.querySelector("#profileNext").addEventListener("click", () => stepPerson(1));
elements.dialog.addEventListener("keydown", event => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.target.closest?.("input, textarea, select, [contenteditable]")) return;
  if (document.querySelector("dialog:modal") !== elements.dialog) return;
  event.preventDefault();
  stepPerson(event.key === "ArrowLeft" ? -1 : 1);
});
window.addEventListener("resize", updateTopbarOffset);
elements.feedbackDialog.addEventListener("click", closeDialogFromBackdrop);
elements.appFeedbackDialog.addEventListener("click", closeDialogFromBackdrop);
elements.appFeedbackButton.addEventListener("click", () => {
  elements.appFeedbackForm.reset();
  elements.appFeedbackCategory.syncCustomSelect?.();
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
    createdByEmail: editorLabel(),
    createdAt: new Date().toISOString()
  };
  if (supabaseClient && person.remoteId) {
    const { data, error } = await supabaseClient.from("feedback").insert({
      worker_id: person.remoteId,
      kind: feedbackItem.type,
      category: feedbackItem.category,
      note: feedbackItem.note,
      created_by: null,
      created_by_email: editorLabel()
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
  if (supabaseClient && person.remoteId) {
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
    renderProfileSummary(person);
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
  elements.confirmDeleteWorker.focus();
}


async function addWorker(event) {
  event.preventDefault();
  const name = elements.newWorkerName.value.trim();
  const externalId = elements.newWorkerId.value.trim();
  const email = elements.newWorkerEmail.value.trim() || null;
  elements.confirmAddWorker.disabled = true;
  setDialogStatus(elements.addWorkerStatus, "Vytvářím kartu…");
  try {
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
  }
}

async function removeWorker(event) {
  event.preventDefault();
  const person = state.people[elements.deleteWorkerDialog.dataset.personId];
  if (!person?.remoteId) return;
  elements.confirmDeleteWorker.disabled = true;
  setDialogStatus(elements.deleteWorkerStatus, "Odebírám z přehledu…");
  try {
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
  setDialogStatus(elements.restoreWorkerStatus, "");
  elements.confirmRestoreWorker.focus();
}

function cancelRestoreWorker() {
  delete elements.inactiveWorkersDialog.dataset.workerId;
  delete elements.inactiveWorkersDialog.dataset.workerName;
  elements.restoreWorkerConfirm.hidden = true;
  elements.cancelRestoreWorker.hidden = true;
  elements.confirmRestoreWorker.hidden = true;
  setDialogStatus(elements.restoreWorkerStatus, "");
}

async function restoreWorker(event) {
  event.preventDefault();
  const workerId = elements.inactiveWorkersDialog.dataset.workerId;
  const workerName = elements.inactiveWorkersDialog.dataset.workerName;
  if (!workerId) return;
  elements.confirmRestoreWorker.disabled = true;
  setDialogStatus(elements.restoreWorkerStatus, "Obnovuji…");
  try {
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
    showLoadError("Chybí konfigurace Supabase nebo se nenačetla jeho knihovna.");
    return;
  }
  createSupabaseClient();
  showAppLoader("Načítám profily brigádníků…");
  try {
    await loadRemoteState();
    render();
    elements.appContent.forEach(element => { element.hidden = false; });
    let savedView = "team";
    try { savedView = localStorage.getItem(MAIN_VIEW_KEY) || "team"; } catch { /* výchozí pohled */ }
    if (["shifts", "sales"].includes(savedView)) setMainView(savedView);
    scheduleAutoRefresh();
    updateAppLoader("Přehled je připravený");
    await waitForAppPaint();
    hideAppLoader();
  } catch (error) {
    showLoadError(error.message || "Data se nepodařilo načíst.");
  }
}

// Aplikace běží bez přihlášení (veřejný přístup, viz supabase/2026-10-28-public-access.sql).
// Případné staré přihlášení z prohlížeče se nepoužije, aby všechny požadavky
// šly pod stejnou veřejnou rolí. Jméno editora jde v hlavičce kvůli historii změn;
// hlavičky nesmí obsahovat diakritiku, proto je URL-kódované.
function createSupabaseClient() {
  const config = window.APP_CONFIG;
  const name = editorName();
  supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "brigadnici-public" },
    global: { headers: name ? { "x-editor-name": encodeURIComponent(name) } : {} }
  });
}

function showLoadError(text) {
  elements.appLoader.hidden = false;
  elements.appLoader.classList.add("is-visible", "has-error");
  updateAppLoader(text);
}

function editorName() {
  try {
    return (localStorage.getItem(EDITOR_KEY) || "").trim();
  } catch {
    return "";
  }
}

// Text ukládaný do sloupců *_by_email u palců, poznámek, reportů a nástupu.
function editorLabel() {
  return editorName() || "Neuvedeno";
}

function renderEditorName() {
  const name = editorName();
  elements.editorNameLabel.textContent = name || "Podepsat se";
  elements.editorNameButton.classList.toggle("is-missing", !name);
}

function openEditorDialog() {
  elements.editorNameInput.value = editorName();
  elements.editorDialog.showModal();
  elements.editorNameInput.focus();
}

function saveEditorName(event) {
  event.preventDefault();
  const name = elements.editorNameInput.value.trim().slice(0, 80);
  if (!name) return;
  localStorage.setItem(EDITOR_KEY, name);
  createSupabaseClient();
  renderEditorName();
  elements.editorDialog.close();
  setMessage(`Změny se budou ukládat pod jménem ${name}.`);
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
    if (supabaseClient && person.remoteId) {
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
    updated_by: null,
    updated_by_email: editorLabel()
  };
  const { error } = await supabaseClient.from("worker_onboarding").upsert(payload, { onConflict: "worker_id" });
  if (error) {
    setMessage(`Nástupní úkol se nepodařilo uložit: ${error.message}`, true);
    return;
  }
  person.onboarding = {
    ...next,
    updatedByEmail: editorLabel(),
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
 
  setMessage("Nástupní úkoly byly uloženy.");
}

async function restoreDepartments(person, departments, status = person.status) {
  const metrics = calculateAutomaticMetrics(person.feedback, departments);
  if (supabaseClient && person.remoteId) {
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
    if (supabaseClient && person.remoteId) {
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
  if (supabaseClient && person.remoteId) {
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


async function loadRemoteState() {
  // Všichni brigádníci (i neaktivní), aby šla zobrazit historie týmu po měsících.
  const workersResult = await supabaseClient.from("workers").select("*").order("full_name");
  if (workersResult.error) throw workersResult.error;
  const workerIds = workersResult.data.map(worker => worker.id);
  const latestPeriod = firstDayOfMonth(new Date());
  const scoped = query => workerIds.length ? query.in("worker_id", workerIds) : query.eq("worker_id", "00000000-0000-0000-0000-000000000000");
  const today = startOfDay(new Date());
  const [attendanceResult, feedbackResult, auditResult, workerNotesResult, salesDaysResult, onboardingResult, shiftsResult, syncRunResult] = await Promise.all([
    supabaseClient.from("attendance_totals").select("worker_id, period, hours, in_list").then(result => result.error
      ? supabaseClient.from("attendance_totals").select("worker_id, period, hours")
      : result),
    scoped(supabaseClient.from("feedback").select("id, worker_id, kind, category, note, created_by_email, created_at")).is("deleted_at", null).order("created_at"),
    Promise.resolve({ data: [], error: null }),
    Promise.resolve({ data: [], error: null }),
    scoped(supabaseClient.from("sales_days").select("*")).gte("shift_date", salesCutoffKey()).order("shift_date", { ascending: false }),
    scoped(supabaseClient.from("worker_onboarding").select("worker_id, training_completed, contracts_completed, taxes_completed, updated_by_email, updated_at")),
    fetchAllRows(() => supabaseClient.from("shifts")
      .select("shift_date, start_minutes, end_minutes, department, column_index, raw_name, worker_id, is_free")
      .gte("shift_date", dateKey(shiftWindowStart(today)))
      .lte("shift_date", dateKey(addDays(today, SHIFT_WINDOW_FUTURE_DAYS)))
      .order("shift_date").order("start_minutes").order("id")),
    supabaseClient.from("sheets_sync_runs").select("status, sheet_name, finished_at, planned_hours, details")
      .eq("status", "success").order("finished_at", { ascending: false }).limit(1).maybeSingle()
  ]);
  monthAttendanceCache.clear();
  const error = workersResult.error || attendanceResult.error || feedbackResult.error || auditResult.error;
  if (error) throw new Error(`Data se nepodařilo načíst: ${error.message}`);
  workerNotesTableAvailable = !workerNotesResult.error;
  salesDaysTableAvailable = !salesDaysResult.error;
  onboardingTableAvailable = !onboardingResult.error;
  salesDays = (salesDaysResult.data || []).map(mapSalesDay);
  shiftRows = shiftsResult.error ? [] : shiftsResult.data.map(mapShiftRow);
  lastSyncRun = syncRunResult.error ? null : syncRunResult.data;
  if (lastSyncRun) {
    state.lastImport = lastSyncRun.finished_at;
    if (lastSyncRun.planned_hours !== null) state.plannedHours = Number(lastSyncRun.planned_hours);
  }

  attendanceByPeriod = new Map();
  attendanceResult.data.forEach(row => {
    if (!attendanceByPeriod.has(row.period)) attendanceByPeriod.set(row.period, new Map());
    attendanceByPeriod.get(row.period).set(row.worker_id, { hours: Number(row.hours) || 0, inList: Boolean(row.in_list) });
  });
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
      changedBy: item.changed_by_email || "Dřívější uživatel",
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
      active: worker.active !== false,
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
  syncTeamPeriodOptions();
  applyTeamPeriod();
  applyShiftSummary();
  saveState();
}

function resolveWorkerIdentity(worker) {
  return { name: worker.full_name, aliases: [...new Set(worker.aliases || [])] };
}

function findActiveWorker(name) {
  const key = slugify(name);
  return Object.values(state.people).find(worker => [worker.name, ...(worker.aliases || [])].some(candidate => slugify(candidate) === key));
}

// Data z Google Sheets stahuje a zapisuje serverová funkce sync-google-sheets
// (pg_cron každých 5 minut). Tlačítko ji jen spustí hned a pak načte výsledek.
async function syncGoogleSheets() {
  const button = elements.googleSheetsButton;
  button.disabled = true;
  elements.syncRefreshButton.disabled = true;
  elements.syncRefreshButton.classList.add("is-loading");
  button.textContent = "Načítám…";
  elements.syncStatusTitle.textContent = "Načítám změny…";
  elements.syncStatusMeta.textContent = "Server stahuje aktuální Google tabulku";
  setMessage("");
  try {
    const { data, error } = await supabaseClient.functions.invoke("sync-google-sheets", { method: "POST", body: {} });
    if (error) {
      const detail = await error.context?.json?.().catch(() => null);
      throw new Error(detail?.error || error.message);
    }
    await refreshData();
    if (data?.status === "skipped") setMessage("Data jsou aktuální, synchronizace proběhla před chvílí.");
    else setMessage(syncResultMessage(data));
  } catch (error) {
    renderSyncStatus();
    setMessage(`Synchronizace se nezdařila: ${error.message || "neznámá chyba"}`, true);
  } finally {
    button.disabled = false;
    elements.syncRefreshButton.disabled = false;
    elements.syncRefreshButton.classList.remove("is-loading");
    button.textContent = "Načíst z Google Sheets";
  }
}

function syncResultMessage(result) {
  const created = result?.unknown_names?.length ? ` Nové karty: ${result.unknown_names.join(", ")}.` : "";
  return `Docházka a rozpis jsou aktuální (${result?.sheet || "aktuální měsíc"}).${created}`;
}

// Tiché obnovení dat, když je karta otevřená a uživatel zrovna nic needituje.
let refreshTimer = null;
function scheduleAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (document.hidden || document.querySelector("dialog:modal") || document.activeElement?.matches("textarea, input")) return;
    void refreshData().catch(() => {});
  }, AUTO_REFRESH_MS);
}

async function refreshData() {
  await loadRemoteState();
  render();
  if (currentMainView === "shifts") renderShiftsDashboard();
  if (currentMainView === "sales") renderSalesDashboard();
}

// PostgREST vrací nejvýš 1000 řádků na dotaz, rozpis jich má víc.
async function fetchAllRows(buildQuery, pageSize = 1000) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
    if (error) return { data: rows, error };
    rows.push(...data);
    if (data.length < pageSize) return { data: rows, error: null };
  }
}

function mapShiftRow(row) {
  return {
    date: row.shift_date,
    start: row.start_minutes,
    end: row.end_minutes,
    department: row.department || "",
    column: row.column_index,
    name: row.raw_name,
    workerId: row.worker_id,
    free: row.is_free
  };
}

// Odvozené hodnoty z rozpisu: hodiny za 60 dní, další směna, volné hodiny
// a kdo patří do přehledu aktuálního měsíce.
function applyShiftSummary() {
  const summary = summarizeShifts(shiftRows, startOfDay(new Date()));
  nextShiftsByPerson.clear();
  Object.values(state.people).forEach(person => {
    person.hours60 = summary.hours60.get(person.remoteId) || 0;
    const block = summary.nextShift.get(person.remoteId);
    if (block) nextShiftsByPerson.set(person.id, { date: parseDateKey(block.date), start: formatClock(block.start), end: formatClock(block.end), department: block.department || "Oddělení neuvedeno" });
  });
  summary.rosterWorkerIds.forEach(id => monthRosterRemoteIds.add(id));
  if (shiftRows.length) state.freeHours = summary.freeHours;
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

// Knihovna pro Excel (~900 kB) se stahuje až při ručním nahrání souboru,
// běžný provoz čte data ze Supabase a nepotřebuje ji.
const XLSX_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
let xlsxLoading = null;
function ensureXlsx() {
  if (typeof XLSX !== "undefined") return Promise.resolve();
  xlsxLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = XLSX_URL;
    script.onload = () => resolve();
    script.onerror = () => { xlsxLoading = null; reject(new Error("Knihovna pro Excel se nenačetla. Zkontrolujte připojení k internetu a zkuste to znovu.")); };
    document.head.append(script);
  });
  return xlsxLoading;
}

async function prepareWorkbook(file, requireCurrentMonth = false) {
  await ensureXlsx();
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
  if (!salesDaysTableAvailable || !supabaseClient) return;
  const totals = new Map();
  const scannedDates = new Set();
  workbook.SheetNames.forEach(sheetName => {
    forEachShiftCell(sheetMatrix(workbook.Sheets[sheetName]), ({ date, slot, text, assignment }) => {
      // Report se zakládá i pro budoucí směny (připravený dopředu);
      // za chybějící se považuje až po skončení dne.
      if (!date) return;
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
  renderSalesDashboard();
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
  if (supabaseClient) await saveAttendanceRemote(totals, sourceName);
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
  if (!supabaseClient) return [];
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
      imported_by: null,
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
 
  renderShiftsBadge();
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
  // Vykresluje se jen zobrazený pohled (karty, nebo tabulka) – polovina práce i DOMu.
  if (currentView === "table") { renderPeopleTable(people); elements.peopleGrid.replaceChildren(); }
  else { elements.peopleGrid.replaceChildren(...people.map(createCard)); elements.peopleTableBody.replaceChildren(); }
  elements.skeletonGrid.hidden = true;
  elements.peopleGrid.hidden = people.length === 0 || currentView !== "cards";
  elements.peopleTableWrap.hidden = people.length === 0 || currentView !== "table";
  elements.cardViewButton.classList.toggle("is-active", currentView === "cards");
  elements.tableViewButton.classList.toggle("is-active", currentView === "table");
  elements.attendancePeople.textContent = allPeople.length;
  elements.attendanceHours.textContent = Number.isFinite(state.plannedHours) ? formatNumber(state.plannedHours) : "—";
  elements.visiblePeopleKpi.textContent = `${people.length} / ${allPeople.length}`;
  document.querySelector("#visiblePeopleNote").textContent = isCurrentTeamPeriod() ? "z aktuálního týmu" : `z týmu v ${teamPeriodLabel(teamPeriod, true)}`;
  elements.averageSkillsKpi.textContent = `${averageMetric(people, "skills")} %`;
  if (isCurrentTeamPeriod()) {
    elements.plannedHoursLabel.textContent = "Plánované hodiny";
    elements.plannedHoursNote.textContent = "celkem v měsíci";
    elements.plannedHoursKpi.textContent = Number.isFinite(state.plannedHours) ? `${formatNumber(state.plannedHours)} h` : "—";
    elements.freeHoursKpi.textContent = Number.isFinite(state.freeHours) ? `${formatNumber(state.freeHours)} h` : "—";
    const freeShare = Number.isFinite(state.freeHours) && Number(state.plannedHours) > 0
      ? state.freeHours / state.plannedHours * 100
      : null;
    elements.freeHoursShareKpi.textContent = Number.isFinite(freeShare)
      ? `${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 }).format(freeShare)} % není obsazeno`
      : "Podíl zatím není dostupný";
  } else {
    // Starší měsíc: odpracováno týmem; volné hodiny se uchovávají jen pro aktuální měsíc.
    const worked = allPeople.reduce((sum, person) => sum + Number(person.hours || 0), 0);
    elements.plannedHoursLabel.textContent = "Odpracované hodiny";
    elements.plannedHoursNote.textContent = `tým v ${teamPeriodLabel(teamPeriod, true)}`;
    elements.plannedHoursKpi.textContent = `${formatNumber(worked)} h`;
    elements.freeHoursKpi.textContent = "—";
    elements.freeHoursShareKpi.textContent = "jen pro aktuální měsíc";
  }
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
    elements.syncStatusMeta.textContent = "Server ji načítá automaticky každých 5 minut";
    return;
  }
  const imported = new Date(state.lastImport);
  const minutes = Math.round((Date.now() - imported.getTime()) / 60000);
  const time = new Intl.DateTimeFormat("cs-CZ", { hour: "2-digit", minute: "2-digit" }).format(imported);
  const day = imported.toDateString() === new Date().toDateString() ? "dnes" : new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric" }).format(imported);
  const stale = minutes > 30;
  elements.syncStatusTitle.textContent = stale ? "Data mohou být zastaralá" : "Docházka synchronizována";
  elements.syncStatusTitle.classList.toggle("is-stale", stale);
  elements.syncStatusMeta.textContent = minutes < 1 ? "Právě teď · automaticky každých 5 minut" : `${day} v ${time} · automaticky každých 5 minut`;
}

function renderPeopleTable(people) {
  elements.peopleTableBody.replaceChildren(...people.map((person, index) => {
    const row = document.createElement("tr");
    row.dataset.personId = person.id;
    row.classList.toggle("is-selected", elements.dialog.open && elements.personId.value === person.id);
    row.style.setProperty("--item-index", index);
    row.tabIndex = 0;
    const departments = Array.isArray(person.departments) && person.departments.length ? person.departments.join(", ") : "—";
    const rating = score(person);
    row.innerHTML = `<td><strong></strong><small></small></td><td class="table-hours"><strong>${formatNumber(person.hours || 0)} h</strong><small>${formatNumber(person.hours60 || 0)} h / 60 dní</small></td><td>${metricCell(person.skills, "skills")}</td><td>${metricCell(person.reliability, "reliability")}</td><td class="table-departments"></td><td class="table-note"><textarea class="inline-note" rows="2" placeholder="Poznámka viditelná v přehledu…" aria-label="Poznámka v přehledu"></textarea></td><td class="table-score"><div class="table-feedback"><button class="feedback-button positive" type="button" aria-label="Přidat palec nahoru">👍 <span>0</span></button><button class="feedback-button negative" type="button" aria-label="Přidat palec dolů">👎 <span>0</span></button><strong class="score"></strong></div></td>`;
    const name = row.querySelector("strong");
    name.textContent = person.name;
    // Další směna pod hodinami (karta ji má přímo v textu, tabulka tady).
    const tableNextShift = nextShiftsByPerson.get(person.id);
    if (tableNextShift) {
      const shiftLine = document.createElement("small");
      shiftLine.className = "table-next-shift";
      const label = shiftDayLabel(tableNextShift.date);
      shiftLine.textContent = `${label || new Intl.DateTimeFormat("cs-CZ", { weekday: "short", day: "numeric", month: "numeric" }).format(tableNextShift.date)} ${tableNextShift.start}–${tableNextShift.end}`;
      shiftLine.title = `Další směna · ${tableNextShift.department}`;
      row.querySelector(".table-hours").append(shiftLine);
    }
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

function setTopbarMenuOpen(open) {
  elements.topbarMenu.hidden = !open;
  elements.topbarMenuButton.setAttribute("aria-expanded", String(open));
  if (open) elements.topbarMenu.querySelector("[role=menuitem]")?.focus();
}

// Aktuální měsíc = aktivní tým (seznam v aktuálním listu). Dřívější měsíc =
// lidé ze seznamu toho měsíce (u starších dat bez seznamu ti s hodinami).
function isPersonInSelectedMonth(person) {
  if (isCurrentTeamPeriod()) return person.active;
  const rows = attendanceByPeriod.get(teamPeriod);
  if (!rows) return false;
  const hasList = [...rows.values()].some(row => row.inList);
  const row = rows.get(person.remoteId);
  return Boolean(row && (hasList ? row.inList : row.hours > 0));
}

function isCurrentTeamPeriod() {
  return teamPeriod === firstDayOfMonth(new Date());
}

const TEAM_MONTHS = ["leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec"];
const TEAM_MONTHS_LOCATIVE = ["lednu", "únoru", "březnu", "dubnu", "květnu", "červnu", "červenci", "srpnu", "září", "říjnu", "listopadu", "prosinci"];
function teamPeriodLabel(period, locative = false) {
  const [year, month] = period.split("-").map(Number);
  const name = (locative ? TEAM_MONTHS_LOCATIVE : TEAM_MONTHS)[month - 1];
  return `${locative ? name : name.charAt(0).toUpperCase() + name.slice(1)} ${year}`;
}

function syncTeamPeriodOptions() {
  const current = firstDayOfMonth(new Date());
  const periods = [...new Set([current, ...attendanceByPeriod.keys()])].filter(period => period <= current).sort().reverse();
  if (!periods.includes(teamPeriod)) teamPeriod = current;
  const select = elements.teamPeriodSelect;
  const signature = periods.join("|");
  if (select.dataset.signature !== signature) {
    select.replaceChildren(...periods.map(period => new Option(period === current ? `${teamPeriodLabel(period)} · aktuální` : teamPeriodLabel(period), period)));
    select.dataset.signature = signature;
  }
  select.value = teamPeriod;
  select.syncCustomSelect?.();
}

// Hodiny na kartách podle vybraného měsíce.
function applyTeamPeriod() {
  const rows = attendanceByPeriod.get(teamPeriod) || new Map();
  Object.values(state.people).forEach(person => { person.hours = rows.get(person.remoteId)?.hours || 0; });
}

function setTeamPeriod(period) {
  teamPeriod = period;
  applyTeamPeriod();
  renderTeam();
 
}

function previousAuditValue(person, field) {
  const audit = Array.isArray(person.audit) ? person.audit : [];
  const change = audit.find(item => item.operation === "UPDATE" && item.before?.[field] !== item.after?.[field]);
  return change ? change.before[field] : null;
}

function setMainView(view) {
  currentMainView = view;
  elements.teamViewSections.forEach(section => { section.hidden = view !== "team"; });
  elements.salesDashboard.hidden = view !== "sales";
  elements.shiftsDashboard.hidden = view !== "shifts";
  elements.teamViewButton.classList.toggle("is-active", view === "team");
  elements.salesViewButton.classList.toggle("is-active", view === "sales");
  elements.shiftsViewButton.classList.toggle("is-active", view === "shifts");
  try { localStorage.setItem(MAIN_VIEW_KEY, view); } catch { /* jen pohodlí */ }
  if (view === "sales") {
    renderSalesDashboard();
    if (!salesDaysTableAvailable) setMessage("Prodejní výkon vyžaduje spuštění migrace sales-performance-migration.sql v Supabase.", true);
  }
  if (view === "shifts") renderShiftsDashboard();
}

// Rychlé dohledání podle ID z databáze (volá se pro každý řádek směn i prodejů).
let remoteIdIndex = new Map();
let remoteIdIndexSource = null;
function personByRemoteId(id) {
  if (!id) return undefined;
  let person = remoteIdIndexSource === state.people ? remoteIdIndex.get(id) : undefined;
  if (!person || person.remoteId !== id) {
    remoteIdIndex = new Map(Object.values(state.people).filter(item => item.remoteId).map(item => [item.remoteId, item]));
    remoteIdIndexSource = state.people;
    person = remoteIdIndex.get(id);
  }
  return person;
}
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
  const filterTodayKey = dateKey(now);
  if (status === "pending") rows = rows.filter(day => day.status === "pending" && day.date < filterTodayKey);
  if (status === "planned") rows = rows.filter(day => day.status === "pending" && day.date >= filterTodayKey);
  if (status === "not_sales") rows = rows.filter(day => day.status === "not_sales");
  if (status === "below") rows = rows.filter(day => day.status === "reported" && salesTargetPercent(day) < 100);
  if (status === "met") rows = rows.filter(day => day.status === "reported" && salesTargetPercent(day) >= 100);
  rows.sort((a, b) => {
    const comparison = compareSalesDays(a, b, currentSalesSort.key);
    return (currentSalesSort.direction === "asc" ? comparison : -comparison)
      || String(b.date).localeCompare(String(a.date));
  });
  updateSalesSortIndicators();
  // Souhrn za vybrané období a člověka; filtr stavu mění jen tabulku.
  const { revenue, hours, asr, aros, targetPercent } = summarizeSales(periodRows);
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
  visibleSalesRows = rows;

  // Dokud v měsíci není nic vyplněno, místo řady nul jen krátká výzva.
  const reportedCount = periodRows.filter(day => day.status === "reported").length;
  const noData = periodRows.length > 0 && reportedCount === 0;
  elements.salesKpis.hidden = noData;
  elements.salesNoData.hidden = !noData;
  if (noData) {
    const monthLabel = selectedMonth === "all" ? "vybrané období" : new Intl.DateTimeFormat("cs-CZ", { month: "long", year: "numeric" }).format(parseDateKey(`${selectedMonth}-01`));
    elements.salesNoDataTitle.textContent = `Za ${monthLabel} zatím žádný vyplněný report`;
    elements.salesNoDataText.textContent = missing ? `Chybí ${missing} ${missing === 1 ? "report" : missing < 5 ? "reporty" : "reportů"}. Vyplnit je jde rovnou v tabulce níže.` : "Prodejní směny se objeví po skončení dne.";
    elements.salesNoDataFill.hidden = missing === 0;
  }

  elements.salesModeButtons.forEach(button => {
    const active = button.dataset.salesMode === salesMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  renderSalesTrend(periodRows);
  const peopleMode = salesMode === "people";
  elements.salesDaysWrap.hidden = peopleMode || rows.length === 0;
  elements.salesPeopleWrap.hidden = !peopleMode || rows.length === 0;
  if (peopleMode) renderSalesPeople(rows);
  else renderSalesDays(rows);
  updateInlineSalesBar();
}

// Dny: řádky seskupené po dnech (při řazení podle data), chybějící reporty
// se vyplňují rovnou v řádku.
function renderSalesDays(rows) {
  const todayKey = dateKey(new Date());
  const grouped = currentSalesSort.key === "date";
  elements.salesDaysWrap.querySelector("table").classList.toggle("is-grouped", grouped);
  const output = [];
  let currentDate = null;
  rows.forEach(day => {
    if (grouped && day.date !== currentDate) {
      currentDate = day.date;
      output.push(createSalesDayHeader(day.date, rows.filter(item => item.date === day.date), todayKey));
    }
    const row = createSalesRow(day, todayKey);
    if (grouped && !isSalesDayOpen(day.date, rows)) row.hidden = true;
    output.push(row);
  });
  elements.salesTableBody.replaceChildren(...output);
}

function isSalesDayOpen(date, rows) {
  if (salesDayOpen.has(date)) return salesDayOpen.get(date);
  // Výchozí stav: rozbalené jsou dny k vyplnění (dnes a dřív s chybějícím
  // reportem) a zítřek; hotové a vzdálenější budoucí dny jsou sbalené.
  const todayKey = dateKey(new Date());
  if (date === dateKey(addDays(startOfDay(new Date()), 1))) return true;
  return date <= todayKey && rows.some(day => day.date === date && day.status === "pending");
}

function createSalesDayHeader(date, dayRows, todayKey) {
  const open = isSalesDayOpen(date, dayRows);
  const row = document.createElement("tr");
  row.className = "sales-day-head";
  row.classList.toggle("is-open", open);
  const cell = document.createElement("td");
  cell.colSpan = 9;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "sales-day-toggle";
  toggle.setAttribute("aria-expanded", String(open));
  const label = new Intl.DateTimeFormat("cs-CZ", { weekday: "long", day: "numeric", month: "numeric" }).format(parseDateKey(date));
  toggle.innerHTML = '<i aria-hidden="true"></i><strong></strong><span></span>';
  toggle.querySelector("strong").textContent = label.charAt(0).toUpperCase() + label.slice(1);
  const pending = dayRows.filter(day => day.status === "pending").length;
  const summary = summarizeSales(dayRows);
  const parts = [`${dayRows.length} ${dayRows.length === 1 ? "člověk" : dayRows.length < 5 ? "lidé" : "lidí"}`];
  if (summary.hours) parts.push(`ASR ${formatCurrency(summary.asr)}/h`);
  toggle.querySelector("span").textContent = parts.join(" · ");
  toggle.addEventListener("click", () => { salesDayOpen.set(date, !open); renderSalesDashboard(); });
  const status = document.createElement("span");
  const future = date > todayKey;
  status.className = `sales-day-status ${future ? "is-planned" : date === todayKey && pending ? "is-today" : pending ? "is-pending" : "is-done"}`;
  status.textContent = future ? `naplánováno ${pending}` : date === todayKey && pending ? `dnes · k vyplnění ${pending}` : pending ? `chybí ${pending}` : "hotovo";
  cell.append(toggle, status);
  if (pending && date <= todayKey) {
    const fill = document.createElement("button");
    fill.type = "button";
    fill.className = "sales-row-action";
    fill.textContent = "Vyplnit den";
    fill.addEventListener("click", () => openBulkSales(date));
    cell.append(fill);
  }
  row.append(cell);
  return row;
}

function createSalesRow(day, todayKey) {
  const person = personByRemoteId(day.workerId);
  const row = document.createElement("tr");
  row.dataset.id = day.id;
  const percent = salesTargetPercent(day);
  // Vyplnit jde od dne směny (i během dne); budoucí směny jsou připravené dopředu.
  const editable = day.status === "pending" && day.date <= todayKey;
  const planned = day.status === "pending" && day.date > todayKey;
  row.classList.toggle("is-editable", editable);
  const cells = Array.from({ length: 9 }, () => document.createElement("td"));
  const name = document.createElement("strong");
  name.textContent = person?.name || "Neznámý brigádník";
  cells[0].append(name);
  cells[1].textContent = new Intl.DateTimeFormat("cs-CZ").format(parseDateKey(day.date));
  cells[1].className = "sales-date-cell";
  cells[7].className = "sales-author";
  cells[7].textContent = day.updatedByEmail || "";
  if (editable) {
    const draft = salesDrafts.get(day.id) || {};
    const input = (field, placeholder, label, step = "1") => {
      const element = document.createElement("input");
      element.type = "number"; element.min = "0"; element.step = step; element.inputMode = "decimal";
      element.className = "sales-inline-input"; element.dataset.field = field;
      element.placeholder = placeholder; element.setAttribute("aria-label", `${label} – ${person?.name || ""}`);
      element.value = draft[field] ?? "";
      element.addEventListener("input", () => updateSalesDraft(row, day));
      element.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); saveInlineSales(); } });
      return element;
    };
    const hours = input("hours", formatNumber(day.plannedHours), "Prodejní hodiny", "0.5");
    const hoursWrap = document.createElement("span");
    hoursWrap.className = "sales-inline-field";
    hoursWrap.append(hours, document.createTextNode(" h"));
    cells[2].append(hoursWrap);
    const revenue = document.createElement("div");
    revenue.className = "sales-inline-revenue";
    revenue.append(input("hardware", "železo Kč", "Železo Kč"), input("services", "služby Kč", "Služby Kč"));
    cells[3].append(revenue);
    cells[4].className = "sales-inline-asr";
    cells[4].textContent = "—";
    cells[5].textContent = "—";
    const badge = document.createElement("span");
    setPendingBadge(badge, day);
    cells[6].append(badge);
    const notSales = document.createElement("button");
    notSales.type = "button";
    notSales.className = "sales-row-action is-quiet";
    notSales.textContent = "Nebyl";
    notSales.title = "Označit, že nebyl na prodeji";
    notSales.addEventListener("click", () => markNotSales(day));
    cells[8].append(notSales);
    if (draft.hours || draft.hardware || draft.services) queueMicrotask(() => updateSalesDraft(row, day));
  } else {
    const reported = day.status === "reported";
    cells[2].textContent = `${formatNumber(reported ? day.salesHours : day.plannedHours)} h`;
    cells[3].textContent = reported ? formatCurrency(salesRevenue(day)) : "—";
    if (reported) cells[3].title = `Železo ${formatCurrency(day.hardware)} · Služby ${formatCurrency(day.services)}`;
    cells[4].textContent = reported ? `${formatCurrency(salesAsr(day))}/h` : "—";
    cells[5].textContent = reported ? formatAros(salesAros(day)) : "—";
    const badge = document.createElement("span");
    badge.className = `sales-result ${reported ? salesPerformanceClass(percent) : planned ? "planned" : day.status}`;
    badge.textContent = planned ? "Naplánováno" : day.status === "pending" ? "Chybí report" : day.status === "not_sales" ? "Nebyl na prodeji" : `${Math.round(percent)} % TGT`;
    cells[6].append(badge);
    if (!planned) {
      const action = document.createElement("button");
      action.type = "button";
      action.className = `sales-row-action${day.status === "pending" ? " is-fill" : ""}`;
      action.textContent = day.status === "pending" ? "Doplnit" : "Detail";
      action.addEventListener("click", () => openSalesReport(day));
      cells[8].append(action);
    }
  }
  row.append(...cells);
  return row;
}

// Dnešní report se teprve vyplňuje, chybějící je až po skončení dne.
function setPendingBadge(badge, day) {
  const today = day.date === dateKey(new Date());
  badge.className = `sales-result ${today ? "today" : "pending"}`;
  badge.textContent = today ? "K vyplnění" : "Chybí report";
}

function readSalesDraft(row) {
  const read = field => row.querySelector(`[data-field="${field}"]`)?.value.trim() ?? "";
  return { hours: read("hours"), hardware: read("hardware"), services: read("services") };
}

// Hodnoty k uložení: prázdné hodiny = plánované hodiny ze směny.
function salesDraftValues(day, draft) {
  const any = Boolean(draft.hours || draft.hardware || draft.services);
  const hours = draft.hours === "" ? Number(day.plannedHours) : Number(draft.hours);
  const complete = any && hours > 0 && draft.hardware !== "" && draft.services !== "" && Number(draft.hardware) >= 0 && Number(draft.services) >= 0;
  return { any, complete, hours, hardware: Number(draft.hardware), services: Number(draft.services) };
}

function updateSalesDraft(row, day) {
  const draft = readSalesDraft(row);
  if (draft.hours || draft.hardware || draft.services) salesDrafts.set(day.id, draft);
  else salesDrafts.delete(day.id);
  const values = salesDraftValues(day, draft);
  const asrCell = row.querySelector(".sales-inline-asr");
  const arosCell = asrCell?.nextElementSibling;
  if (values.complete) {
    const asr = (values.hardware + values.services) / values.hours;
    asrCell.textContent = `${formatCurrency(asr)}/h`;
    arosCell.textContent = formatAros(values.hardware > 0 ? values.services / values.hardware * 100 : null);
    const badge = row.querySelector(".sales-result");
    const percent = asr / SALES_ASR_TARGET * 100;
    badge.className = `sales-result ${salesPerformanceClass(percent)}`;
    badge.textContent = `${Math.round(percent)} % TGT`;
  } else {
    asrCell.textContent = "—";
    arosCell.textContent = "—";
    setPendingBadge(row.querySelector(".sales-result"), day);
  }
  row.classList.toggle("is-draft", values.any);
  row.classList.toggle("is-incomplete", values.any && !values.complete);
  updateInlineSalesBar();
}

function updateInlineSalesBar() {
  const entries = [...salesDrafts].map(([id, draft]) => {
    const day = salesDays.find(item => item.id === id);
    return day ? salesDraftValues(day, draft) : null;
  }).filter(Boolean);
  const ready = entries.filter(values => values.complete).length;
  const incomplete = entries.length - ready;
  elements.salesInlineBar.hidden = entries.length === 0;
  elements.salesInlineSave.disabled = ready === 0;
  elements.salesInlineSave.textContent = ready ? `Uložit ${ready} ${ready === 1 ? "report" : ready < 5 ? "reporty" : "reportů"}` : "Uložit";
  elements.salesInlineText.textContent = incomplete
    ? `${incomplete} ${incomplete === 1 ? "řádek není úplně vyplněný" : incomplete < 5 ? "řádky nejsou úplně vyplněné" : "řádků není úplně vyplněných"} – chybí železo nebo služby.`
    : "Hodiny se předvyplní z rozpisu, stačí zadat železo a služby.";
}

async function saveInlineSales() {
  const changes = [...salesDrafts].map(([id, draft]) => {
    const day = salesDays.find(item => item.id === id);
    const values = day ? salesDraftValues(day, draft) : null;
    return values?.complete ? { day, values } : null;
  }).filter(Boolean);
  if (!changes.length) { updateInlineSalesBar(); return; }
  elements.salesInlineSave.disabled = true;
  elements.salesInlineSave.textContent = "Ukládám…";
  const results = await Promise.all(changes.map(({ day, values }) => supabaseClient.from("sales_days")
    .update({ status: "reported", sales_hours: values.hours, hardware_revenue: values.hardware, services_revenue: values.services, updated_by: null, updated_by_email: editorLabel() })
    .eq("id", day.id).select("*").single()
    .then(result => ({ day, ...result }))));
  const failed = results.filter(result => result.error);
  results.filter(result => !result.error).forEach(result => {
    Object.assign(result.day, mapSalesDay(result.data));
    salesDrafts.delete(result.day.id);
  });
  renderSalesDashboard();
 
  renderTeam();
  if (currentMainView === "shifts") renderShiftsDashboard();
  const saved = results.length - failed.length;
  if (failed.length) setMessage(`Uloženo ${saved}, nepodařilo se ${failed.length}: ${failed[0].error.message}`, true);
  else setMessage(`Uloženo ${saved} ${saved === 1 ? "report" : saved < 5 ? "reporty" : "reportů"}.`);
}

async function markNotSales(day) {
  const previous = { status: day.status, sales_hours: null, hardware_revenue: null, services_revenue: null };
  const apply = async payload => {
    const { data, error } = await supabaseClient.from("sales_days")
      .update({ ...payload, updated_by: null, updated_by_email: editorLabel() }).eq("id", day.id).select("*").single();
    if (error) { setMessage(`Nepodařilo se uložit: ${error.message}`, true); return false; }
    Object.assign(day, mapSalesDay(data));
    salesDrafts.delete(day.id);
    renderSalesDashboard(); renderTeam();
    return true;
  };
  const name = personByRemoteId(day.workerId)?.name || "Brigádník";
  if (await apply({ status: "not_sales", sales_hours: null, hardware_revenue: null, services_revenue: null })) {
    setMessage(`${name}: nebyl na prodeji.`, false, () => apply(previous));
  }
}

// Lidé: žebříček za vybrané období.
function renderSalesPeople(rows) {
  const people = salesByPerson(rows, dateKey(new Date()));
  elements.salesPeopleBody.replaceChildren(...people.map((item, index) => {
    const person = personByRemoteId(item.workerId);
    const row = document.createElement("tr");
    const percent = item.hours ? item.asr / SALES_ASR_TARGET * 100 : 0;
    const cells = Array.from({ length: 9 }, () => document.createElement("td"));
    cells[0].className = "sales-rank";
    cells[0].textContent = item.reported ? index + 1 : "–";
    const nameButton = document.createElement("button");
    nameButton.type = "button";
    nameButton.className = "sales-person-link";
    nameButton.textContent = person?.name || "Neznámý brigádník";
    if (person) nameButton.addEventListener("click", () => { openPerson(person.id); activateProfileTab("sales"); });
    cells[1].append(nameButton);
    cells[2].textContent = `${item.reported} / ${item.days}`;
    cells[3].textContent = item.hours ? `${formatNumber(item.hours)} h` : "—";
    cells[4].textContent = item.revenue ? formatCurrency(item.revenue) : "—";
    cells[5].textContent = item.hours ? `${formatCurrency(item.asr)}/h` : "—";
    cells[6].textContent = item.hours ? formatAros(item.aros) : "—";
    if (item.hours) {
      const meter = document.createElement("div");
      meter.className = `sales-target-meter ${salesPerformanceClass(percent)}`;
      meter.style.setProperty("--share", Math.min(1, percent / 150).toFixed(3));
      meter.innerHTML = "<span></span><strong></strong>";
      meter.querySelector("strong").textContent = `${Math.round(percent)} %`;
      cells[7].append(meter);
    } else cells[7].textContent = "—";
    cells[8].textContent = item.missing || "–";
    if (item.missing) cells[8].className = "sales-missing-count";
    row.append(...cells);
    return row;
  }));
}

// Týmové ASR po týdnech s čárou cíle.
function renderSalesTrend(rows) {
  const weeks = salesByWeek(rows);
  elements.salesTrend.hidden = weeks.length === 0;
  if (!weeks.length) { elements.salesTrend.replaceChildren(); return; }
  // Šířka podle počtu týdnů, aby pár sloupců nebylo roztažených přes celou stránku.
  const slotWidth = 96, height = 150, top = 22, bottom = 26, left = 8, right = 46;
  const width = left + right + slotWidth * Math.max(weeks.length, 4);
  const max = Math.max(SALES_ASR_TARGET * 1.25, ...weeks.map(week => week.asr)) * 1.05;
  const plotHeight = height - top - bottom;
  const y = value => top + plotHeight - (value / max) * plotHeight;
  const slot = slotWidth;
  const barWidth = Math.min(64, slot * 0.6);
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", weeks.map(week => `týden od ${week.week}: ${Math.round(week.asr)} Kč/h`).join(", "));
  const make = (tag, attrs, text) => {
    const element = document.createElementNS(svgNS, tag);
    Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
    if (text !== undefined) element.textContent = text;
    svg.append(element);
    return element;
  };
  make("line", { x1: left, x2: width - right, y1: top + plotHeight, y2: top + plotHeight, class: "trend-axis" });
  weeks.forEach((week, index) => {
    const x = left + slot * index + (slot - barWidth) / 2;
    const met = week.asr >= SALES_ASR_TARGET;
    const bar = make("rect", { x, y: y(week.asr), width: barWidth, height: Math.max(2, top + plotHeight - y(week.asr)), rx: 4, class: met ? "trend-bar is-met" : "trend-bar" });
    const startLabel = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric" }).format(parseDateKey(week.week));
    const title = document.createElementNS(svgNS, "title");
    title.textContent = `Týden od ${startLabel}: ASR ${formatCurrency(week.asr)}/h · ${week.reports} ${week.reports === 1 ? "report" : week.reports < 5 ? "reporty" : "reportů"}`;
    bar.append(title);
    make("text", { x: x + barWidth / 2, y: y(week.asr) - 6, class: "trend-value", "text-anchor": "middle" }, formatNumber(Math.round(week.asr)));
    make("text", { x: x + barWidth / 2, y: height - 8, class: "trend-label", "text-anchor": "middle" }, `od ${startLabel}`);
  });
  make("line", { x1: left, x2: width - right, y1: y(SALES_ASR_TARGET), y2: y(SALES_ASR_TARGET), class: "trend-target" });
  make("text", { x: width - right + 6, y: y(SALES_ASR_TARGET) + 4, class: "trend-target-label" }, "TGT");
  const header = document.createElement("header");
  header.innerHTML = "<h3>Týmové ASR po týdnech</h3><span></span>";
  header.querySelector("span").textContent = `cíl ${formatCurrency(SALES_ASR_TARGET)}/h`;
  elements.salesTrend.replaceChildren(header, svg);
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
  const reported = rows.filter(day => day.status === "reported").length;
  const todayKey = dateKey(new Date());
  const missing = rows.filter(day => day.status === "pending" && day.date < todayKey).length;
  // Bez vyplněného reportu žádná řada nul, jen krátké shrnutí.
  elements.profileSalesSummary.innerHTML = reported
    ? `<div class="profile-stat"><strong>${formatCurrency(asr)}/h</strong><span>ASR</span></div><div class="profile-stat"><strong>${Math.round(targetPercent || 0)} %</strong><span>plnění TGT</span></div><div class="profile-stat"><strong>${formatAros(aros)}</strong><span>ARoS</span></div><div class="profile-stat"><strong>${formatCurrency(revenue)}</strong><span>obrat · ${formatNumber(hours)} h</span></div>`
    : `<div class="profile-stat profile-sales-empty"><strong>Zatím žádný vyplněný report</strong><span>${missing ? `chybí ${missing} ${missing === 1 ? "report" : missing < 5 ? "reporty" : "reportů"}` : "prodejní směny se objeví po synchronizaci rozpisu"}</span></div>`;
  if (!rows.length) { elements.profileSalesHistory.innerHTML = '<p class="no-feedback">Zatím bez prodejních směn.</p>'; return; }
  const sorted = [...rows].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  elements.profileSalesHistory.replaceChildren(...sorted.map(day => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "profile-sales-day";
    const percent = salesTargetPercent(day);
    const isReported = day.status === "reported";
    const planned = day.status === "pending" && day.date > todayKey;
    const today = day.status === "pending" && day.date === todayKey;
    const date = parseDateKey(day.date);
    const weekday = new Intl.DateTimeFormat("cs-CZ", { weekday: "short" }).format(date);
    const dateText = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" }).format(date)}`;
    const detail = isReported
      ? `${formatNumber(day.salesHours)} h · ${formatCurrency(salesRevenue(day))} · ASR ${formatCurrency(salesAsr(day))}/h`
      : day.status === "not_sales" ? "Nebyl na prodeji" : `${formatNumber(day.plannedHours)} h v rozpisu`;
    const badgeClass = isReported ? salesPerformanceClass(percent) : planned ? "planned" : today ? "today" : day.status;
    const badgeText = isReported ? `${Math.round(percent)} % TGT` : planned ? "Naplánováno" : today ? "K vyplnění" : day.status === "not_sales" ? "Nebyl" : "Chybí report";
    const action = isReported || day.status === "not_sales" ? "Detail" : planned ? "" : "Doplnit";
    item.innerHTML = '<strong class="profile-sales-date"></strong><span class="profile-sales-detail"></span><span class="sales-result"></span><span class="profile-sales-action"></span>';
    item.querySelector(".profile-sales-date").textContent = dateText;
    item.querySelector(".profile-sales-detail").textContent = detail;
    const badge = item.querySelector(".sales-result");
    badge.classList.add(badgeClass);
    badge.textContent = badgeText;
    const actionElement = item.querySelector(".profile-sales-action");
    actionElement.textContent = action;
    actionElement.classList.toggle("is-fill", action === "Doplnit");
    if (planned) item.disabled = true;
    item.addEventListener("click", () => openSalesReport(day));
    return item;
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
  const filled = hours > 0 && (hardware > 0 || services > 0);
  elements.salesReportPreview.innerHTML = `<div class="profile-stat"><strong>${formatCurrency(revenue)}</strong><span>obrat celkem</span></div><div class="profile-stat"><strong>${filled ? `${formatCurrency(asr)}/h` : "—"}</strong><span>ASR</span></div><div class="profile-stat"><strong>${formatAros(aros)}</strong><span>ARoS</span></div><div class="profile-stat"><strong>${filled ? `<span class="sales-result ${salesPerformanceClass(percent)}">${Math.round(percent)} % TGT</span>` : "—"}</strong><span>plnění cíle</span></div>`;
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
  if (!day || !supabaseClient) return;
  const buttons = [...elements.salesReportForm.querySelectorAll("button")];
  if (buttons.some(button => button.disabled)) return;
  buttons.forEach(button => { button.disabled = true; });
  setDialogStatus(elements.salesReportStatus, "Ukládám…");
  try {
    const { data, error } = await supabaseClient.from("sales_days")
      .update({ ...changes, updated_by: null, updated_by_email: editorLabel() })
      .eq("id", day.id).select("*").single();
    if (error) {
      setDialogStatus(elements.salesReportStatus, `Report se nepodařilo uložit: ${error.message}`, true);
      return;
    }
    Object.assign(day, mapSalesDay(data));
    elements.salesReportDialog.close();
    renderSalesDashboard();
   
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
  card.dataset.personId = person.id;
  card.classList.toggle("is-selected", elements.dialog.open && elements.personId.value === person.id);
  card.style.setProperty("--item-index", index);
  card.tabIndex = 0;
  card.setAttribute("aria-label", `Zobrazit detail: ${person.name}`);
  const name = card.querySelector("h3");
  name.textContent = person.name;
  const email = card.querySelector(".email");
  email.textContent = person.email || "";
  const avatar = card.querySelector(".avatar");
  if (person.photo) avatar.style.backgroundImage = `url("${safeCssUrl(person.photo)}")`;
  else avatar.textContent = initials(person.name);
  card.querySelector(".hours-value").textContent = formatNumber(person.hours || 0);
  card.querySelector(".hours-label").textContent = isCurrentTeamPeriod() ? "h tento měsíc" : `h v ${teamPeriodLabel(teamPeriod, true)}`;
  card.querySelector(".hours-60-value").textContent = formatNumber(person.hours60 || 0);
  const nextShift = nextShiftsByPerson.get(person.id);
  const nextShiftElement = card.querySelector(".card-next-shift");
  if (nextShift) {
    const label = shiftDayLabel(nextShift.date);
    const day = label || new Intl.DateTimeFormat("cs-CZ", { weekday: "short", day: "numeric", month: "numeric" }).format(nextShift.date);
    nextShiftElement.textContent = `Další směna ${label ? day.toLocaleLowerCase("cs") : day} ${nextShift.start}–${nextShift.end}`;
    nextShiftElement.title = nextShift.department;
    nextShiftElement.classList.toggle("is-soon", label === "Dnes" || label === "Zítra");
  } else {
    nextShiftElement.textContent = "Bez další směny";
    nextShiftElement.classList.add("is-empty");
  }
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
  const noteWrap = card.querySelector(".card-note");
  const noteInput = card.querySelector(".inline-note");
  const addNoteButton = card.querySelector(".add-note-button");
  setupInlineNote(noteInput, person);
  noteWrap.hidden = !person.notes;
  addNoteButton.hidden = Boolean(person.notes);
  addNoteButton.addEventListener("click", event => {
    event.stopPropagation();
    noteWrap.hidden = false;
    addNoteButton.hidden = true;
    noteInput.focus();
  });
  noteInput.addEventListener("blur", () => {
    if (noteInput.value.trim()) return;
    noteWrap.hidden = true;
    addNoteButton.hidden = false;
  });
  const personSales = salesDays.filter(day => day.workerId === person.remoteId);
  const pendingSales = personSales.filter(day => day.status === "pending" && day.date < dateKey(new Date())).length;
  // Co vyžaduje akci – jediná barevně zvýrazněná místa na kartě.
  const flags = [];
  const onboarding = incompleteOnboardingTasks(person.onboarding);
  if (onboarding.length) flags.push(["onboarding", `Nástup ${3 - onboarding.length}/3`, `Zbývá: ${onboarding.join(", ")}`]);
  if (pendingSales) flags.push(["sales", `${pendingSales} ${pendingSales === 1 ? "report chybí" : pendingSales < 5 ? "reporty chybí" : "reportů chybí"}`, "Doplnit prodejní reporty"]);
  const flagsElement = card.querySelector(".card-flags");
  flagsElement.hidden = !flags.length;
  flagsElement.replaceChildren(...flags.map(([type, text, title]) => {
    const flag = document.createElement(type === "sales" ? "button" : "span");
    flag.className = `card-flag ${type}`;
    flag.textContent = text;
    flag.title = title;
    if (type === "sales") {
      flag.type = "button";
      flag.addEventListener("click", event => { event.stopPropagation(); openSalesForPerson(person); });
    }
    return flag;
  }));
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

// ---------------------------------------------------------------------------
// Pohled Docházka: kdo je ve vybraný den na jakém oddělení, volné směny s návrhem
// náhrady a chybějící prodejní reporty.
// ---------------------------------------------------------------------------
function setShiftDay(date) {
  selectedShiftDay = startOfDay(date);
  selectedShiftMonth = new Date(selectedShiftDay.getFullYear(), selectedShiftDay.getMonth(), 1);
  renderShiftsDashboard();
}

function shiftWindowStart(today) {
  return new Date(today.getFullYear(), today.getMonth() - SHIFT_WINDOW_PAST_MONTHS, 1);
}

function setShiftsMode(mode) {
  shiftsMode = mode === "month" ? "month" : "day";
  try { localStorage.setItem(SHIFTS_MODE_KEY, shiftsMode); } catch { /* jen pohodlí */ }
  renderShiftsDashboard();
}

function setShiftMonth(step) {
  const today = startOfDay(new Date());
  const min = shiftWindowStart(today);
  const max = addDays(today, SHIFT_WINDOW_FUTURE_DAYS);
  const next = new Date(selectedShiftMonth.getFullYear(), selectedShiftMonth.getMonth() + step, 1);
  if (next < new Date(min.getFullYear(), min.getMonth(), 1) || next > max) return;
  selectedShiftMonth = next;
  renderShiftsDashboard();
}

function shiftDayLabel(date) {
  const offset = Math.round((startOfDay(date) - startOfDay(new Date())) / 86400000);
  return { "-1": "Včera", "0": "Dnes", "1": "Zítra" }[offset] || null;
}

function freeShiftBlocksFrom(date) {
  const fromKey = dateKey(date);
  return mergeShiftBlocks(shiftRows.filter(shift => shift.free && shift.date >= fromKey));
}

function renderShiftsBadge() {
  // Žlutý vykřičník jen tehdy, když na dnešek připadá neobsazená směna.
  const todayKey = dateKey(startOfDay(new Date()));
  const count = freeShiftBlocksFrom(startOfDay(new Date())).filter(block => block.date === todayKey).length;
  elements.shiftsFreeBadge.hidden = count === 0;
  elements.shiftsFreeBadge.title = count === 1 ? "Dnes je 1 neobsazená směna" : `Dnes jsou neobsazené směny (${count})`;
  elements.shiftsFreeBadge.setAttribute("aria-label", elements.shiftsFreeBadge.title);
}

function renderShiftsDashboard() {
  renderShiftsBadge();
  if (elements.shiftsDashboard.hidden) return;
  const monthMode = shiftsMode === "month";
  elements.shiftsDashboard.classList.toggle("is-month", monthMode);
  elements.shiftsModeButtons.forEach(button => {
    const active = button.dataset.shiftsMode === shiftsMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  elements.shiftsPrevDay.setAttribute("aria-label", monthMode ? "Předchozí měsíc" : "Předchozí den");
  elements.shiftsNextDay.setAttribute("aria-label", monthMode ? "Další měsíc" : "Další den");
  elements.shiftsDayChips.forEach(chip => { chip.hidden = monthMode; });
  elements.shiftsDatePicker.hidden = monthMode;
  elements.shiftsMonth.hidden = !monthMode;
  if (monthMode) { renderShiftsMonth(); return; }
  setShiftsSummaryLabels(false);
  const day = selectedShiftDay;
  const key = dateKey(day);
  const todayKey = dateKey(startOfDay(new Date()));
  const label = shiftDayLabel(day);
  const longDate = new Intl.DateTimeFormat("cs-CZ", { weekday: "long", day: "numeric", month: "long" }).format(day);
  elements.shiftsDayTitle.textContent = label ? `${label} · ${longDate}` : longDate.charAt(0).toUpperCase() + longDate.slice(1);
  elements.shiftsDateInput.value = key;
  // „St 11. 11. 2026“ – den v týdnu je vidět i při překlikávání šipkami.
  const weekday = new Intl.DateTimeFormat("cs-CZ", { weekday: "short" }).format(day);
  elements.shiftsDateLabel.textContent = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" }).format(day)}`;
  elements.shiftsDayChips.forEach(chip => chip.classList.toggle("is-active", shiftDayLabel(day) === chip.textContent.trim()));

  const dayShifts = shiftRows.filter(shift => shift.date === key);
  const blocks = mergeShiftBlocks(dayShifts);
  const workBlocks = blocks.filter(block => !block.free);
  const freeBlocks = blocks.filter(block => block.free);
  const peopleOnShift = new Set(workBlocks.map(block => block.workerId || `n:${normalize(block.name)}`));
  const workedHours = workBlocks.reduce((sum, block) => sum + block.hours, 0);
  const freeHours = freeBlocks.reduce((sum, block) => sum + block.hours, 0);
  elements.shiftsPeopleKpi.textContent = peopleOnShift.size;
  elements.shiftsHoursKpi.textContent = `${formatNumber(workedHours)} h`;
  elements.shiftsFreeKpi.textContent = `${formatNumber(freeHours)} h`;
  elements.shiftsFreeCard.classList.toggle("attention", freeHours > 0);

  const reports = salesDays.filter(item => item.date === key);
  const pendingReports = reports.filter(item => item.status === "pending");
  const past = key < todayKey;
  elements.shiftsReportsLabel.textContent = past ? "Chybí report" : "Na prodeji";
  elements.shiftsReportsKpi.textContent = past ? pendingReports.length : new Set(workBlocks.filter(block => normalize(block.department).includes("prodej")).map(block => block.workerId || block.name)).size;
  elements.shiftsReportsCard.classList.toggle("attention", past && pendingReports.length > 0);

  const lastSync = state.lastImport ? new Intl.DateTimeFormat("cs-CZ", { hour: "2-digit", minute: "2-digit" }).format(new Date(state.lastImport)) : null;
  elements.shiftsDaySubtitle.textContent = dayShifts.length && lastSync ? `Rozpis načten v ${lastSync}` : "";

  renderShiftsAttention({ key, past, freeBlocks, dayShifts, pendingReports });

  elements.shiftsEmpty.hidden = dayShifts.length > 0;
  renderShiftsTimeline(blocks, key === todayKey);
}

function setShiftsSummaryLabels(month) {
  elements.shiftsPeopleLabel.textContent = month ? "Lidí v rozpisu" : "Lidí na směně";
  elements.shiftsHoursLabel.textContent = "Obsazené hodiny";
  if (!month) {
    elements.shiftsFreeLabel.textContent = "Volné hodiny";
    elements.shiftsPrevDay.disabled = false;
    elements.shiftsNextDay.disabled = false;
  }
}

const MONTH_NAMES_CS = ["leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec"];

async function loadMonthAttendance(period) {
  if (monthAttendanceCache.has(period)) return monthAttendanceCache.get(period);
  const { data, error } = await supabaseClient.from("attendance_totals").select("worker_id, hours").eq("period", period);
  const rows = error ? null : (data || []).map(row => ({ workerId: row.worker_id, hours: Number(row.hours) || 0 }));
  if (rows) monthAttendanceCache.set(period, rows);
  return rows;
}

// Celý měsíc: řádek pro každý den, vodorovně hodiny. Sytost buňky = kolik lidí
// v tu hodinu pracuje, šrafování = volná směna. Klik na den otevře jeho detail.
function renderShiftsMonth() {
  setShiftsSummaryLabels(true);
  const month = selectedShiftMonth;
  const year = month.getFullYear();
  const prefix = `${year}-${String(month.getMonth() + 1).padStart(2, "0")}`;
  const period = `${prefix}-01`;
  const todayKey = dateKey(startOfDay(new Date()));
  const monthName = MONTH_NAMES_CS[month.getMonth()];
  elements.shiftsDayTitle.textContent = `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)} ${year}`;
  const today = startOfDay(new Date());
  const minMonth = shiftWindowStart(today);
  elements.shiftsPrevDay.disabled = month <= minMonth;
  elements.shiftsNextDay.disabled = new Date(year, month.getMonth() + 1, 1) > addDays(today, SHIFT_WINDOW_FUTURE_DAYS);

  const monthShifts = shiftRows.filter(shift => shift.date.startsWith(prefix));
  const blocks = mergeShiftBlocks(monthShifts);
  const work = blocks.filter(block => !block.free);
  const free = blocks.filter(block => block.free);
  const workedHours = work.reduce((sum, block) => sum + block.hours, 0);
  const freeHours = free.reduce((sum, block) => sum + block.hours, 0);
  const people = new Set(work.map(block => block.workerId || `n:${normalize(block.name)}`));
  elements.shiftsPeopleKpi.textContent = people.size;
  elements.shiftsHoursKpi.textContent = `${formatNumber(workedHours)} h`;
  elements.shiftsFreeKpi.textContent = `${formatNumber(freeHours)} h`;
  elements.shiftsFreeLabel.textContent = free.length ? `Volné hodiny · ${free.length} ${free.length === 1 ? "směna" : free.length < 5 ? "směny" : "směn"}` : "Volné hodiny";
  elements.shiftsFreeCard.classList.toggle("attention", free.some(block => block.date >= todayKey));
  const total = workedHours + freeHours;
  elements.shiftsReportsKpi.textContent = total ? `${Math.round(workedHours / total * 100)} %` : "—";
  elements.shiftsReportsLabel.textContent = "Obsazenost";
  elements.shiftsReportsCard.classList.remove("attention");
  const lastSync = state.lastImport ? new Intl.DateTimeFormat("cs-CZ", { hour: "2-digit", minute: "2-digit" }).format(new Date(state.lastImport)) : null;
  elements.shiftsDaySubtitle.textContent = monthShifts.length && lastSync ? `Rozpis načten v ${lastSync}` : "";
  elements.shiftsAttention.replaceChildren();
  elements.shiftsAttention.hidden = true;
  elements.shiftsBoard.replaceChildren();
  elements.shiftsBoard.hidden = true;
  elements.shiftsEmpty.hidden = monthShifts.length > 0;
  if (!monthShifts.length) { elements.shiftsMonth.replaceChildren(); elements.shiftsMonth.hidden = true; return; }
  elements.shiftsMonth.hidden = false;

  const [from, to] = timelineRange(blocks);
  const hours = Array.from({ length: (to - from) / 60 }, (_, index) => from + index * 60);
  const byDay = new Map();
  blocks.forEach(block => { if (!byDay.has(block.date)) byDay.set(block.date, []); byDay.get(block.date).push(block); });
  const cellStats = dayBlocks => hours.map(start => {
    const end = start + 60;
    const inHour = dayBlocks.filter(block => block.start < end && block.end > start);
    return {
      start,
      people: new Set(inHour.filter(block => !block.free).map(block => block.workerId || block.name)).size,
      free: inHour.filter(block => block.free).length
    };
  });
  const allCells = [...byDay.values()].flatMap(cellStats);
  const maxPeople = Math.max(1, ...allCells.map(cell => cell.people));

  const timeline = document.createElement("div");
  timeline.className = "month-timeline";
  timeline.style.setProperty("--month-hours", hours.length);
  const head = document.createElement("div");
  head.className = "month-row month-head";
  const headDay = document.createElement("span");
  headDay.textContent = "Den";
  const headHours = document.createElement("div");
  headHours.className = "month-cells";
  hours.forEach(start => {
    const tick = document.createElement("span");
    tick.textContent = start / 60;
    headHours.append(tick);
  });
  const headPeople = document.createElement("span");
  headPeople.textContent = "Lidé";
  const headWorked = document.createElement("span");
  headWorked.textContent = "Hodiny";
  const headFree = document.createElement("span");
  headFree.textContent = "Volno";
  head.append(headDay, headHours, headPeople, headWorked, headFree);
  timeline.append(head);

  const daysInMonth = new Date(year, month.getMonth() + 1, 0).getDate();
  for (let dayNumber = 1; dayNumber <= daysInMonth; dayNumber += 1) {
    const date = new Date(year, month.getMonth(), dayNumber);
    const key = dateKey(date);
    const dayBlocks = byDay.get(key) || [];
    const row = document.createElement("button");
    row.type = "button";
    row.className = "month-row month-day";
    const weekday = date.getDay();
    row.classList.toggle("is-weekend", weekday === 0 || weekday === 6);
    row.classList.toggle("is-today", key === todayKey);
    row.classList.toggle("is-past", key < todayKey);
    row.classList.toggle("is-empty", !dayBlocks.length);
    const label = document.createElement("span");
    label.className = "month-day-label";
    const weekdayLabel = new Intl.DateTimeFormat("cs-CZ", { weekday: "short" }).format(date);
    label.innerHTML = "<small></small><strong></strong>";
    label.querySelector("small").textContent = weekdayLabel;
    label.querySelector("strong").textContent = `${dayNumber}.`;
    const cells = document.createElement("div");
    cells.className = "month-cells";
    const dayWork = dayBlocks.filter(block => !block.free);
    const dayFree = dayBlocks.filter(block => block.free);
    if (dayBlocks.length) {
      cellStats(dayBlocks).forEach(cell => {
        const element = document.createElement("span");
        element.className = "month-cell";
        if (cell.people) element.style.setProperty("--fill", (0.18 + 0.82 * cell.people / maxPeople).toFixed(2));
        element.classList.toggle("has-people", cell.people > 0);
        element.classList.toggle("has-free", cell.free > 0);
        element.title = `${formatClock(cell.start)}–${formatClock(cell.start + 60)} · ${cell.people} ${cell.people === 1 ? "člověk" : cell.people >= 2 && cell.people <= 4 ? "lidé" : "lidí"}${cell.free ? ` · ${cell.free} volná` : ""}`;
        cells.append(element);
      });
    } else {
      const note = document.createElement("span");
      note.className = "month-day-note";
      note.textContent = "Bez směn v rozpisu";
      cells.append(note);
    }
    const peopleCount = document.createElement("span");
    peopleCount.textContent = dayWork.length ? new Set(dayWork.map(block => block.workerId || block.name)).size : "–";
    const worked = document.createElement("span");
    const dayHours = dayWork.reduce((sum, block) => sum + block.hours, 0);
    worked.textContent = dayHours ? `${formatNumber(dayHours)} h` : "–";
    const freeCell = document.createElement("span");
    const dayFreeHours = dayFree.reduce((sum, block) => sum + block.hours, 0);
    freeCell.textContent = dayFreeHours ? `${formatNumber(dayFreeHours)} h` : "–";
    freeCell.classList.toggle("is-free", dayFreeHours > 0);
    row.append(label, cells, peopleCount, worked, freeCell);
    row.setAttribute("aria-label", `${weekdayLabel} ${dayNumber}. – otevřít rozpis dne`);
    row.addEventListener("click", () => { selectedShiftDay = date; setShiftsMode("day"); });
    timeline.append(row);
  }

  const peopleCard = document.createElement("section");
  peopleCard.className = "month-people";
  const header = document.createElement("header");
  const title = document.createElement("h3");
  title.textContent = "Hodiny v měsíci";
  const source = document.createElement("span");
  source.textContent = "podle Google tabulky";
  header.append(title, source);
  const list = document.createElement("ol");
  list.className = "month-people-list";
  peopleCard.append(header, list);
  const legend = document.createElement("p");
  legend.className = "month-legend";
  legend.innerHTML = '<span class="legend-fill"></span>čím sytější, tím víc lidí <span class="legend-free"></span>volná směna';
  elements.shiftsMonth.replaceChildren(legend, timeline, peopleCard);

  const rosterHours = new Map();
  work.forEach(block => { if (block.workerId) rosterHours.set(block.workerId, (rosterHours.get(block.workerId) || 0) + block.hours); });
  const renderPeople = attendance => {
    if (selectedShiftMonth !== month || shiftsMode !== "month") return;
    const totals = new Map();
    (attendance || []).forEach(row => { if (row.hours > 0) totals.set(row.workerId, row.hours); });
    const fromSheet = totals.size > 0;
    if (!fromSheet) rosterHours.forEach((value, id) => totals.set(id, value));
    source.textContent = fromSheet ? "podle Google tabulky" : "podle rozpisu směn";
    const items = [...totals].map(([id, value]) => ({ person: personByRemoteId(id), hours: value }))
      .filter(item => item.person)
      .sort((a, b) => b.hours - a.hours || a.person.name.localeCompare(b.person.name, "cs"));
    const max = Math.max(1, ...items.map(item => item.hours));
    list.replaceChildren(...items.map(item => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      const name = document.createElement("span");
      name.className = "month-person-name";
      name.textContent = item.person.name;
      const bar = document.createElement("span");
      bar.className = "month-person-bar";
      bar.style.setProperty("--share", (item.hours / max).toFixed(3));
      const value = document.createElement("strong");
      value.textContent = `${formatNumber(item.hours)} h`;
      button.append(name, bar, value);
      button.addEventListener("click", () => openPerson(item.person.id));
      li.append(button);
      return li;
    }));
    peopleCard.hidden = items.length === 0;
  };
  renderPeople(monthAttendanceCache.get(period) || null);
  loadMonthAttendance(period).then(renderPeople).catch(() => {});
}

// Časová osa dne: řádek pro každé oddělení, vodorovně hodiny, směny jako pruhy.
function renderShiftsTimeline(blocks, isToday) {
  const board = elements.shiftsBoard;
  if (!blocks.length) { board.replaceChildren(); board.hidden = true; return; }
  board.hidden = false;
  const [from, to] = timelineRange(blocks);
  const span = to - from;
  const position = minutes => `${((minutes - from) / span) * 100}%`;
  const hours = span / 60;
  board.style.setProperty("--timeline-hours", hours);

  const scale = document.createElement("div");
  scale.className = "timeline-scale";
  scale.append(document.createElement("span"));
  const ticks = document.createElement("div");
  ticks.className = "timeline-ticks";
  for (let minute = from; minute <= to; minute += 60) {
    const tick = document.createElement("span");
    tick.style.left = position(minute);
    tick.textContent = `${minute / 60}:00`;
    ticks.append(tick);
  }
  scale.append(ticks);

  const rows = new Map();
  blocks.forEach(block => {
    const name = block.department || "Bez oddělení";
    if (!rows.has(name)) rows.set(name, { name, order: block.column, blocks: [] });
    const row = rows.get(name);
    row.order = Math.min(row.order, block.column);
    row.blocks.push(block);
  });
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const rowElements = [...rows.values()].sort((a, b) => a.order - b.order).map(row => {
    const element = document.createElement("div");
    element.className = "timeline-row";
    const label = document.createElement("div");
    label.className = "timeline-label";
    const title = document.createElement("strong");
    title.textContent = row.name;
    const meta = document.createElement("small");
    const people = new Set(row.blocks.filter(block => !block.free).map(block => block.workerId || block.name)).size;
    const free = row.blocks.filter(block => block.free).reduce((sum, block) => sum + block.hours, 0);
    meta.textContent = `${people} ${people === 1 ? "člověk" : people >= 2 && people <= 4 ? "lidé" : "lidí"}${free ? ` · ${formatNumber(free)} h volno` : ""}`;
    label.append(title, meta);
    const { blocks: placed, lanes } = assignLanes(row.blocks);
    const track = document.createElement("div");
    track.className = "timeline-track";
    track.style.setProperty("--lanes", lanes);
    placed.forEach(block => track.append(createTimelineBlock(block, position, span)));
    if (isToday && nowMinutes > from && nowMinutes < to) {
      const line = document.createElement("span");
      line.className = "timeline-now";
      line.style.left = position(nowMinutes);
      track.append(line);
    }
    element.append(label, track);
    return element;
  });
  board.replaceChildren(scale, ...rowElements);
}

function createTimelineBlock(block, position, span) {
  const person = block.workerId ? personByRemoteId(block.workerId) : null;
  const element = document.createElement(block.free || person ? "button" : "div");
  element.className = "timeline-block";
  element.style.left = position(block.start);
  element.style.width = `calc(${((block.end - block.start) / span) * 100}% - 3px)`;
  element.style.setProperty("--lane", block.lane);
  const time = `${formatClock(block.start)}–${formatClock(block.end)}`;
  const name = document.createElement("strong");
  const meta = document.createElement("small");
  meta.textContent = time;
  if (block.free) {
    element.type = "button";
    element.classList.add("is-free");
    name.textContent = "Volno";
    element.title = `Volná směna ${time} – zobrazit, kdo by ji mohl vzít`;
    element.addEventListener("click", () => {
      const target = document.querySelector(`[data-free-key="${block.date}|${block.start}|${block.column}"]`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.classList.remove("is-highlighted");
      requestAnimationFrame(() => target?.classList.add("is-highlighted"));
    });
  } else {
    name.textContent = person?.name || block.name;
    element.title = `${person?.name || block.name} · ${time} · ${formatNumber(block.hours)} h`;
    if (person) {
      element.type = "button";
      element.addEventListener("click", () => openPerson(person.id));
      if (isNewcomer(person)) element.classList.add("is-newcomer");
    } else {
      element.classList.add("is-unmatched");
    }
  }
  element.append(name, meta);
  return element;
}


function renderShiftsAttention({ key, past, freeBlocks, dayShifts, pendingReports }) {
  const cards = [];
  if (!past && freeBlocks.length) {
    const card = document.createElement("section");
    card.className = "free-shifts";
    const heading = document.createElement("header");
    const title = document.createElement("h3");
    const total = freeBlocks.reduce((sum, block) => sum + block.hours, 0);
    title.textContent = "Volné směny";
    const count = document.createElement("span");
    count.textContent = `${freeBlocks.length} ${freeBlocks.length === 1 ? "směna" : freeBlocks.length < 5 ? "směny" : "směn"} · ${formatNumber(total)} h`;
    heading.append(title, count);
    const list = document.createElement("ul");
    list.replaceChildren(...[...freeBlocks].sort((a, b) => a.start - b.start).map(block => {
      const item = document.createElement("li");
      item.dataset.freeKey = `${block.date}|${block.start}|${block.column}`;
      const time = document.createElement("strong");
      time.textContent = `${formatClock(block.start)}–${formatClock(block.end)}`;
      const department = document.createElement("span");
      department.className = "free-shift-department";
      department.textContent = `${block.department || "Oddělení neuvedeno"} · ${formatNumber(block.hours)} h`;
      item.append(time, department);
      return item;
    }));
    card.append(heading, list);
    cards.push(card);
  }
  if (past && pendingReports.length) {
    const card = document.createElement("article");
    card.className = "shift-alert is-report";
    const text = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `Chybí ${pendingReports.length} ${pendingReports.length === 1 ? "prodejní report" : pendingReports.length < 5 ? "prodejní reporty" : "prodejních reportů"}`;
    const meta = document.createElement("span");
    meta.textContent = pendingReports.map(item => personByRemoteId(item.workerId)?.name).filter(Boolean).join(", ");
    text.append(title, meta);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-primary";
    button.textContent = "Vyplnit reporty za den";
    button.addEventListener("click", () => openBulkSales(key));
    card.append(text, button);
    cards.push(card);
  }
  elements.shiftsAttention.replaceChildren(...cards);
  elements.shiftsAttention.hidden = cards.length === 0;
}

// ---------------------------------------------------------------------------
// Hromadné vyplnění prodejních reportů za jeden den.
// ---------------------------------------------------------------------------
function openBulkSales(date) {
  const todayKey = dateKey(startOfDay(new Date()));
  const pendingDates = [...new Set(salesDays.filter(day => day.status === "pending" && day.date <= todayKey).map(day => day.date))].sort().reverse();
  const allDates = [...new Set(salesDays.filter(day => day.date <= todayKey).map(day => day.date))].sort().reverse();
  const target = date || pendingDates[0] || allDates[0];
  if (!target) {
    setMessage("Zatím nejsou žádné prodejní směny k vyplnění.");
    return;
  }
  const options = [...new Set([target, ...pendingDates, ...allDates.slice(0, 31)])].sort().reverse();
  const pendingCount = dateValue => salesDays.filter(day => day.date === dateValue && day.status === "pending").length;
  elements.bulkSalesDate.replaceChildren(...options.map(value => {
    const missing = pendingCount(value);
    const label = new Intl.DateTimeFormat("cs-CZ", { weekday: "short", day: "numeric", month: "numeric" }).format(parseDateKey(value));
    return new Option(missing ? `${label} · chybí ${missing}` : `${label} · vyplněno`, value);
  }));
  elements.bulkSalesDate.value = target;
  elements.bulkSalesDate.syncCustomSelect?.();
  renderBulkSalesRows(target);
  setDialogStatus(elements.bulkSalesStatus, "");
  elements.bulkSalesDialog.showModal();
  elements.bulkSalesBody.querySelector("input:not([disabled])")?.focus();
}

function renderBulkSalesRows(date) {
  elements.bulkSalesTitle.textContent = new Intl.DateTimeFormat("cs-CZ", { weekday: "long", day: "numeric", month: "long" }).format(parseDateKey(date));
  const rows = salesDays.filter(day => day.date === date)
    .sort((a, b) => salesStatusRank(a) - salesStatusRank(b) || (personByRemoteId(a.workerId)?.name || "").localeCompare(personByRemoteId(b.workerId)?.name || "", "cs"));
  elements.bulkSalesBody.replaceChildren(...rows.map(day => {
    const row = document.createElement("tr");
    row.dataset.id = day.id;
    row.classList.toggle("is-pending", day.status === "pending");
    const reported = day.status === "reported";
    const nameCell = document.createElement("td");
    nameCell.textContent = personByRemoteId(day.workerId)?.name || "Neznámý brigádník";
    const plannedCell = document.createElement("td");
    plannedCell.textContent = `${formatNumber(day.plannedHours || 0)} h`;
    const input = (field, value, step, min) => {
      const cell = document.createElement("td");
      const element = document.createElement("input");
      element.type = "number";
      element.inputMode = "decimal";
      element.min = min;
      element.step = step;
      element.dataset.field = field;
      element.value = reported ? value : "";
      if (field === "hours" && !reported) element.placeholder = formatNumber(day.plannedHours || 0);
      element.setAttribute("aria-label", `${nameCell.textContent}: ${{ hours: "prodejní hodiny", hardware: "železo v Kč", services: "služby v Kč" }[field]}`);
      cell.append(element);
      return cell;
    };
    const asrCell = document.createElement("td");
    asrCell.className = "bulk-asr";
    const notSalesCell = document.createElement("td");
    const notSales = document.createElement("input");
    notSales.type = "checkbox";
    notSales.dataset.field = "notSales";
    notSales.checked = day.status === "not_sales";
    notSales.setAttribute("aria-label", `${nameCell.textContent}: nebyl na prodeji`);
    notSalesCell.append(notSales);
    row.append(nameCell, plannedCell, input("hours", day.salesHours, "0.25", "0.25"), input("hardware", day.hardware, "1", "0"), input("services", day.services, "1", "0"), asrCell, notSalesCell);
    const update = () => {
      const values = bulkRowValues(row);
      row.querySelectorAll('input[type="number"]').forEach(element => { element.disabled = notSales.checked; });
      row.classList.toggle("is-not-sales", notSales.checked);
      asrCell.textContent = values.complete ? `${formatCurrency(salesAsr({ salesHours: values.hours, hardware: values.hardware, services: values.services }))}/h` : "—";
    };
    row.addEventListener("input", update);
    update();
    return row;
  }));
  if (!rows.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="7" class="no-feedback">Na tento den není žádná prodejní směna.</td>';
    elements.bulkSalesBody.append(row);
  }
}

function bulkRowValues(row) {
  const read = field => row.querySelector(`[data-field="${field}"]`)?.value.trim();
  const hours = read("hours"), hardware = read("hardware"), services = read("services");
  const notSales = row.querySelector('[data-field="notSales"]')?.checked;
  const any = Boolean(hours || hardware || services);
  const complete = Number(hours) > 0 && hardware !== "" && services !== "" && Number(hardware) >= 0 && Number(services) >= 0;
  return { hours: Number(hours), hardware: Number(hardware), services: Number(services), notSales, any, complete };
}

async function saveBulkSales(event) {
  event.preventDefault();
  if (elements.saveBulkSales.disabled) return;
  const changes = [];
  const incomplete = [];
  elements.bulkSalesBody.querySelectorAll("tr[data-id]").forEach(row => {
    const day = salesDays.find(item => item.id === row.dataset.id);
    if (!day) return;
    const values = bulkRowValues(row);
    if (values.notSales) {
      if (day.status !== "not_sales") changes.push({ day, payload: { status: "not_sales", sales_hours: null, hardware_revenue: null, services_revenue: null } });
      return;
    }
    if (!values.any) {
      if (day.status === "not_sales") changes.push({ day, payload: { status: "pending" } });
      return;
    }
    if (!values.complete) { incomplete.push(row); return; }
    if (day.status === "reported" && day.salesHours === values.hours && day.hardware === values.hardware && day.services === values.services) return;
    changes.push({ day, payload: { status: "reported", sales_hours: values.hours, hardware_revenue: values.hardware, services_revenue: values.services } });
  });
  elements.bulkSalesBody.querySelectorAll("tr").forEach(row => row.classList.toggle("is-invalid", incomplete.includes(row)));
  if (incomplete.length) {
    setDialogStatus(elements.bulkSalesStatus, "U zvýrazněných řádků vyplňte prodejní hodiny, železo i služby (nebo je nechte prázdné).", true);
    incomplete[0].querySelector("input")?.focus();
    return;
  }
  if (!changes.length) {
    setDialogStatus(elements.bulkSalesStatus, "Nic se nezměnilo.");
    return;
  }
  elements.saveBulkSales.disabled = true;
  setDialogStatus(elements.bulkSalesStatus, `Ukládám ${changes.length}…`);
  const results = await Promise.all(changes.map(({ day, payload }) => supabaseClient.from("sales_days")
    .update({ ...payload, updated_by: null, updated_by_email: editorLabel() })
    .eq("id", day.id).select("*").single()
    .then(result => ({ day, ...result }))));
  elements.saveBulkSales.disabled = false;
  const failed = results.filter(result => result.error);
  results.filter(result => !result.error).forEach(result => Object.assign(result.day, mapSalesDay(result.data)));
  renderSalesDashboard();
 
  renderTeam();
  if (currentMainView === "shifts") renderShiftsDashboard();
  if (failed.length) {
    setDialogStatus(elements.bulkSalesStatus, `Uloženo ${results.length - failed.length}, nepodařilo se ${failed.length}: ${failed[0].error.message}`, true);
    return;
  }
  elements.bulkSalesDialog.close();
  setMessage(`Uloženo ${results.length} ${results.length === 1 ? "report" : results.length < 5 ? "reporty" : "reportů"}.`);
}

// ---------------------------------------------------------------------------
// Rychlé hodnocení jedním klikem.
// ---------------------------------------------------------------------------
const QUICK_FEEDBACK = {
  positive: [
    ["general", "Skvělá práce na směně"],
    ["general", "Výborné prodeje"],
    ["general", "Pomohl/a kolegům"],
    ["training", "Rychle se zaučil/a na oddělení"],
    ["attendance", "Vzal/a směnu navíc"]
  ],
  negative: [
    ["attendance", "Pozdní příchod"],
    ["attendance", "Nepřišel/la bez omluvy"],
    ["attendance", "Odchod dříve bez domluvy"],
    ["training", "Nedodržuje postupy oddělení"],
    ["general", "Nevhodné chování k zákazníkovi"]
  ]
};

function renderQuickFeedback(type) {
  elements.feedbackQuickReasons.replaceChildren(...QUICK_FEEDBACK[type].map(([category, text]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `quick-reason ${type}`;
    const label = document.createElement("strong");
    label.textContent = text;
    const meta = document.createElement("small");
    meta.textContent = feedbackCategoryLabel(category);
    button.append(label, meta);
    button.addEventListener("click", () => {
      elements.feedbackCategoryInputs.forEach(input => { input.checked = input.value === category; });
      elements.feedbackNote.value = text;
      elements.feedbackForm.requestSubmit();
    });
    return button;
  }));
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
  if (supabaseClient && person.remoteId) {
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
  if (!trained.length) return;
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
  renderQuickFeedback(type);
  elements.feedbackDialog.showModal();
  elements.feedbackQuickReasons.querySelector("button")?.focus();
}

function feedbackCount(person, type) {
  const legacy = Number(person[type] || 0);
  const recorded = Array.isArray(person.feedback) ? person.feedback.filter(item => item.type === type).length : 0;
  return legacy + recorded;
}



function score(person) { return feedbackCount(person, "positive") - feedbackCount(person, "negative"); }

function updateTopbarOffset() {
  const topbar = document.querySelector(".topbar");
  if (topbar) document.documentElement.style.setProperty("--topbar-h", `${Math.round(topbar.getBoundingClientRect().height)}px`);
}

// Pořadí lidí tak, jak jsou právě zobrazení v seznamu (respektuje hledání,
// filtry i řazení). Když detail otevřený odjinud není v seznamu, šipky zmizí.
function visiblePersonOrder() {
  const selector = currentView === "table" ? ".people-table tbody [data-person-id]" : "#peopleGrid [data-person-id]";
  return [...new Set([...document.querySelectorAll(selector)].map(element => element.dataset.personId))].filter(id => state.people[id]);
}

function updateProfileNav(id) {
  const order = visiblePersonOrder();
  const index = order.indexOf(id);
  const nav = document.querySelector(".profile-nav");
  nav.hidden = index < 0 || order.length < 2;
  document.querySelector("#profilePrev").disabled = index <= 0;
  document.querySelector("#profileNext").disabled = index < 0 || index >= order.length - 1;
  document.querySelector("#profilePosition").textContent = index >= 0 ? `${index + 1} / ${order.length}` : "";
}

function stepPerson(step) {
  const order = visiblePersonOrder();
  const index = order.indexOf(elements.personId.value);
  const next = order[index + step];
  if (index >= 0 && next) openPerson(next);
}

function markSelectedPerson(id) {
  document.querySelectorAll(".person-card.is-selected, .people-table tr.is-selected").forEach(element => element.classList.remove("is-selected"));
  if (!id) return;
  document.querySelectorAll(`[data-person-id="${CSS.escape(id)}"]`).forEach(element => element.classList.add("is-selected"));
}

async function openPerson(id) {
  const person = state.people[id];
  const switching = elements.dialog.open;
  // Při přepnutí na dalšího člověka zůstane otevřená stejná záložka.
  if (!switching) activateProfileTab("overview");
  elements.dialogTitle.textContent = person.name;
  elements.personId.value = id;
  elements.profileUserId.textContent = person.userId && !String(person.userId).startsWith("AUTO_") ? `ID ${person.userId}` : "";
  elements.profileEmail.textContent = person.email || "Bez e-mailu";
  elements.profileAvatar.textContent = "";
  elements.profileAvatar.style.backgroundImage = "";
  if (person.photo) elements.profileAvatar.style.backgroundImage = `url("${safeCssUrl(person.photo)}")`;
  else elements.profileAvatar.textContent = initials(person.name);
  renderProfileSummary(person);
  renderProfileUpcoming(person);
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
  updateProfileNav(person.id);
  if (!switching) {
    elements.dialog.showModal();
    elements.dialog.querySelector(".profile-tab.is-active")?.focus({ preventScroll: true });
  }
  elements.dialog.querySelector(".profile-tab-panel.is-active")?.scrollTo({ top: 0 });
  markSelectedPerson(person.id);
  await loadWorkerDetails(person);
  if (elements.dialog.open && elements.personId.value === person.id) {
    renderWorkerNotes(person);
    renderDetailNoteAttribution(person);
    renderAttendanceHistory(person);
    renderAuditHistory(person);
    renderProfileSummary(person);
  }
}

// Hlavička profilu: stejné údaje jako na kartě + počty v záložkách.
function renderProfileSummary(person) {
  const newcomer = isNewcomer(person);
  elements.profileStatus.textContent = newcomer ? "Nováček" : (person.status || "Aktivní");
  elements.profileStatus.classList.toggle("is-newcomer", newcomer);
  elements.profileHours.textContent = formatNumber(person.hours || 0);
  elements.profileHoursLabel.textContent = isCurrentTeamPeriod() ? "tento měsíc" : `v ${teamPeriodLabel(teamPeriod, true)}`;
  elements.profileHours60.textContent = formatNumber(person.hours60 || 0);
  const shift = nextShiftsByPerson.get(person.id);
  const nextStat = elements.profileNextShift.closest(".profile-next-shift");
  if (shift) {
    const label = shiftDayLabel(shift.date);
    elements.profileNextShift.textContent = `${label || new Intl.DateTimeFormat("cs-CZ", { weekday: "short", day: "numeric", month: "numeric" }).format(shift.date)} ${shift.start}–${shift.end}`;
    elements.profileNextShiftMeta.textContent = `další směna · ${shift.department}`;
    nextStat.title = `${shift.start}–${shift.end} · ${shift.department}`;
    nextStat.classList.toggle("is-soon", label === "Dnes" || label === "Zítra");
  } else {
    elements.profileNextShift.textContent = "—";
    elements.profileNextShiftMeta.textContent = "další směna není v rozpisu";
    nextStat.title = "";
    nextStat.classList.remove("is-soon");
  }
  const currentScore = score(person);
  elements.profileScore.textContent = currentScore > 0 ? `+${currentScore}` : String(currentScore);
  elements.profileScore.className = currentScore > 0 ? "positive-score" : currentScore < 0 ? "negative-score" : "";
  elements.profileScoreMeta.textContent = `${feedbackCount(person, "positive")} 👍 · ${feedbackCount(person, "negative")} 👎`;

  const todayKey = dateKey(startOfDay(new Date()));
  const upcoming = mergeShiftBlocks(shiftRows.filter(item => item.workerId === person.remoteId && !item.free && item.date >= todayKey)).length;
  setTabCount(elements.profileTabShifts, upcoming, `${upcoming} nadcházejících směn`);
  const pendingSales = salesDays.filter(day => day.workerId === person.remoteId && day.status === "pending" && day.date < todayKey).length;
  setTabCount(elements.profileTabSales, pendingSales, `Chybí ${pendingSales} reportů`, true);
  const records = (person.feedback || []).length + (person.workerNotes || []).length;
  setTabCount(elements.profileTabFeedback, records, `${records} záznamů`);
}

function setTabCount(element, count, title, warning = false) {
  element.hidden = !count;
  element.textContent = count;
  element.title = title;
  element.classList.toggle("is-warning", warning && count > 0);
}

function renderProfileUpcoming(person) {
  renderProfilePast(person);
  const todayKey = dateKey(startOfDay(new Date()));
  const blocks = mergeShiftBlocks(shiftRows.filter(item => item.workerId === person.remoteId && !item.free && item.date >= todayKey)).slice(0, 8);
  if (!blocks.length) {
    elements.profileUpcomingShifts.innerHTML = '<li class="no-feedback">V rozpisu na příštích 6 týdnů zatím nic není.</li>';
    return;
  }
  elements.profileUpcomingShifts.replaceChildren(...blocks.map(block => {
    const item = document.createElement("li");
    const date = parseDateKey(block.date);
    const label = shiftDayLabel(date);
    const day = document.createElement("strong");
    day.textContent = label || new Intl.DateTimeFormat("cs-CZ", { weekday: "short", day: "numeric", month: "numeric" }).format(date);
    const time = document.createElement("span");
    time.className = "profile-upcoming-time";
    time.textContent = `${formatClock(block.start)}–${formatClock(block.end)}`;
    const department = document.createElement("span");
    department.className = "profile-upcoming-department";
    department.textContent = block.department || "Oddělení neuvedeno";
    const hours = document.createElement("small");
    hours.textContent = `${formatNumber(block.hours)} h`;
    item.classList.toggle("is-soon", label === "Dnes" || label === "Zítra");
    item.append(day, time, department, hours);
    return item;
  }));
}

// Proběhlé směny ve vybraném měsíci (aktuální měsíc do včerejška), od nejnovější.
function renderProfilePast(person) {
  const todayKey = dateKey(startOfDay(new Date()));
  const prefix = teamPeriod.slice(0, 7);
  const blocks = mergeShiftBlocks(shiftRows.filter(item => item.workerId === person.remoteId && !item.free
    && item.date.startsWith(prefix) && item.date < todayKey)).reverse();
  const total = blocks.reduce((sum, block) => sum + block.hours, 0);
  elements.profilePastHeading.textContent = `Proběhlé v ${teamPeriodLabel(teamPeriod, true)}${total ? ` · ${formatNumber(total)} h` : ""}`;
  if (!blocks.length) {
    const inWindow = teamPeriod >= firstDayOfMonth(shiftWindowStart(startOfDay(new Date())));
    elements.profilePastShifts.innerHTML = `<li class="no-feedback">${inWindow ? "V tomto měsíci zatím žádná odpracovaná směna." : "Rozpis tohoto měsíce už se nenačítá, hodiny jsou v grafu."}</li>`;
    return;
  }
  elements.profilePastShifts.replaceChildren(...blocks.map(block => {
    const item = document.createElement("li");
    const day = document.createElement("strong");
    day.textContent = new Intl.DateTimeFormat("cs-CZ", { weekday: "short", day: "numeric", month: "numeric" }).format(parseDateKey(block.date));
    const time = document.createElement("span");
    time.className = "profile-upcoming-time";
    time.textContent = `${formatClock(block.start)}–${formatClock(block.end)}`;
    const department = document.createElement("span");
    department.className = "profile-upcoming-department";
    department.textContent = block.department || "Oddělení neuvedeno";
    const hours = document.createElement("small");
    hours.textContent = `${formatNumber(block.hours)} h`;
    item.append(day, time, department, hours);
    return item;
  }));
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
  stats.classList.add("profile-stats");
  stats.replaceChildren(...[
    ["celkem", `${formatNumber(Math.round(total * 10) / 10)} h`],
    ["průměr za měsíc", `${formatNumber(Math.round(average * 10) / 10)} h`],
    [best ? `nejvíc · ${longMonth(best.period)}` : "nejsilnější měsíc", best ? `${formatNumber(best.hours)} h` : "—"]
  ].map(([label, value]) => {
    const item = document.createElement("div");
    item.className = "profile-stat";
    const strong = document.createElement("strong");
    strong.textContent = value;
    const small = document.createElement("span");
    small.textContent = label;
    item.append(strong, small);
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
    supabaseClient.from("worker_notes").select("id, body, created_by, created_by_email, created_at").eq("worker_id", person.remoteId).is("deleted_at", null).order("created_at", { ascending: false }).limit(100),
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
    createdBy: null,
    createdByEmail: editorLabel(),
    createdAt: new Date().toISOString()
  };
  if (supabaseClient && person.remoteId) {
    const { data, error } = await supabaseClient.from("worker_notes").insert({
      worker_id: person.remoteId,
      body,
      created_by: null,
      created_by_email: editorLabel()
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
  renderProfileSummary(person);
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
  button.disabled = true;
  if (supabaseClient && person.remoteId) {
    const { error } = await setRecordDeleted("worker_notes", note.id, true);
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
  renderProfileSummary(person);
  elements.workerNotesStatus.textContent = "";
  elements.workerNotesStatus.classList.remove("error");
  setMessage("Poznámka byla smazána.", false, async () => {
    if (supabaseClient && person.remoteId) {
      const { error } = await setRecordDeleted("worker_notes", note.id, false);
      if (error) throw error;
    }
    person.workerNotes = [note, ...(person.workerNotes || [])].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    saveState();
    if (elements.dialog.open && elements.personId.value === person.id) renderWorkerNotes(person);
  });
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

// Mazání je vratné: záznam se jen skryje (deleted_at) a jde vrátit z oznámení.
function setRecordDeleted(table, id, deleted) {
  return supabaseClient.from(table)
    .update({ deleted_at: deleted ? new Date().toISOString() : null, deleted_by_email: deleted ? editorLabel() : null })
    .eq("id", id);
}

async function applyFeedbackChange(person) {
  const metrics = calculateAutomaticMetrics(person.feedback, person.departments);
  person.skills = metrics.skills;
  person.reliability = metrics.reliability;
  if (supabaseClient && person.remoteId) {
    const { error } = await supabaseClient.from("workers").update(metrics).eq("id", person.remoteId);
    if (error) throw new Error(`ukazatele se nepodařilo přepočítat: ${error.message}`);
    await refreshWorkerAudit(person);
  }
  saveState();
  render();
  if (elements.dialog.open && elements.personId.value === person.id) {
    elements.skillsRange.value = person.skills;
    elements.reliabilityRange.value = person.reliability;
    updateRangeControl(elements.skillsRange, elements.skillsOutput);
    updateRangeControl(elements.reliabilityRange, elements.reliabilityOutput);
    renderFeedbackHistory(person);
    renderAuditHistory(person);
    renderProfileSummary(person);
  }
}

async function deleteFeedback(person, item, button) {
  button.disabled = true;
  if (supabaseClient && person.remoteId) {
    const { error } = await setRecordDeleted("feedback", item.id, true);
    if (error) {
      button.disabled = false;
      setMessage(`Hodnocení se nepodařilo smazat: ${error.message}`, true);
      return;
    }
  }
  person.feedback = (person.feedback || []).filter(entry => entry.id !== item.id);
  try {
    await applyFeedbackChange(person);
  } catch (error) {
    setMessage(`Hodnocení je smazané, ale ${error.message}`, true);
    return;
  }
  setMessage("Hodnocení bylo smazáno.", false, async () => {
    if (supabaseClient && person.remoteId) {
      const { error } = await setRecordDeleted("feedback", item.id, false);
      if (error) throw error;
    }
    person.feedback = [...(person.feedback || []), item].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    await applyFeedbackChange(person);
  });
}

function renderFeedbackBreakdown(feedback) {
  const categories = ["attendance", "training", "general"];
  elements.feedbackBreakdown.replaceChildren(...categories.map(category => {
    const items = feedback.filter(item => (item.category || "general") === category);
    const positive = items.filter(item => item.type === "positive").length;
    const negative = items.filter(item => item.type === "negative").length;
    const card = document.createElement("div");
    card.className = `profile-stat feedback-breakdown-item ${category}`;
    const label = document.createElement("span");
    label.textContent = feedbackCategoryLabel(category);
    const counts = document.createElement("strong");
    counts.textContent = `${positive} 👍 · ${negative} 👎`;
    card.append(counts, label);
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
    changedBy: item.changed_by_email || "Dřívější uživatel",
    operation: item.operation,
    before: item.before_data,
    after: item.after_data
  }));
}

async function submitAppFeedback(event) {
  event.preventDefault();
  const message = elements.appFeedbackMessage.value.trim();
  if (!message || !supabaseClient) return;
  elements.sendAppFeedback.disabled = true;
  elements.sendAppFeedback.textContent = "Odesílám…";
  elements.appFeedbackStatus.textContent = "";
  elements.appFeedbackStatus.classList.remove("error");
  const { error } = await supabaseClient.from("app_feedback").insert({
    category: elements.appFeedbackCategory.value,
    message,
    page_url: window.location.href,
    created_by: null,
    created_by_email: editorLabel()
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
  showToastLayer(Boolean(text));
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
      showToastLayer(false);
    }, undoAction ? 7000 : (error ? 8000 : 4000));
  }
}

// Modální dialog zablokuje vše mimo sebe, takže tlačítko „Vrátit zpět“ by šlo
// stisknout jen uvnitř dialogu. Oznámení se proto přesune do nejvyššího
// otevřeného dialogu a zobrazí se jako popover v horní vrstvě.
function showToastLayer(visible) {
  const toast = elements.importMessage;
  const openDialogs = [...document.querySelectorAll("dialog:modal")];
  const host = openDialogs[openDialogs.length - 1] || document.body;
  const supportsPopover = typeof toast.showPopover === "function";
  try {
    if (supportsPopover && toast.matches(":popover-open")) toast.hidePopover();
  } catch { /* nic */ }
  if (toast.parentElement !== host) host.append(toast);
  if (!visible || !supportsPopover) return;
  try { toast.showPopover(); } catch { /* prohlížeč bez podpory */ }
}

// Po zavření dialogu vrátit oznámení zpět do stránky, ať nezmizí s dialogem.
document.addEventListener("close", event => {
  if (event.target instanceof HTMLDialogElement && event.target.contains(elements.importMessage)) {
    requestAnimationFrame(() => showToastLayer(!elements.importMessage.hidden));
  }
}, true);

function initials(name) { return name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toLocaleUpperCase("cs"); }
function formatNumber(value) { return new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2 }).format(value); }
function safeCssUrl(value) { return String(value).replace(/["\\\n\r]/g, ""); }



function initializeCustomSelects() {
  [
    [elements.sortSelect, false],
    [elements.departmentMatchMode, false],
    [elements.salesPeriodFilter, true],
    [elements.salesPersonFilter, false],
    [elements.salesStatusFilter, false],
    [elements.teamPeriodSelect, true],
    [elements.bulkSalesDate, false],
    [document.querySelector("#appFeedbackCategory"), false]
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
      menu.querySelector(".is-selected")?.scrollIntoView({ block: "nearest" });
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
