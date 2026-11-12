-- Zatím bez přihlášení: veřejnost (anon) zase smí upravovat jako před v108.
-- Autor změny = nepovinný podpis z hlavičky x-editor-name, jinak „Veřejný přístup“.
-- Přihlášení členové (authenticated) fungují dál beze změny.

create policy "public insert workers" on public.workers for insert to anon with check (true);
create policy "public update workers" on public.workers for update to anon using (true) with check (true);
create policy "public insert attendance" on public.attendance_totals for insert to anon with check (true);
create policy "public update attendance" on public.attendance_totals for update to anon using (true) with check (true);
create policy "public insert feedback" on public.feedback for insert to anon with check (created_by is null);
create policy "public soft delete feedback" on public.feedback for update to anon using (true) with check (true);
create policy "public insert sales days" on public.sales_days for insert to anon with check (true);
create policy "public update sales days" on public.sales_days for update to anon using (true) with check (true);
create policy "public delete sales days" on public.sales_days for delete to anon using (status = 'pending');
create policy "public insert worker notes" on public.worker_notes for insert to anon with check (created_by is null);
create policy "public soft delete worker notes" on public.worker_notes for update to anon using (true) with check (true);
create policy "public insert onboarding" on public.worker_onboarding for insert to anon with check (true);
create policy "public update onboarding" on public.worker_onboarding for update to anon using (true) with check (true);
create policy "public insert app feedback" on public.app_feedback for insert to anon with check (created_by is null);
grant insert, update on public.workers, public.attendance_totals, public.feedback, public.sales_days,
  public.worker_notes, public.worker_onboarding to anon;
grant delete on public.sales_days to anon;
grant insert on public.app_feedback to anon;

create or replace function public.admin_create_worker(p_external_user_id text, p_full_name text, p_email text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  insert into public.workers(external_user_id, full_name, email, role, status, active, skills, reliability, departments, aliases, notes)
  values(trim(p_external_user_id), trim(p_full_name), nullif(trim(p_email), ''), 'Sales Support', 'Nováček', true, 0, 100, '{}', '{}', '')
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.admin_set_worker_active(p_worker_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.workers
  set active = p_active, status = case when p_active then 'Aktivní' else 'Neaktivní' end
  where id = p_worker_id;
  if not found then raise exception 'Brigádník nebyl nalezen.'; end if;
end;
$$;
grant execute on function public.admin_create_worker(text, text, text), public.admin_set_worker_active(uuid, boolean) to anon;

-- Historie profilu: přihlášený člen, jinak podpis z hlavičky, jinak synchronizace / veřejný přístup.
create or replace function public.audit_worker_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.worker_audit (worker_id, changed_by, changed_by_email, operation, before_data, after_data)
  values (
    coalesce(new.id, old.id),
    auth.uid(),
    coalesce(public.current_editor_label(), public.request_editor_name(),
      case when auth.role() = 'service_role' then 'Synchronizace Google' end, 'Veřejný přístup'),
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;
