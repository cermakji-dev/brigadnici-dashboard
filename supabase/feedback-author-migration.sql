-- Uložení autora palce přímo se záznamem hodnocení.
-- Lze spustit opakovaně; doplní e-mail k historickým záznamům z auth.users.
alter table public.feedback
  add column if not exists created_by_email text;

update public.feedback as feedback
set created_by_email = coalesce(lower(users.email), 'Neznámý uživatel')
from auth.users as users
where users.id = feedback.created_by
  and feedback.created_by_email is null;

update public.feedback
set created_by_email = 'Neznámý uživatel'
where created_by_email is null;

alter table public.feedback
  alter column created_by_email set not null;
