-- Rozpis připravený v modulu (koncept měsíce) a pravidla pro vypisování volných směn.
-- Čtení veřejné, zápis jen členové app_members; autora doplní trigger stamp_editor.
create table if not exists public.roster_drafts (
  month text primary key check (month ~ '^\d{4}-\d{2}$'),
  data jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_by_email text,
  updated_at timestamptz not null default now()
);
create table if not exists public.roster_rules (
  id text primary key default 'default',
  rules jsonb not null default '[]'::jsonb,
  updated_by uuid,
  updated_by_email text,
  updated_at timestamptz not null default now()
);
alter table public.roster_drafts enable row level security;
alter table public.roster_rules enable row level security;
grant select on public.roster_drafts, public.roster_rules to anon, authenticated;
grant insert, update, delete on public.roster_drafts to authenticated;
grant insert, update on public.roster_rules to authenticated;
create policy "everyone reads roster drafts" on public.roster_drafts for select to anon, authenticated using (true);
create policy "members write roster drafts" on public.roster_drafts for insert to authenticated with check (public.is_app_member());
create policy "members update roster drafts" on public.roster_drafts for update to authenticated using (public.is_app_member()) with check (public.is_app_member());
create policy "members delete roster drafts" on public.roster_drafts for delete to authenticated using (public.is_app_member());
create policy "everyone reads roster rules" on public.roster_rules for select to anon, authenticated using (true);
create policy "members insert roster rules" on public.roster_rules for insert to authenticated with check (public.is_app_member());
create policy "members update roster rules" on public.roster_rules for update to authenticated using (public.is_app_member()) with check (public.is_app_member());
create trigger roster_drafts_set_updated_at before update on public.roster_drafts for each row execute function public.set_updated_at();
create trigger roster_rules_set_updated_at before update on public.roster_rules for each row execute function public.set_updated_at();
create trigger stamp_editor before insert or update on public.roster_drafts for each row execute function public.stamp_editor('updated_by', 'updated_by_email');
create trigger stamp_editor before insert or update on public.roster_rules for each row execute function public.stamp_editor('updated_by', 'updated_by_email');
