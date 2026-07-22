-- Spusťte jednou v Supabase SQL Editoru.
create table if not exists public.sales_days (
  id uuid primary key default gen_random_uuid(), worker_id uuid not null references public.workers(id) on delete cascade,
  shift_date date not null, planned_hours numeric(5,2) not null default 0 check (planned_hours >= 0),
  sales_hours numeric(5,2) check (sales_hours > 0), hardware_revenue numeric(12,2) check (hardware_revenue >= 0),
  services_revenue numeric(12,2) check (services_revenue >= 0), status text not null default 'pending' check (status in ('pending','reported','not_sales')),
  note text not null default '', updated_by uuid references auth.users(id), updated_by_email text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(worker_id, shift_date)
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
create index if not exists sales_days_worker_date_idx on public.sales_days(worker_id, shift_date desc);
