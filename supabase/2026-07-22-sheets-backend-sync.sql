-- Backend synchronization foundation. Google Sheets remains read-only.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create table if not exists public.sheets_sync_runs (
  id bigint generated always as identity primary key,
  status text not null check (status in ('running', 'success', 'error')),
  period date not null,
  sheet_name text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  workers_seen integer not null default 0,
  workers_changed integer not null default 0,
  workers_created integer not null default 0,
  total_hours numeric(10,2),
  planned_hours numeric(10,2),
  error_message text,
  details jsonb not null default '{}'
);
alter table public.sheets_sync_runs enable row level security;
revoke all on public.sheets_sync_runs from anon;
grant select on public.sheets_sync_runs to authenticated;
drop policy if exists "members read sync history" on public.sheets_sync_runs;
create policy "members read sync history" on public.sheets_sync_runs for select to authenticated using (public.is_app_member());
create index if not exists sheets_sync_runs_started_idx on public.sheets_sync_runs(started_at desc);

create table if not exists public.sheets_sync_lock (
  id boolean primary key default true check (id),
  locked_until timestamptz not null default '-infinity'
);
insert into public.sheets_sync_lock(id) values(true) on conflict (id) do nothing;
revoke all on public.sheets_sync_lock from anon, authenticated;

create or replace function public.acquire_sheets_sync_lock()
returns boolean language plpgsql security definer set search_path = '' as $$
declare acquired boolean;
begin
  update public.sheets_sync_lock set locked_until = now() + interval '10 minutes'
  where id = true and locked_until < now() returning true into acquired;
  return coalesce(acquired, false);
end;
$$;
create or replace function public.release_sheets_sync_lock()
returns void language sql security definer set search_path = '' as $$
  update public.sheets_sync_lock set locked_until = '-infinity' where id = true;
$$;
revoke all on function public.acquire_sheets_sync_lock() from public, anon, authenticated;
revoke all on function public.release_sheets_sync_lock() from public, anon, authenticated;
grant execute on function public.acquire_sheets_sync_lock() to service_role;
grant execute on function public.release_sheets_sync_lock() to service_role;

-- After deploying the function, add the same long random value as:
-- 1. Edge Function secret SYNC_CRON_SECRET
-- 2. Vault secret sheets_sync_secret
-- Then store the project URL and schedule the function:
-- select vault.create_secret('YOUR_LONG_RANDOM_TOKEN', 'sheets_sync_secret');
-- select vault.create_secret('https://kgfszhhsrxsyccxywnpn.supabase.co', 'project_url');
-- select cron.schedule(
--   'sync-google-sheets-every-5-minutes', '*/5 * * * *',
--   $$ select net.http_post(
--     url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sync-google-sheets',
--     headers := jsonb_build_object('Content-Type','application/json','x-sync-secret',(select decrypted_secret from vault.decrypted_secrets where name = 'sheets_sync_secret')),
--     body := '{}'::jsonb
--   ); $$
-- );
