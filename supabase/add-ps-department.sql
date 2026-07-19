-- Jednorázová migrace: povolí oddělení PS v zaškolení brigádníků.
-- Spusťte celý soubor v Supabase SQL Editoru.

alter table public.workers
  drop constraint if exists workers_departments_allowed;

alter table public.workers
  add constraint workers_departments_allowed check (
    departments <@ array['Výdej', 'Prodej', 'Lego', 'Pokladny', 'Upsell', 'MV', 'LOG', 'PS']::text[]
  );
