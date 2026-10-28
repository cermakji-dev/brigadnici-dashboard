export const normalizeText = value => String(value ?? "")
  .replace(/[\u200B-\u200D\uFEFF]/g, "")
  .replace(/\s+/g, " ")
  .toLocaleLowerCase("cs")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim();

export const slugFromName = value => normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const addRosterOnlyWorkers = (totals, rosterNames, findWorker) => {
  rosterNames.forEach(rosterName => {
    const worker = findWorker(rosterName);
    if (!worker || totals.has(worker.id)) return;
    totals.set(worker.id, {
      id: worker.id,
      name: worker.name,
      hours: 0,
      email: worker.email,
      photo: ""
    });
  });
};

export const isIgnoredShiftName = value => {
  const name = normalizeText(value);
  return !name || name === "volna smena" || name === "volná směna" || name.startsWith("volna smena ");
};

export const automaticWorkerId = name => `AUTO-${slugFromName(name).toUpperCase()}`;

export const salesMetrics = ({ hours = 0, hardware = 0, services = 0 } = {}) => ({
  asr: Number(hours) > 0 ? (Number(hardware) + Number(services)) / Number(hours) : 0,
  aros: Number(hardware) > 0 ? Number(services) / Number(hardware) * 100 : 0
});

export const incompleteOnboardingTasks = onboarding => {
  const value = onboarding || {};
  return [
    ["training", "Splnit úvodní školení"],
    ["contracts", "Zajistit podpis smluv"],
    ["taxes", "Vyřešit daně"]
  ].filter(([key]) => !value[key]).map(([, label]) => label);
};
