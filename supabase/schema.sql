-- Databázový základ pro interní aplikaci Brigádníci.
-- Spusťte celý soubor v Supabase SQL Editoru.

create extension if not exists pgcrypto;

create table if not exists public.app_members (
  email text primary key check (email = lower(email)),
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.workers (
  id uuid primary key default gen_random_uuid(),
  external_user_id text not null unique,
  full_name text not null,
  email text,
  role text not null default 'Sales Support',
  status text not null default 'Aktivní',
  active boolean not null default true,
  photo_url text,
  skills smallint not null default 50 check (skills between 0 and 100),
  reliability smallint not null default 50 check (reliability between 0 and 100),
  departments text[] not null default '{}',
  aliases text[] not null default '{}',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workers_departments_allowed check (
    departments <@ array['Výdej', 'Prodej', 'Lego', 'Pokladny', 'Upsell', 'MV', 'LOG', 'PS']::text[]
  )
);

alter table public.workers add column if not exists aliases text[] not null default '{}';

create table if not exists public.attendance_totals (
  worker_id uuid not null references public.workers(id) on delete cascade,
  period date not null,
  hours numeric(8,2) not null default 0 check (hours >= 0),
  source_name text,
  imported_by uuid references auth.users(id),
  imported_at timestamptz not null default now(),
  primary key (worker_id, period)
);

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete cascade,
  kind text not null check (kind in ('positive', 'negative')),
  category text not null default 'general' check (category in ('attendance', 'training', 'general')),
  note text not null check (length(trim(note)) > 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.feedback
  add column if not exists category text not null default 'general';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'feedback_category_check'
      and conrelid = 'public.feedback'::regclass
  ) then
    alter table public.feedback
      add constraint feedback_category_check
      check (category in ('attendance', 'training', 'general'));
  end if;
end
$$;

create table if not exists public.worker_audit (
  id bigint generated always as identity primary key,
  worker_id uuid not null,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now(),
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  before_data jsonb,
  after_data jsonb
);

create table if not exists public.worker_notes (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_by uuid not null references auth.users(id),
  created_by_email text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.app_feedback (
  id bigint generated always as identity primary key,
  category text not null check (category in ('suggestion', 'bug', 'other')),
  message text not null check (char_length(message) between 1 and 2000),
  page_url text,
  created_by uuid not null references auth.users(id),
  created_by_email text not null,
  created_at timestamptz not null default now()
);

alter table public.worker_audit add column if not exists changed_by_email text;

create or replace function public.is_app_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_members
    where email = lower(auth.jwt() ->> 'email')
  );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
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
    lower(auth.jwt() ->> 'email'),
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists workers_set_updated_at on public.workers;
create trigger workers_set_updated_at
before update on public.workers
for each row execute function public.set_updated_at();

drop trigger if exists workers_audit on public.workers;
create trigger workers_audit
after insert or update or delete on public.workers
for each row execute function public.audit_worker_change();

alter table public.app_members enable row level security;
alter table public.workers enable row level security;
alter table public.attendance_totals enable row level security;
alter table public.feedback enable row level security;
alter table public.worker_audit enable row level security;
alter table public.worker_notes enable row level security;
alter table public.app_feedback enable row level security;

revoke all on public.app_members from anon;
revoke all on public.workers from anon;
revoke all on public.attendance_totals from anon;
revoke all on public.feedback from anon;
revoke all on public.worker_audit from anon;
revoke all on public.worker_notes from anon;
revoke all on public.app_feedback from anon;

grant select on public.app_members to authenticated;
grant select, insert, update on public.workers to authenticated;
grant select, insert, update on public.attendance_totals to authenticated;
grant select, insert, delete on public.feedback to authenticated;
grant select on public.worker_audit to authenticated;
grant select, insert, delete on public.worker_notes to authenticated;
grant insert on public.app_feedback to authenticated;

grant execute on function public.is_app_member() to authenticated;

drop policy if exists "member reads own membership" on public.app_members;
create policy "member reads own membership" on public.app_members
for select to authenticated
using (email = lower(auth.jwt() ->> 'email'));

drop policy if exists "authenticated read workers" on public.workers;
create policy "authenticated read workers" on public.workers
for select to authenticated using (public.is_app_member());

drop policy if exists "authenticated insert workers" on public.workers;
create policy "authenticated insert workers" on public.workers
for insert to authenticated with check (public.is_app_member());

drop policy if exists "authenticated update workers" on public.workers;
create policy "authenticated update workers" on public.workers
for update to authenticated using (public.is_app_member()) with check (public.is_app_member());

drop policy if exists "authenticated read attendance" on public.attendance_totals;
create policy "authenticated read attendance" on public.attendance_totals
for select to authenticated using (public.is_app_member());

drop policy if exists "authenticated insert attendance" on public.attendance_totals;
create policy "authenticated insert attendance" on public.attendance_totals
for insert to authenticated with check (public.is_app_member() and imported_by = auth.uid());

drop policy if exists "authenticated update attendance" on public.attendance_totals;
create policy "authenticated update attendance" on public.attendance_totals
for update to authenticated using (public.is_app_member()) with check (public.is_app_member() and imported_by = auth.uid());

drop policy if exists "authenticated read feedback" on public.feedback;
create policy "authenticated read feedback" on public.feedback
for select to authenticated using (public.is_app_member());

drop policy if exists "authenticated insert feedback" on public.feedback;
create policy "authenticated insert feedback" on public.feedback
for insert to authenticated with check (public.is_app_member() and created_by = auth.uid());

drop policy if exists "authenticated delete feedback" on public.feedback;
create policy "authenticated delete feedback" on public.feedback
for delete to authenticated using (public.is_app_member());

drop policy if exists "authenticated read audit" on public.worker_audit;
create policy "authenticated read audit" on public.worker_audit
for select to authenticated using (public.is_app_member());

drop policy if exists "authenticated read worker notes" on public.worker_notes;
create policy "authenticated read worker notes" on public.worker_notes
for select to authenticated using (public.is_app_member());

drop policy if exists "authenticated insert worker notes" on public.worker_notes;
create policy "authenticated insert worker notes" on public.worker_notes
for insert to authenticated
with check (
  public.is_app_member()
  and created_by = auth.uid()
  and created_by_email = lower(auth.jwt() ->> 'email')
);

drop policy if exists "authenticated delete worker notes" on public.worker_notes;
create policy "authenticated delete worker notes" on public.worker_notes
for delete to authenticated using (public.is_app_member());

drop policy if exists "members insert app feedback" on public.app_feedback;
create policy "members insert app feedback" on public.app_feedback
for insert to authenticated
with check (
  public.is_app_member()
  and created_by = auth.uid()
  and created_by_email = lower(auth.jwt() ->> 'email')
);

create index if not exists workers_active_idx on public.workers(active);
create index if not exists attendance_period_idx on public.attendance_totals(period);
create index if not exists feedback_worker_created_idx on public.feedback(worker_id, created_at desc);
create index if not exists worker_audit_worker_changed_idx on public.worker_audit(worker_id, changed_at desc);
create index if not exists worker_notes_worker_created_idx on public.worker_notes(worker_id, created_at desc);
create index if not exists app_feedback_created_idx on public.app_feedback(created_at desc);

-- Následně spusťte také 2026-07-22-hardening.sql (onboarding, prodeje a role správců).
