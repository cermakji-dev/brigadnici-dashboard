-- POZOR: Jednorázově a nevratně vymaže poznámky u všech aktivních brigádníků.
-- Současně nastaví docházkovou morálku na 100 % a schopnosti podle počtu oddělení.
update public.workers as w
set
  notes = '',
  reliability = 100,
  skills = round((
    select count(distinct department)::numeric / 7 * 100
    from unnest(coalesce(w.departments, array[]::text[])) as department
    where department = any(array['Výdej', 'Prodej', 'Lego', 'Pokladny', 'Upsell', 'MV', 'LOG'])
  ))::integer
where active = true;
