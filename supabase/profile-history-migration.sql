-- Spusťte jednou v Supabase SQL Editoru u již existující databáze.
alter table public.worker_audit
  add column if not exists changed_by_email text;

create or replace function public.audit_worker_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.worker_audit (
    worker_id,
    changed_by,
    changed_by_email,
    operation,
    before_data,
    after_data
  )
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
