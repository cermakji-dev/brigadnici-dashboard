// Synchronizace Google Sheets → Supabase. Spouští ji pg_cron každých 5 minut
// (hlavička x-sync-secret) a ručně tlačítko v aplikaci (bez tajemství, ale
// nejvýš jednou za minutu).
//
// Zapisuje: docházku aktuálního měsíce (attendance_totals), rozpis směn
// v okně −62 až +45 dní (shifts), očekávané prodejní směny (sales_days)
// a nové karty pro neznámá jména z aktuálního měsíce (workers).
//
// Nasazení: supabase functions deploy sync-google-sheets --no-verify-jwt
// (logic.mjs v této složce jen re-exportuje ../../../logic.mjs).
import { createClient } from "npm:@supabase/supabase-js@2.53.0";
import * as XLSX from "npm:xlsx@0.18.5";
import {
  addDays, automaticWorkerId, buildShiftRows, buildWorkerLookup, dateKey, firstDayOfMonth, isLikelyWorkerName,
  normalizeText, parseHours, periodFromSheetName, resolveShiftCell, salesExpectationsFromShifts, forEachShiftCell
} from "./logic.mjs";

const SHEET_ID = "1mEke18XDi76U_92N_HifkWSFlrsrTWs962_yPWjuYDA";
const EXPORT_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`;
const WINDOW_PAST_DAYS = 62;
const WINDOW_FUTURE_DAYS = 45;
const MANUAL_THROTTLE_MS = 60_000;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-editor-name",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS_HEADERS });
const errorMessage = (error: unknown) => error instanceof Error
  ? error.message
  : typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : String(error);
const SUMMARY_STOP = ["pocet volnych smen", "pocet obsazenych smen", "% obsazeni", "planovane hodiny", "z toho log (obsazene)"];

type Worker = { id: string; external_user_id: string; full_name: string; aliases: string[] | null; active: boolean };
type Matrix = unknown[][];

const pragueToday = () => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts();
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return new Date(Number(value.year), Number(value.month) - 1, Number(value.day));
};

function readSummary(matrix: Matrix) {
  for (let headerRow = 0; headerRow < Math.min(matrix.length, 12); headerRow += 1) {
    const cells = (matrix[headerRow] || []).map(normalizeText);
    const nameColumn = cells.findIndex(cell => ["jmeno", "brigadnik", "name"].includes(cell));
    const hoursColumn = cells.findIndex(cell => ["pocet zapsanych hodin", "pocet hodin", "hodiny", "hours"].includes(cell));
    if (nameColumn < 0 || hoursColumn < 0) continue;
    const rows: { name: string; hours: number }[] = [];
    for (let index = headerRow + 1; index < matrix.length; index += 1) {
      const name = String(matrix[index]?.[nameColumn] ?? "").trim();
      if (!name) continue;
      if (SUMMARY_STOP.includes(normalizeText(name))) break;
      if (isLikelyWorkerName(name)) rows.push({ name, hours: parseHours(matrix[index][hoursColumn]) });
    }
    let plannedHours: number | null = null;
    for (const row of matrix) {
      const index = row.findIndex(cell => normalizeText(cell) === "planovane hodiny");
      if (index >= 0) { plannedHours = parseHours(row[index + 1]); break; }
    }
    return { rows, plannedHours };
  }
  throw new Error("Aktuální list nemá souhrn se sloupci Jméno a Počet zapsaných hodin.");
}

async function isScheduled(request: Request) {
  const expected = Deno.env.get("SYNC_CRON_SECRET");
  return Boolean(expected && request.headers.get("x-sync-secret") === expected);
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY");
  if (!url || !serviceKey) return json({ error: "Missing Supabase environment." }, 500);
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";

  if (!(await isScheduled(request))) {
    if (dryRun) return json({ error: "Unauthorized" }, 401);
    const { data: last } = await supabase.from("sheets_sync_runs").select("started_at").order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (last && Date.now() - new Date(last.started_at).getTime() < MANUAL_THROTTLE_MS) {
      return json({ status: "skipped", reason: "recently_synced", lastStartedAt: last.started_at }, 200);
    }
  }

  const { data: locked, error: lockError } = await supabase.rpc("acquire_sheets_sync_lock");
  if (lockError) return json({ error: lockError.message }, 500);
  if (!locked) return json({ status: "skipped", reason: "already_running" }, 202);

  let runId: number | null = null;
  try {
    const today = pragueToday();
    const todayKey = dateKey(today);
    const period = firstDayOfMonth(today);
    const from = addDays(today, -WINDOW_PAST_DAYS);
    const to = addDays(today, WINDOW_FUTURE_DAYS);
    if (!dryRun) {
      const { data: run, error } = await supabase.from("sheets_sync_runs").insert({ status: "running", period, started_at: new Date().toISOString() }).select("id").single();
      if (error) throw error;
      runId = run.id;
    }

    const response = await fetch(`${EXPORT_URL}&cache=${Date.now()}`, { cache: "no-store", headers: { "user-agent": "brigadnici-dashboard-sync/2.0" } });
    if (!response.ok) throw new Error(`Google Sheets vrátil HTTP ${response.status}.`);
    // Bez cellDates: data zůstanou jako sériová čísla Excelu a převádí je logic.mjs.
    const workbook = XLSX.read(await response.arrayBuffer(), { type: "array" });
    const matrices = new Map<string, Matrix>(workbook.SheetNames.map(name => [name, XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, raw: true, defval: "" })]));
    const sheetName = workbook.SheetNames.find(name => periodFromSheetName(name) === period);
    if (!sheetName) throw new Error(`V tabulce chybí list pro ${period.slice(0, 7)}.`);
    const currentMatrix = matrices.get(sheetName)!;
    const { rows: summary, plannedHours } = readSummary(currentMatrix);

    const { data: workerRows, error: workerError } = await supabase.from("workers").select("id, external_user_id, full_name, aliases, active");
    if (workerError) throw workerError;
    const workers = workerRows as Worker[];
    let lookup = buildWorkerLookup(workers);

    // Neznámá jména ze souhrnu i z rozpisu aktuálního měsíce dostanou kartu nováčka.
    const candidates = new Map<string, string>();
    summary.forEach(row => { if (!lookup(row.name)) candidates.set(normalizeText(row.name), row.name); });
    forEachShiftCell(currentMatrix, ({ text }) => {
      resolveShiftCell(text, lookup).forEach(entry => {
        if (!entry.free && !entry.worker && isLikelyWorkerName(entry.name)) candidates.set(normalizeText(entry.name), entry.name);
      });
    });
    const created: string[] = [];
    if (!dryRun) {
      for (const name of candidates.values()) {
        const { data, error } = await supabase.from("workers").upsert({
          external_user_id: automaticWorkerId(name), full_name: name, role: "Sales Support", status: "Nováček",
          active: true, skills: 0, reliability: 100, departments: [], aliases: [], notes: ""
        }, { onConflict: "external_user_id" }).select("id, external_user_id, full_name, aliases, active").single();
        if (error) throw error;
        workers.push(data as Worker);
        created.push(name);
        await supabase.from("worker_onboarding").upsert({ worker_id: data.id, training_completed: false, contracts_completed: false, taxes_completed: false }, { onConflict: "worker_id", ignoreDuplicates: true });
      }
      lookup = buildWorkerLookup(workers);
    }

    // Docházka aktuálního měsíce (zapisují se jen změněné hodnoty).
    const attendance = new Map<string, number>();
    summary.forEach(row => {
      const worker = lookup(row.name) as Worker | null;
      if (worker?.active) attendance.set(worker.id, (attendance.get(worker.id) || 0) + row.hours);
    });
    let changed: { worker_id: string; period: string; hours: number; source_name: string; imported_at: string }[] = [];
    if (attendance.size) {
      const { data: existing, error } = await supabase.from("attendance_totals").select("worker_id, hours").eq("period", period).in("worker_id", [...attendance.keys()]);
      if (error) throw error;
      const old = new Map((existing ?? []).map(row => [row.worker_id, Number(row.hours)]));
      changed = [...attendance].filter(([id, hours]) => old.get(id) !== hours).map(([worker_id, hours]) => ({
        worker_id, period, hours, source_name: `Google Sheets – ${sheetName}`, imported_at: new Date().toISOString()
      }));
      if (changed.length && !dryRun) {
        const { error: upsertError } = await supabase.from("attendance_totals").upsert(changed, { onConflict: "worker_id,period" });
        if (upsertError) throw upsertError;
      }
    }

    // Rozpis směn ze všech listů v okně dat.
    const shifts = workbook.SheetNames.flatMap(name => buildShiftRows(matrices.get(name)!, { from, to, lookup })
      .map(row => ({ ...row, sheet: name })));
    const monthPrefix = period.slice(0, 7);
    const freeHours = Math.round(shifts.filter(row => row.free && row.date.startsWith(monthPrefix)).reduce((sum, row) => sum + (row.end - row.start) / 60, 0) * 100) / 100;
    const unmatched = [...new Set(shifts.filter(row => !row.free && !row.workerId).map(row => row.name))].slice(0, 50);
    if (shifts.length && !dryRun) {
      const { error } = await supabase.rpc("replace_shifts", { p_from: dateKey(from), p_to: dateKey(to), p_rows: shifts });
      if (error) throw error;
    }

    // Očekávané prodejní reporty za uplynulé dny a úklid těch, co z rozpisu zmizely.
    const expected = salesExpectationsFromShifts(shifts, todayKey);
    const scannedDates = [...new Set(shifts.map(row => row.date).filter(date => date < todayKey))].sort();
    let staleRemoved = 0;
    if (!dryRun && expected.length) {
      const { error } = await supabase.from("sales_days").upsert(expected, { onConflict: "worker_id,shift_date" });
      if (error) throw error;
    }
    if (!dryRun && scannedDates.length) {
      const expectedKeys = new Set(expected.map(row => `${row.worker_id}|${row.shift_date}`));
      const { data: pending, error } = await supabase.from("sales_days").select("id, worker_id, shift_date")
        .eq("status", "pending").gte("shift_date", scannedDates[0]).lte("shift_date", scannedDates[scannedDates.length - 1]);
      if (error) throw error;
      const scanned = new Set(scannedDates);
      const stale = (pending ?? []).filter(row => scanned.has(row.shift_date) && !expectedKeys.has(`${row.worker_id}|${row.shift_date}`)).map(row => row.id);
      if (stale.length) {
        const { error: deleteError } = await supabase.from("sales_days").delete().in("id", stale).eq("status", "pending");
        if (deleteError) throw deleteError;
        staleRemoved = stale.length;
      }
    }

    const totalHours = [...attendance.values()].reduce((sum, hours) => sum + hours, 0);
    const details = { unknown_names: created, unmatched_shift_names: unmatched, shifts: shifts.length, free_hours: freeHours, sales_expected: expected.length, sales_stale_removed: staleRemoved };
    const result = { status: dryRun ? "dry_run" : "success", period, sheet: sheetName, seen: summary.length, changed: changed.length, created: dryRun ? [...candidates.values()] : created, totalHours, plannedHours, ...details,
      sample: dryRun ? shifts.filter(row => row.date >= todayKey).slice(0, 15) : undefined };
    if (runId) {
      const { error } = await supabase.from("sheets_sync_runs").update({
        status: "success", sheet_name: sheetName, finished_at: new Date().toISOString(), workers_seen: summary.length,
        workers_changed: changed.length, workers_created: created.length, total_hours: totalHours, planned_hours: plannedHours, details
      }).eq("id", runId);
      if (error) throw error;
    }
    return json(result);
  } catch (error) {
    const message = errorMessage(error);
    if (runId) await supabase.from("sheets_sync_runs").update({ status: "error", finished_at: new Date().toISOString(), error_message: message }).eq("id", runId);
    return json({ status: "error", error: message }, 500);
  } finally {
    await supabase.rpc("release_sheets_sync_lock");
  }
});
