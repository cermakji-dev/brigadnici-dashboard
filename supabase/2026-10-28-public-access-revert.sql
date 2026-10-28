-- Vrátí přístup jen pro přihlášené vedoucí (zruší 2026-10-28-public-access.sql).
-- Po spuštění je potřeba nasadit i verzi aplikace s přihlašováním (v86 a starší).

drop policy if exists "public read workers" on public.workers;
drop policy if exists "public insert workers" on public.workers;
drop policy if exists "public update workers" on public.workers;
drop policy if exists "public read attendance" on public.attendance_totals;
drop policy if exists "public insert attendance" on public.attendance_totals;
drop policy if exists "public update attendance" on public.attendance_totals;
drop policy if exists "public read feedback" on public.feedback;
drop policy if exists "public insert feedback" on public.feedback;
drop policy if exists "public delete feedback" on public.feedback;
drop policy if exists "public read audit" on public.worker_audit;
drop policy if exists "public read worker notes" on public.worker_notes;
drop policy if exists "public insert worker notes" on public.worker_notes;
drop policy if exists "public delete worker notes" on public.worker_notes;
drop policy if exists "public read sales days" on public.sales_days;
drop policy if exists "public insert sales days" on public.sales_days;
drop policy if exists "public update sales days" on public.sales_days;
drop policy if exists "public delete sales days" on public.sales_days;
drop policy if exists "public read onboarding" on public.worker_onboarding;
drop policy if exists "public insert onboarding" on public.worker_onboarding;
drop policy if exists "public update onboarding" on public.worker_onboarding;
drop policy if exists "public insert app feedback" on public.app_feedback;

revoke all on public.workers, public.attendance_totals, public.feedback, public.worker_audit,
  public.worker_notes, public.sales_days, public.worker_onboarding, public.app_feedback from anon;
revoke execute on function public.admin_create_worker(text, text, text) from anon, public;
revoke execute on function public.admin_set_worker_active(uuid, boolean) from anon, public;

create or replace function public.admin_create_worker(p_external_user_id text, p_full_name text, p_email text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare new_id uuid;
begin
  if not public.is_app_admin() then raise exception 'Tuto akci může provést pouze správce.' using errcode = '42501'; end if;
  insert into public.workers(external_user_id, full_name, email, role, status, active, skills, reliability, departments, aliases, notes)
  values(trim(p_external_user_id), trim(p_full_name), nullif(trim(p_email), ''), 'Sales Support', 'Nováček', true, 0, 100, '{}', '{}', '')
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.admin_set_worker_active(p_worker_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_app_admin() then raise exception 'Tuto akci může provést pouze správce.' using errcode = '42501'; end if;
  update public.workers
  set active = p_active, status = case when p_active then 'Aktivní' else 'Neaktivní' end
  where id = p_worker_id;
  if not found then raise exception 'Brigádník nebyl nalezen.'; end if;
end;
$$;

-- Sloupce created_by zůstávají povolené jako prázdné kvůli záznamům
-- vytvořeným během veřejného režimu; nová pravidla pro přihlášené je
-- stejně vyžadují (created_by = auth.uid()).
