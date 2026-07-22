-- Spusťte jednou v Supabase SQL Editoru.
-- Přidá více samostatných poznámek ke každému brigádníkovi.

create table if not exists public.worker_notes (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_by uuid not null references auth.users(id),
  created_by_email text not null,
  created_at timestamptz not null default now()
);

alter table public.worker_notes enable row level security;

revoke all on public.worker_notes from anon;
grant select, insert, delete on public.worker_notes to authenticated;

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

create index if not exists worker_notes_worker_created_idx
on public.worker_notes(worker_id, created_at desc);
