-- Veřejný přístup bez přihlášení (od 28. 10. 2026).
-- Kdokoli s odkazem na aplikaci může číst, přidávat, upravovat i mazat data.
-- Stávající pravidla pro přihlášené vedoucí zůstávají beze změny.
-- Návrat k přihlašování: 2026-10-28-public-access-revert.sql

-- Autor změny: aplikace posílá jméno z pole „Podepisovat jako“ v hlavičce
-- x-editor-name (URL-kódované, protože HTTP hlavičky nesmí obsahovat diakritiku).
create or replace function public.url_decode(input text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  bytes bytea := ''::bytea;
  i int := 1;
  ch text;
begin
  if input is null then return null; end if;
  while i <= length(input) loop
    ch := substr(input, i, 1);
    if ch = '%' and i + 2 <= length(input) and substr(input, i + 1, 2) ~ '^[0-9A-Fa-f]{2}$' then
      bytes := bytes || decode(substr(input, i + 1, 2), 'hex');
      i := i + 3;
    else
      bytes := bytes || convert_to(case when ch = '+' then ' ' else ch end, 'UTF8');
      i := i + 1;
    end if;
  end loop;
  return convert_from(bytes, 'UTF8');
exception when others then
  return input;
end;
$$;

create or replace function public.request_editor_name()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(left(trim(public.url_decode(
    nullif(current_setting('request.headers', true), '')::json ->> 'x-editor-name'
  )), 80), '');
$$;

create or replace function public.audit_worker_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.worker_audit (worker_id, changed_by, changed_by_email, operation, before_data, after_data)
  values (
    coalesce(new.id, old.id),
    auth.uid(),
    coalesce(lower(auth.jwt() ->> 'email'), public.request_editor_name(), 'Veřejný přístup'),
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

-- Záznamy bez přihlášení nemají uživatele v auth.users.
alter table public.feedback alter column created_by drop not null;
alter table public.worker_notes alter column created_by drop not null;
alter table public.app_feedback alter column created_by drop not null;

-- Přidání a odebrání brigádníka už nevyžaduje roli správce.
create or replace function public.admin_create_worker(p_external_user_id text, p_full_name text, p_email text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare new_id uuid;
begin
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
  update public.workers
  set active = p_active, status = case when p_active then 'Aktivní' else 'Neaktivní' end
  where id = p_worker_id;
  if not found then raise exception 'Brigádník nebyl nalezen.'; end if;
end;
$$;

grant execute on function public.admin_create_worker(text, text, text) to anon;
grant execute on function public.admin_set_worker_active(uuid, boolean) to anon;

grant select, insert, update on public.workers to anon;
grant select, insert, update on public.attendance_totals to anon;
grant select, insert, delete on public.feedback to anon;
grant select on public.worker_audit to anon;
grant select, insert, delete on public.worker_notes to anon;
grant select, insert, update, delete on public.sales_days to anon;
grant select, insert, update on public.worker_onboarding to anon;
grant insert on public.app_feedback to anon;

drop policy if exists "public read workers" on public.workers;
create policy "public read workers" on public.workers for select to anon using (true);
drop policy if exists "public insert workers" on public.workers;
create policy "public insert workers" on public.workers for insert to anon with check (true);
drop policy if exists "public update workers" on public.workers;
create policy "public update workers" on public.workers for update to anon using (true) with check (true);

drop policy if exists "public read attendance" on public.attendance_totals;
create policy "public read attendance" on public.attendance_totals for select to anon using (true);
drop policy if exists "public insert attendance" on public.attendance_totals;
create policy "public insert attendance" on public.attendance_totals for insert to anon with check (true);
drop policy if exists "public update attendance" on public.attendance_totals;
create policy "public update attendance" on public.attendance_totals for update to anon using (true) with check (true);

drop policy if exists "public read feedback" on public.feedback;
create policy "public read feedback" on public.feedback for select to anon using (true);
drop policy if exists "public insert feedback" on public.feedback;
create policy "public insert feedback" on public.feedback for insert to anon with check (created_by is null);
drop policy if exists "public delete feedback" on public.feedback;
create policy "public delete feedback" on public.feedback for delete to anon using (true);

drop policy if exists "public read audit" on public.worker_audit;
create policy "public read audit" on public.worker_audit for select to anon using (true);

drop policy if exists "public read worker notes" on public.worker_notes;
create policy "public read worker notes" on public.worker_notes for select to anon using (true);
drop policy if exists "public insert worker notes" on public.worker_notes;
create policy "public insert worker notes" on public.worker_notes for insert to anon with check (created_by is null);
drop policy if exists "public delete worker notes" on public.worker_notes;
create policy "public delete worker notes" on public.worker_notes for delete to anon using (true);

drop policy if exists "public read sales days" on public.sales_days;
create policy "public read sales days" on public.sales_days for select to anon using (true);
drop policy if exists "public insert sales days" on public.sales_days;
create policy "public insert sales days" on public.sales_days for insert to anon with check (true);
drop policy if exists "public update sales days" on public.sales_days;
create policy "public update sales days" on public.sales_days for update to anon using (true) with check (true);
drop policy if exists "public delete sales days" on public.sales_days;
create policy "public delete sales days" on public.sales_days for delete to anon using (true);

drop policy if exists "public read onboarding" on public.worker_onboarding;
create policy "public read onboarding" on public.worker_onboarding for select to anon using (true);
drop policy if exists "public insert onboarding" on public.worker_onboarding;
create policy "public insert onboarding" on public.worker_onboarding for insert to anon with check (true);
drop policy if exists "public update onboarding" on public.worker_onboarding;
create policy "public update onboarding" on public.worker_onboarding for update to anon using (true) with check (true);

drop policy if exists "public insert app feedback" on public.app_feedback;
create policy "public insert app feedback" on public.app_feedback for insert to anon with check (created_by is null);
