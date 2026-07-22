import { createClient } from "npm:@supabase/supabase-js@2.53.0";
import * as XLSX from "npm:xlsx@0.18.5";

const SHEET_ID = "1mEke18XDi76U_92N_HifkWSFlrsrTWs962_yPWjuYDA";
const EXPORT_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`;
const MONTHS = ["leden", "unor", "brezen", "duben", "kveten", "cerven", "cervenec", "srpen", "zari", "rijen", "listopad", "prosinec"];
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS_HEADERS });

type Worker = { id: string; external_user_id: string; full_name: string; aliases: string[]; active: boolean };
type SummaryRow = { name: string; hours: number };

const normalize = (value: unknown) => String(value ?? "")
  .replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").toLocaleLowerCase("cs")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
const slugify = (value: unknown) => normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const parseHours = (value: unknown) => {
  const number = Number(String(value ?? 0).replace(",", ".").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
};
const isName = (value: unknown) => {
  const name = String(value ?? "").trim();
  return normalize(name) !== "volna smena" && /^[\p{L}][\p{L}'’-]+(?:\s+[\p{L}][\p{L}'’-]+)+$/u.test(name);
};
const automaticId = (name: string) => {
  const key = slugify(name);
  let hash = 2166136261;
  for (const character of key) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `AUTO_${key.toUpperCase().replace(/-/g, "_")}_${(hash >>> 0).toString(36).toUpperCase()}`;
};
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const pragueToday = () => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts();
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return new Date(Number(value.year), Number(value.month) - 1, Number(value.day));
};
const periodKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
const periodFromSheet = (name: string) => {
  const match = normalize(name).match(new RegExp(`^(${MONTHS.join("|")})(\\d{2}|\\d{4})$`));
  if (!match) return null;
  const year = match[2].length === 2 ? 2000 + Number(match[2]) : Number(match[2]);
  return `${year}-${String(MONTHS.indexOf(match[1]) + 1).padStart(2, "0")}-01`;
};
const matrixOf = (sheet: XLSX.WorkSheet) => XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });

function readSummary(sheet: XLSX.WorkSheet) {
  const matrix = matrixOf(sheet);
  for (let headerRow = 0; headerRow < Math.min(matrix.length, 12); headerRow += 1) {
    const cells = matrix[headerRow].map(normalize);
    const nameColumn = cells.findIndex(cell => ["jmeno", "brigadnik", "name"].includes(cell));
    const hoursColumn = cells.findIndex(cell => ["pocet zapsanych hodin", "pocet hodin", "hodiny", "hours"].includes(cell));
    if (nameColumn < 0 || hoursColumn < 0) continue;
    const rows: SummaryRow[] = [];
    for (let index = headerRow + 1; index < matrix.length; index += 1) {
      const name = String(matrix[index][nameColumn] ?? "").trim();
      if (!name) continue;
      if (["pocet volnych smen", "pocet obsazenych smen", "% obsazeni", "planovane hodiny", "z toho log (obsazene)"].includes(normalize(name))) break;
      if (isName(name)) rows.push({ name, hours: parseHours(matrix[index][hoursColumn]) });
    }
    let plannedHours: number | null = null;
    for (const row of matrix) {
      const index = row.findIndex(cell => normalize(cell) === "planovane hodiny");
      if (index >= 0) { plannedHours = parseHours(row[index + 1]); break; }
    }
    return { rows, plannedHours };
  }
  throw new Error("The current sheet has no Name / Hours summary.");
}

function excelDate(values: unknown[]) {
  for (const value of values) {
    if (value instanceof Date && !Number.isNaN(value.valueOf())) return value;
    if (typeof value === "number" && value > 30000 && value < 70000) {
      const parsed = XLSX.SSF.parse_date_code(value);
      if (parsed) return new Date(parsed.y, parsed.m - 1, parsed.d);
    }
    if (typeof value === "string" && /^\d{1,2}[./]\d{1,2}[./]\d{2,4}$/.test(value.trim())) {
      const [day, month, rawYear] = value.trim().split(/[./]/).map(Number);
      return new Date(rawYear < 100 ? 2000 + rawYear : rawYear, month - 1, day);
    }
  }
  return null;
}

function salesExpectations(sheet: XLSX.WorkSheet, workersByName: Map<string, Worker>, today: Date) {
  const matrix = matrixOf(sheet);
  const totals = new Map<string, { worker_id: string; shift_date: string; planned_hours: number }>();
  for (let rowIndex = 0; rowIndex < matrix.length - 2; rowIndex += 1) {
    if (normalize(matrix[rowIndex + 1]?.[0]).replace(/:$/, "") !== "urceni") continue;
    const date = excelDate(matrix[rowIndex].slice(0, 8));
    if (!date || date >= today) continue;
    const assignments = matrix[rowIndex + 1].slice(1, 7).map(normalize);
    for (let shift = rowIndex + 2; shift < matrix.length; shift += 1) {
      const row = matrix[shift];
      if (row.some(cell => normalize(cell).startsWith("celkem hod"))) break;
      if (!/^\d{1,2}(?::\d{2})?\s*-\s*\d{1,2}(?::\d{2})?\s*h?$/.test(normalize(row[0]))) continue;
      row.slice(1, 7).forEach((cell, column) => {
        if (!assignments[column].includes("prodej")) return;
        const worker = workersByName.get(slugify(String(cell ?? "").trim().replace(/\s+\d{1,2}:\d{2}\s*$/, "")));
        if (!worker) return;
        const key = `${worker.id}|${dateKey(date)}`;
        totals.set(key, { worker_id: worker.id, shift_date: dateKey(date), planned_hours: (totals.get(key)?.planned_hours ?? 0) + 1 });
      });
    }
  }
  return [...totals.values()];
}

async function isAuthorized(request: Request, serviceClient: ReturnType<typeof createClient>) {
  const expectedSecret = Deno.env.get("SYNC_CRON_SECRET");
  if (expectedSecret && request.headers.get("x-sync-secret") === expectedSecret) return true;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!bearer) return false;
  const { data, error } = await serviceClient.auth.getUser(bearer);
  if (error || !data.user?.email) return false;
  const { data: member } = await serviceClient.from("app_members").select("email").eq("email", data.user.email.toLocaleLowerCase()).maybeSingle();
  return Boolean(member);
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY");
  if (!url || !serviceKey) return json({ error: "Missing Supabase environment." }, 500);
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  if (!(await isAuthorized(request, supabase))) return json({ error: "Unauthorized" }, 401);
  const { data: locked, error: lockError } = await supabase.rpc("acquire_sheets_sync_lock");
  if (lockError) return json({ error: lockError.message }, 500);
  if (!locked) return json({ status: "skipped", reason: "already_running" }, 202);

  const startedAt = new Date().toISOString();
  let runId: number | null = null;
  try {
    const today = pragueToday();
    const period = periodKey(today);
    const { data: run, error: runError } = await supabase.from("sheets_sync_runs").insert({ status: "running", period, started_at: startedAt }).select("id").single();
    if (runError) throw runError;
    runId = run.id;

    const response = await fetch(`${EXPORT_URL}&cache=${Date.now()}`, { cache: "no-store", headers: { "user-agent": "brigadnici-dashboard-sync/1.0" } });
    if (!response.ok) throw new Error(`Google Sheets returned HTTP ${response.status}.`);
    const workbook = XLSX.read(await response.arrayBuffer(), { type: "array", cellDates: true });
    const sheetName = workbook.SheetNames.find(name => periodFromSheet(name) === period);
    if (!sheetName) throw new Error(`No sheet found for ${period}.`);
    const currentSheet = workbook.Sheets[sheetName];
    if (!currentSheet) throw new Error(`Sheet ${sheetName} could not be opened.`);
    const { rows: summary, plannedHours } = readSummary(currentSheet);

    const { data: workerRows, error: workerError } = await supabase.from("workers").select("id, external_user_id, full_name, aliases, active");
    if (workerError) throw workerError;
    let workers = workerRows as Worker[];
    const byName = new Map<string, Worker>();
    const indexWorkers = () => {
      byName.clear();
      [...workers].sort((a, b) => Number(String(a.external_user_id).startsWith("AUTO_")) - Number(String(b.external_user_id).startsWith("AUTO_"))).forEach(worker => {
        [worker.full_name, ...(worker.aliases ?? [])].forEach(name => { const key = slugify(name); if (!byName.has(key)) byName.set(key, worker); });
      });
    };
    indexWorkers();
    const unknown = [...new Map(summary.filter(row => !byName.has(slugify(row.name))).map(row => [slugify(row.name), row.name])).values()];
    for (const name of unknown) {
      const { data: created, error } = await supabase.from("workers").upsert({ external_user_id: automaticId(name), full_name: name, role: "Sales Support", status: "Novacek", active: true, skills: 0, reliability: 100, departments: [], aliases: [], notes: "" }, { onConflict: "external_user_id" }).select("id, external_user_id, full_name, aliases, active").single();
      if (error) throw error;
      workers.push(created as Worker);
      await supabase.from("worker_onboarding").upsert({ worker_id: created.id, training_completed: false, contracts_completed: false, taxes_completed: false }, { onConflict: "worker_id", ignoreDuplicates: true });
    }
    indexWorkers();

    const mapped = summary.flatMap(row => {
      const worker = byName.get(slugify(row.name));
      return worker?.active ? [{ worker_id: worker.id, period, hours: row.hours, source_name: `Google Sheets - ${sheetName}`, imported_at: new Date().toISOString() }] : [];
    });
    const workerIds = mapped.map(row => row.worker_id);
    const { data: existing, error: existingError } = workerIds.length
      ? await supabase.from("attendance_totals").select("worker_id,hours").eq("period", period).in("worker_id", workerIds)
      : { data: [], error: null };
    if (existingError) throw existingError;
    const old = new Map((existing ?? []).map(row => [row.worker_id, Number(row.hours)]));
    const changed = mapped.filter(row => old.get(row.worker_id) !== row.hours);
    if (changed.length) {
      const { error } = await supabase.from("attendance_totals").upsert(changed, { onConflict: "worker_id,period" });
      if (error) throw error;
    }

    const expectedSales = salesExpectations(currentSheet, byName, today);
    if (expectedSales.length) {
      const { error } = await supabase.from("sales_days").upsert(expectedSales, { onConflict: "worker_id,shift_date" });
      if (error) throw error;
    }
    const totalHours = mapped.reduce((sum, row) => sum + row.hours, 0);
    const result = { status: "success", period, sheet: sheetName, seen: summary.length, changed: changed.length, created: unknown.length, totalHours, plannedHours };
    const { error: finishError } = await supabase.from("sheets_sync_runs").update({ status: "success", sheet_name: sheetName, finished_at: new Date().toISOString(), workers_seen: summary.length, workers_changed: changed.length, workers_created: unknown.length, total_hours: totalHours, planned_hours: plannedHours, details: { unknown_names: unknown } }).eq("id", runId);
    if (finishError) throw finishError;
    return json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (runId) await supabase.from("sheets_sync_runs").update({ status: "error", finished_at: new Date().toISOString(), error_message: message }).eq("id", runId);
    return json({ status: "error", error: message }, 500);
  } finally {
    await supabase.rpc("release_sheets_sync_lock");
  }
});
