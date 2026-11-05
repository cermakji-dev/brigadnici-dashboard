-- Vratné mazání palců a poznámek (aplikace v88 a novější).
-- Spustit až po nasazení v88: starší verze mazaly záznamy natrvalo a po této
-- migraci by mazání selhalo.

alter table public.feedback add column if not exists deleted_at timestamptz;
alter table public.feedback add column if not exists deleted_by_email text;
alter table public.worker_notes add column if not exists deleted_at timestamptz;
alter table public.worker_notes add column if not exists deleted_by_email text;

revoke delete on public.feedback, public.worker_notes from anon;
drop policy if exists "public delete feedback" on public.feedback;
drop policy if exists "public delete worker notes" on public.worker_notes;

grant update (deleted_at, deleted_by_email) on public.feedback, public.worker_notes to anon;
drop policy if exists "public soft delete feedback" on public.feedback;
create policy "public soft delete feedback" on public.feedback for update to anon using (true) with check (true);
drop policy if exists "public soft delete worker notes" on public.worker_notes;
create policy "public soft delete worker notes" on public.worker_notes for update to anon using (true) with check (true);

-- Veřejnost smí mazat jen dosud nevyplněné prodejní směny.
drop policy if exists "public delete sales days" on public.sales_days;
create policy "public delete sales days" on public.sales_days for delete to anon using (status = 'pending');

