-- Spusťte jednou v Supabase SQL Editoru u již existující databáze.
-- Starší hodnocení se zařadí do kategorie Obecné.
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
