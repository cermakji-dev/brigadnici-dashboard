// Synchronizace Google Sheets → Supabase. Spouští ji pg_cron každých 5 minut
// (hlavička x-sync-secret) a ručně tlačítko v aplikaci (bez tajemství, ale
// nejvýš jednou za minutu).
//
// Zapisuje: hodiny za každý měsíc spočítané z rozpisu měsíčního listu
// (attendance_totals; ruční souhrn „Jméno / Počet zapsaných hodin“ v tabulce
// měl chybné rozsahy a chyběla v něm jména), rozpis směn od 1. dne měsíce před
// třemi měsíci do +45 dní (shifts), prodejní reporty pro naplánované prodejní
// směny (sales_days) a aktivní tým (workers.active) = seznam „Jméno“ v souhrnu
// aktuálního měsíčního listu; neznámá jména z rozpisu dostanou neaktivní kartu.
//
// Nasazení: supabase functions deploy sync-google-sheets --no-verify-jwt
// (logic.mjs v této složce jen re-exportuje ../../../logic.mjs).
import { createClient } from "npm:@supabase/supabase-js@2.53.0";
import * as XLSX from "npm:xlsx@0.18.5";
import {
  addDays, automaticWorkerId, buildShiftRows, buildWorkerLookup, dateKey, firstDayOfMonth, isLikelyWorkerName,
  monthlyRosterHours, normalizeText, periodFromSheetName, resolveShiftCell, salesExpectationsFromShifts, forEachShiftCell, summaryNames
} from "./logic.mjs";

const SHEET_ID = "1mEke18XDi76U_92N_HifkWSFlrsrTWs962_yPWjuYDA";
const EXPORT_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`;
const WINDOW_PAST_MONTHS = 3;
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

type Worker = { id: string; external_user_id: string; full_name: string; aliases: string[] | null; active: boolean };
type Matrix = unknown[][];

const pragueToday = () => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts();
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return new Date(Number(value.year), Number(value.month) - 1, Number(value.day));
};

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
    const from = new Date(today.getFullYear(), today.getMonth() - WINDOW_PAST_MONTHS, 1);
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

    const { data: workerRows, error: workerError } = await supabase.from("workers").select("id, external_user_id, full_name, aliases, active");
    if (workerError) throw workerError;
    const workers = workerRows as Worker[];
    let lookup = buildWorkerLookup(workers);

    // Aktivní tým = seznam „Jméno“ v souhrnu aktuálního listu. Nová jména
    // v seznamu dostanou aktivní kartu, kdo ze seznamu zmizel, je neaktivní.
    // Pojistka: s podezřele krátkým seznamem (nový list, chyba) se nic nemění.
    const listNames = summaryNames(currentMatrix) ?? [];
    const listApplied = listNames.length >= 5;
    const listCreated: string[] = [];
    const activated: string[] = [];
    const deactivated: string[] = [];
    if (listApplied) {
      for (const name of listNames) {
        if (lookup(name) || dryRun) { if (!lookup(name)) listCreated.push(name); continue; }
        const { data, error } = await supabase.from("workers").upsert({
          external_user_id: automaticWorkerId(name), full_name: name, role: "Sales Support", status: "Nováček",
          active: true, skills: 0, reliability: 100, departments: [], aliases: [], notes: ""
        }, { onConflict: "external_user_id" }).select("id, external_user_id, full_name, aliases, active").single();
        if (error) throw error;
        workers.push(data as Worker);
        listCreated.push(name);
        await supabase.from("worker_onboarding").upsert({ worker_id: data.id, training_completed: false, contracts_completed: false, taxes_completed: false }, { onConflict: "worker_id", ignoreDuplicates: true });
        lookup = buildWorkerLookup(workers);
      }
      const activeIds = new Set(listNames.map(name => (lookup(name) as Worker | null)?.id).filter(Boolean) as string[]);
      const toActivate = workers.filter(worker => activeIds.has(worker.id) && !worker.active);
      const toDeactivate = workers.filter(worker => !activeIds.has(worker.id) && worker.active);
      activated.push(...toActivate.map(worker => worker.full_name));
      deactivated.push(...toDeactivate.map(worker => worker.full_name));
      if (!dryRun) {
        if (toActivate.length) {
          const { error } = await supabase.from("workers").update({ active: true }).in("id", toActivate.map(worker => worker.id));
          if (error) throw error;
        }
        if (toDeactivate.length) {
          const { error } = await supabase.from("workers").update({ active: false }).in("id", toDeactivate.map(worker => worker.id));
          if (error) throw error;
        }
        toActivate.forEach(worker => { worker.active = true; });
        toDeactivate.forEach(worker => { worker.active = false; });
      }
    }

    // Neznámá jména z rozpisu (mimo seznam) dostanou neaktivní kartu, aby se
    // jim přiřadily hodiny a směny.
    const candidates = new Map<string, string>();
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
          active: false, skills: 0, reliability: 100, departments: [], aliases: [], notes: ""
        }, { onConflict: "external_user_id" }).select("id, external_user_id, full_name, aliases, active").single();
        if (error) throw error;
        workers.push(data as Worker);
        created.push(name);
        await supabase.from("worker_onboarding").upsert({ worker_id: data.id, training_completed: false, contracts_completed: false, taxes_completed: false }, { onConflict: "worker_id", ignoreDuplicates: true });
      }
      lookup = buildWorkerLookup(workers);
    }

    // Hodiny za každý měsíc až po aktuální, spočítané z rozpisu daného listu
    // (zapisují se jen změněné hodnoty).
    const attendanceRows: { worker_id: string; period: string; hours: number; in_list: boolean; source_name: string; imported_at: string }[] = [];
    const attendance = new Map<string, number>();
    let plannedHours: number | null = null;
    const monthSheets = workbook.SheetNames.map(name => ({ name, sheetPeriod: periodFromSheetName(name) }))
      .filter(item => item.sheetPeriod && item.sheetPeriod <= period);
    for (const { name, sheetPeriod } of monthSheets) {
      const matrix = matrices.get(name)!;
      const roster = monthlyRosterHours(matrix, sheetPeriod!, lookup);
      if (sheetPeriod === period) {
        roster.hours.forEach((hours, id) => attendance.set(id, hours));
        plannedHours = roster.planned;
      }
      // Tým daného měsíce = jeho seznam „Jméno“ (historie týmu po měsících).
      const listed = new Set((summaryNames(matrix) ?? []).map(listName => (lookup(listName) as Worker | null)?.id).filter(Boolean) as string[]);
      new Set([...roster.hours.keys(), ...listed]).forEach(worker_id => attendanceRows.push({
        worker_id, period: sheetPeriod!, hours: roster.hours.get(worker_id) || 0, in_list: listed.has(worker_id),
        source_name: `Rozpis – ${name}`, imported_at: new Date().toISOString()
      }));
    }
    const summary = [...attendance.keys()];
    let changed: typeof attendanceRows = [];
    if (attendanceRows.length) {
      const periods = [...new Set(attendanceRows.map(row => row.period))];
      const { data: existing, error } = await supabase.from("attendance_totals").select("worker_id, period, hours, in_list").in("period", periods);
      if (error) throw error;
      const old = new Map((existing ?? []).map(row => [`${row.worker_id}|${row.period}`, `${Number(row.hours)}|${Boolean(row.in_list)}`]));
      // Kdo v rozpisu daného měsíce už není, má za ten měsíc 0 h.
      const fresh = new Set(attendanceRows.map(row => `${row.worker_id}|${row.period}`));
      (existing ?? []).forEach(row => {
        if (!fresh.has(`${row.worker_id}|${row.period}`) && (Number(row.hours) !== 0 || row.in_list)) {
          attendanceRows.push({ worker_id: row.worker_id, period: row.period, hours: 0, in_list: false, source_name: "Rozpis – bez směn", imported_at: new Date().toISOString() });
        }
      });
      changed = attendanceRows.filter(row => old.get(`${row.worker_id}|${row.period}`) !== `${row.hours}|${row.in_list}`);
      if (changed.length && !dryRun) {
        for (let index = 0; index < changed.length; index += 500) {
          const { error: upsertError } = await supabase.from("attendance_totals").upsert(changed.slice(index, index + 500), { onConflict: "worker_id,period" });
          if (upsertError) throw upsertError;
        }
      }
    }
    const monthsSynced = monthSheets.map(item => item.sheetPeriod);

    // Rozpis směn ze všech listů v okně dat.
    const shifts = workbook.SheetNames.flatMap(name => buildShiftRows(matrices.get(name)!, { from, to, lookup })
      .map(row => ({ ...row, sheet: name })));
    const monthPrefix = period.slice(0, 7);
    const freeHours = Math.round(shifts.filter(row => row.free && row.date.startsWith(monthPrefix)).reduce((sum, row) => sum + (row.end - row.start) / 60, 0) * 100) / 100;
    const unmatched = [...new Set(shifts.filter(row => !row.free && !row.workerId).map(row => row.name))].slice(0, 50);
    // Rozpis se přepisuje jen při změně (jinak by se každých 5 minut
    // zbytečně mazalo a znovu vkládalo ~3000 řádků).
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([dateKey(from), dateKey(to), shifts])));
    const shiftsHash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
    const { data: lastRun } = await supabase.from("sheets_sync_runs").select("details").eq("status", "success")
      .order("started_at", { ascending: false }).limit(1).maybeSingle();
    const shiftsUnchanged = (lastRun?.details as { shifts_hash?: string } | null)?.shifts_hash === shiftsHash;
    if (shifts.length && !dryRun && !shiftsUnchanged) {
      const { error } = await supabase.rpc("replace_shifts", { p_from: dateKey(from), p_to: dateKey(to), p_rows: shifts });
      if (error) throw error;
    }

    // Prodejní reporty pro všechny naplánované prodejní směny (i dopředu)
    // a úklid nevyplněných, jejichž směna z rozpisu zmizela.
    const expected = salesExpectationsFromShifts(shifts);
    const scannedDates = [...new Set(shifts.map(row => row.date))].sort();
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
    const details = { team_list: listNames.length, team_list_applied: listApplied, team_created: listCreated, team_activated: activated, team_deactivated: deactivated, shifts_hash: shiftsHash, shifts_written: !shiftsUnchanged, months: monthsSynced, attendance_changed: changed.length, unknown_names: created, unmatched_shift_names: unmatched, shifts: shifts.length, free_hours: freeHours, sales_expected: expected.length, sales_stale_removed: staleRemoved };
    const result = { status: dryRun ? "dry_run" : "success", period, sheet: sheetName, seen: summary.length, changed: changed.filter(row => row.period === period).length, created: dryRun ? [...candidates.values()] : created, totalHours, plannedHours, ...details,
      sample: dryRun ? shifts.filter(row => row.date >= todayKey).slice(0, 15) : undefined };
    if (runId) {
      const { error } = await supabase.from("sheets_sync_runs").update({
        status: "success", sheet_name: sheetName, finished_at: new Date().toISOString(), workers_seen: summary.length,
        workers_changed: changed.filter(row => row.period === period).length, workers_created: created.length, total_hours: totalHours, planned_hours: plannedHours, details
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
