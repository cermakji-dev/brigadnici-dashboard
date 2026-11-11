-- Úpravy jen pod přihlášeným účtem (člen app_members), prohlížení zůstává veřejné.
-- Autora změny doplňuje databáze z JWT – klient ho nemůže podvrhnout.

create or replace function public.current_editor_label()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select nullif(trim(m.display_name), '') from public.app_members m where m.email = lower(auth.jwt() ->> 'email')),
    lower(auth.jwt() ->> 'email')
  );
$$;

create or replace function public.stamp_editor()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  label text;
  patch jsonb := '{}'::jsonb;
  col text;
  i int;
begin
  if uid is null then return new; end if; -- synchronizace (service role) nic nepřepisuje
  label := public.current_editor_label();
  for i in 0 .. tg_nargs - 1 loop
    col := tg_argv[i];
    if col = 'deleted_by_email' then
      patch := patch || jsonb_build_object(col, case when (to_jsonb(new) ->> 'deleted_at') is not null then label end);
    elsif col like '%\_email' then
      patch := patch || jsonb_build_object(col, label);
    else
      patch := patch || jsonb_build_object(col, uid);
    end if;
  end loop;
  new := jsonb_populate_record(new, patch);
  return new;
end;
$$;

drop trigger if exists stamp_editor_insert on public.feedback;
create trigger stamp_editor_insert before insert on public.feedback for each row execute function public.stamp_editor('created_by', 'created_by_email');
drop trigger if exists stamp_editor_update on public.feedback;
create trigger stamp_editor_update before update on public.feedback for each row execute function public.stamp_editor('deleted_by_email');
drop trigger if exists stamp_editor_insert on public.worker_notes;
create trigger stamp_editor_insert before insert on public.worker_notes for each row execute function public.stamp_editor('created_by', 'created_by_email');
drop trigger if exists stamp_editor_update on public.worker_notes;
create trigger stamp_editor_update before update on public.worker_notes for each row execute function public.stamp_editor('deleted_by_email');
drop trigger if exists stamp_editor on public.sales_days;
create trigger stamp_editor before insert or update on public.sales_days for each row execute function public.stamp_editor('updated_by', 'updated_by_email');
drop trigger if exists stamp_editor on public.worker_onboarding;
create trigger stamp_editor before insert or update on public.worker_onboarding for each row execute function public.stamp_editor('updated_by', 'updated_by_email');
drop trigger if exists stamp_editor on public.app_feedback;
create trigger stamp_editor before insert on public.app_feedback for each row execute function public.stamp_editor('created_by', 'created_by_email');
drop trigger if exists stamp_editor on public.attendance_totals;
create trigger stamp_editor before insert or update on public.attendance_totals for each row execute function public.stamp_editor('imported_by');

-- Historie profilu: jméno přihlášeného, jinak synchronizace.
create or replace function public.audit_worker_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.worker_audit (worker_id, changed_by, changed_by_email, operation, before_data, after_data)
  values (
    coalesce(new.id, old.id),
    auth.uid(),
    coalesce(public.current_editor_label(), case when auth.role() = 'service_role' then 'Synchronizace Google' end, 'Neznámý'),
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

-- Čtení: přihlášený vidí totéž co veřejnost (i bez členství).
alter policy "authenticated read workers" on public.workers using (true);
alter policy "authenticated read attendance" on public.attendance_totals using (true);
alter policy "authenticated read feedback" on public.feedback using (true);
alter policy "authenticated read sales days" on public.sales_days using (true);
alter policy "members read sync history" on public.sheets_sync_runs using (true);
alter policy "authenticated read audit" on public.worker_audit using (true);
alter policy "authenticated read worker notes" on public.worker_notes using (true);
alter policy "members read onboarding" on public.worker_onboarding using (true);

-- Zápisy veřejnosti pryč.
drop policy if exists "public insert workers" on public.workers;
drop policy if exists "public update workers" on public.workers;
drop policy if exists "public insert attendance" on public.attendance_totals;
drop policy if exists "public update attendance" on public.attendance_totals;
drop policy if exists "public insert feedback" on public.feedback;
drop policy if exists "public soft delete feedback" on public.feedback;
drop policy if exists "public insert sales days" on public.sales_days;
drop policy if exists "public update sales days" on public.sales_days;
drop policy if exists "public delete sales days" on public.sales_days;
drop policy if exists "public insert worker notes" on public.worker_notes;
drop policy if exists "public soft delete worker notes" on public.worker_notes;
drop policy if exists "public insert onboarding" on public.worker_onboarding;
drop policy if exists "public update onboarding" on public.worker_onboarding;
drop policy if exists "public insert app feedback" on public.app_feedback;
revoke insert, update, delete on public.workers, public.attendance_totals, public.feedback, public.sales_days,
  public.worker_notes, public.worker_onboarding, public.app_feedback from anon;

-- Členové: autor se doplní triggerem (jméno z app_members), soft delete přes update.
alter policy "authenticated insert worker notes" on public.worker_notes with check (public.is_app_member() and created_by = auth.uid());
alter policy "members insert app feedback" on public.app_feedback with check (public.is_app_member() and created_by = auth.uid());
drop policy if exists "members update feedback" on public.feedback;
create policy "members update feedback" on public.feedback for update to authenticated using (public.is_app_member()) with check (public.is_app_member());
drop policy if exists "members update worker notes" on public.worker_notes;
create policy "members update worker notes" on public.worker_notes for update to authenticated using (public.is_app_member()) with check (public.is_app_member());

-- Správa karet jen pro členy.
create or replace function public.admin_create_worker(p_external_user_id text, p_full_name text, p_email text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if not public.is_app_member() then raise exception 'Pro úpravy se přihlaste.'; end if;
  insert into public.workers(external_user_id, full_name, email, role, status, active, skills, reliability, departments, aliases, notes)
  values(trim(p_external_user_id), trim(p_full_name), nullif(trim(p_email), ''), 'Sales Support', 'Nováček', true, 0, 100, '{}', '{}', '')
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.admin_set_worker_active(p_worker_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_app_member() then raise exception 'Pro úpravy se přihlaste.'; end if;
  update public.workers
  set active = p_active, status = case when p_active then 'Aktivní' else 'Neaktivní' end
  where id = p_worker_id;
  if not found then raise exception 'Brigádník nebyl nalezen.'; end if;
end;
$$;

revoke execute on function public.admin_create_worker(text, text, text), public.admin_set_worker_active(uuid, boolean) from public, anon;
grant execute on function public.admin_create_worker(text, text, text), public.admin_set_worker_active(uuid, boolean) to authenticated;
revoke execute on function public.stamp_editor(), public.current_editor_label() from public, anon;
grant execute on function public.current_editor_label() to authenticated;
