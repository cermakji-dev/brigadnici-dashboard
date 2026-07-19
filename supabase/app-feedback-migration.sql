-- Spusťte jednou v Supabase SQL Editoru u již existující databáze.
create table if not exists public.app_feedback (
  id bigint generated always as identity primary key,
  category text not null check (category in ('suggestion', 'bug', 'other')),
  message text not null check (char_length(message) between 1 and 2000),
  page_url text,
  created_by uuid not null references auth.users(id),
  created_by_email text not null,
  created_at timestamptz not null default now()
);

alter table public.app_feedback enable row level security;
revoke all on public.app_feedback from anon;
grant insert on public.app_feedback to authenticated;

drop policy if exists "members insert app feedback" on public.app_feedback;
create policy "members insert app feedback" on public.app_feedback
for insert to authenticated
with check (
  public.is_app_member()
  and created_by = auth.uid()
  and created_by_email = lower(auth.jwt() ->> 'email')
);

create index if not exists app_feedback_created_idx
  on public.app_feedback(created_at desc);
