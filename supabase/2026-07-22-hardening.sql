-- Migrace nemění Google Sheets; pracuje pouze s databází aplikace.
alter table public.app_members add column if not exists role text not null default 'editor';
alter table public.app_members drop constraint if exists app_members_role_check;
alter table public.app_members add constraint app_members_role_check check (role in ('admin', 'editor'));

create or replace function public.is_app_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.app_members where email = lower(auth.jwt() ->> 'email') and role = 'admin');
$$;
grant execute on function public.is_app_admin() to authenticated;

create table if not exists public.worker_onboarding (
  worker_id uuid primary key references public.workers(id) on delete cascade,
  training_completed boolean not null default false,
  contracts_completed boolean not null default false,
  taxes_completed boolean not null default false,
  updated_by uuid references auth.users(id),
  updated_by_email text,
  updated_at timestamptz not null default now()
);
drop trigger if exists worker_onboarding_set_updated_at on public.worker_onboarding;
create trigger worker_onboarding_set_updated_at before update on public.worker_onboarding for each row execute function public.set_updated_at();
alter table public.worker_onboarding enable row level security;
revoke all on public.worker_onboarding from anon;
grant select, insert, update on public.worker_onboarding to authenticated;
drop policy if exists "members read onboarding" on public.worker_onboarding;
create policy "members read onboarding" on public.worker_onboarding for select to authenticated using (public.is_app_member());
drop policy if exists "members insert onboarding" on public.worker_onboarding;
create policy "members insert onboarding" on public.worker_onboarding for insert to authenticated with check (public.is_app_member() and updated_by = auth.uid());
drop policy if exists "members update onboarding" on public.worker_onboarding;
create policy "members update onboarding" on public.worker_onboarding for update to authenticated using (public.is_app_member()) with check (public.is_app_member() and updated_by = auth.uid());

create table if not exists public.sales_days (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete cascade,
  shift_date date not null,
  planned_hours numeric(5,2) not null default 0 check (planned_hours >= 0),
  sales_hours numeric(5,2) check (sales_hours > 0),
  hardware_revenue numeric(12,2) check (hardware_revenue >= 0),
  services_revenue numeric(12,2) check (services_revenue >= 0),
  status text not null default 'pending' check (status in ('pending','reported','not_sales')),
  note text not null default '',
  updated_by uuid references auth.users(id),
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(worker_id, shift_date)
);
drop trigger if exists sales_days_set_updated_at on public.sales_days;
create trigger sales_days_set_updated_at before update on public.sales_days for each row execute function public.set_updated_at();
alter table public.sales_days enable row level security;
revoke all on public.sales_days from anon;
grant select, insert, update, delete on public.sales_days to authenticated;
drop policy if exists "authenticated read sales days" on public.sales_days;
create policy "authenticated read sales days" on public.sales_days for select to authenticated using (public.is_app_member());
drop policy if exists "authenticated insert sales days" on public.sales_days;
create policy "authenticated insert sales days" on public.sales_days for insert to authenticated with check (public.is_app_member());
drop policy if exists "authenticated update sales days" on public.sales_days;
create policy "authenticated update sales days" on public.sales_days for update to authenticated using (public.is_app_member()) with check (public.is_app_member());
drop policy if exists "authenticated delete sales days" on public.sales_days;
create policy "authenticated delete sales days" on public.sales_days for delete to authenticated using (public.is_app_member());

create or replace function public.admin_set_worker_active(p_worker_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_app_admin() then
    raise exception 'Tuto akci může provést pouze správce.' using errcode = '42501';
  end if;
  update public.workers
    set active = p_active, status = case when p_active then 'Aktivní' else 'Neaktivní' end
    where id = p_worker_id;
  if not found then raise exception 'Brigádník nebyl nalezen.'; end if;
end;
$$;
grant execute on function public.admin_set_worker_active(uuid, boolean) to authenticated;

create or replace function public.admin_create_worker(p_external_user_id text, p_full_name text, p_email text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if not public.is_app_admin() then
    raise exception 'Tuto akci může provést pouze správce.' using errcode = '42501';
  end if;
  insert into public.workers(external_user_id, full_name, email, role, status, active, skills, reliability, departments, aliases, notes)
  values(trim(p_external_user_id), trim(p_full_name), nullif(trim(p_email), ''), 'Sales Support', 'Aktivní', true, 0, 100, '{}', '{}', '')
  returning id into new_id;
  return new_id;
end;
$$;
grant execute on function public.admin_create_worker(text, text, text) to authenticated;

create index if not exists onboarding_updated_idx on public.worker_onboarding(updated_at desc);
create index if not exists sales_days_worker_date_idx on public.sales_days(worker_id, shift_date desc);

-- Známé varianty jmen jsou data, ne logika frontendu.
update public.workers set full_name = 'Frey Jakub', aliases = array(select distinct unnest(aliases || array['Frey Golobov Jakub','Jakub Frey'])) where external_user_id = 'USER92212';
update public.workers set full_name = 'Bui Martin', aliases = array(select distinct unnest(aliases || array['Bui Anh Duc','Martin Bui','Martin Buy','Buy Martin'])) where external_user_id = 'USER98794';
update public.workers set full_name = 'Lain Jan', aliases = array(select distinct unnest(aliases || array['Lain Jan Matyas','Jan Lain'])) where external_user_id = 'USER98678';

-- Prvního správce nastavte jednou ručně:
-- update public.app_members set role = 'admin' where email = 'vas@email.cz';
