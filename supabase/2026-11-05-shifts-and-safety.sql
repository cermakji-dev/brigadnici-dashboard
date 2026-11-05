-- Rozpis směn na serveru, denní záloha a úklid historie synchronizací.
-- Vratné mazání je v 2026-11-05-soft-delete.sql (spustit až s novou verzí aplikace).
-- Lze spustit opakovaně.

-- 1) Rozpis směn ---------------------------------------------------------------
-- Plní ho výhradně serverová synchronizace (funkce sync-google-sheets) přes
-- replace_shifts(); aplikace z něj jen čte.
create table if not exists public.shifts (
  id bigint generated always as identity primary key,
  shift_date date not null,
  start_minutes smallint not null check (start_minutes between 0 and 1440),
  end_minutes smallint not null check (end_minutes between 0 and 1440),
  department text not null default '',
  column_index smallint not null default 0,
  raw_name text not null,
  worker_id uuid references public.workers(id) on delete set null,
  is_free boolean not null default false,
  sheet_name text,
  synced_at timestamptz not null default now()
);
create index if not exists shifts_date_idx on public.shifts(shift_date);
create index if not exists shifts_worker_date_idx on public.shifts(worker_id, shift_date);

alter table public.shifts enable row level security;
revoke all on public.shifts from anon, authenticated;
grant select on public.shifts to anon, authenticated;
drop policy if exists "everyone reads shifts" on public.shifts;
create policy "everyone reads shifts" on public.shifts for select to anon, authenticated using (true);

-- Nahradí rozpis v daném rozmezí dat jedním krokem (žádný mezistav bez směn).
create or replace function public.replace_shifts(p_from date, p_to date, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare inserted integer;
begin
  delete from public.shifts where shift_date between p_from and p_to;
  insert into public.shifts (shift_date, start_minutes, end_minutes, department, column_index, raw_name, worker_id, is_free, sheet_name)
  select (item->>'date')::date, (item->>'start')::smallint, (item->>'end')::smallint,
         coalesce(item->>'department', ''), coalesce((item->>'column')::smallint, 0),
         left(coalesce(item->>'name', ''), 200), nullif(item->>'workerId', '')::uuid,
         coalesce((item->>'free')::boolean, false), item->>'sheet'
  from jsonb_array_elements(p_rows) as item
  where (item->>'date')::date between p_from and p_to;
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;
revoke execute on function public.replace_shifts(date, date, jsonb) from public, anon, authenticated;
grant execute on function public.replace_shifts(date, date, jsonb) to service_role;

-- Stav synchronizace je vidět v aplikaci.
grant select on public.sheets_sync_runs to anon;
drop policy if exists "public read sync history" on public.sheets_sync_runs;
create policy "public read sync history" on public.sheets_sync_runs for select to anon using (true);

-- 2) Denní záloha (mimo veřejné API) -----------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.daily_backups (
  id bigint generated always as identity primary key,
  taken_at timestamptz not null default now(),
  payload jsonb not null
);

create or replace function private.take_daily_backup()
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.daily_backups (payload)
  select jsonb_build_object(
    'workers', (select coalesce(jsonb_agg(t), '[]') from public.workers t),
    'feedback', (select coalesce(jsonb_agg(t), '[]') from public.feedback t),
    'worker_notes', (select coalesce(jsonb_agg(t), '[]') from public.worker_notes t),
    'worker_onboarding', (select coalesce(jsonb_agg(t), '[]') from public.worker_onboarding t),
    'sales_days', (select coalesce(jsonb_agg(t), '[]') from public.sales_days t),
    'attendance_totals', (select coalesce(jsonb_agg(t), '[]') from public.attendance_totals t)
  );
  delete from private.daily_backups where taken_at < now() - interval '30 days';
$$;

-- 3) Úklid historie synchronizací (synchronizace běží každých 5 minut, historie se drží 14 dní)
create or replace function private.prune_sync_runs()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.sheets_sync_runs where started_at < now() - interval '14 days';
$$;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('daily-backup', 'prune-sync-runs');
  perform cron.schedule('daily-backup', '17 2 * * *', 'select private.take_daily_backup()');
  perform cron.schedule('prune-sync-runs', '43 3 * * *', 'select private.prune_sync_runs()');
end
$$;

select private.take_daily_backup();
select private.prune_sync_runs();
