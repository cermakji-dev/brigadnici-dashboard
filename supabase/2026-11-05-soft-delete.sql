-- Vratné mazání palců a poznámek (aplikace v88 a novější). Lze spustit opakovaně.

-- 1) Sloupce a právo skrýt záznam (spuštěno 5. 11. 2026, neovlivňuje starší verze).
alter table public.feedback add column if not exists deleted_at timestamptz;
alter table public.feedback add column if not exists deleted_by_email text;
alter table public.worker_notes add column if not exists deleted_at timestamptz;
alter table public.worker_notes add column if not exists deleted_by_email text;

grant update (deleted_at, deleted_by_email) on public.feedback, public.worker_notes to anon;
drop policy if exists "public soft delete feedback" on public.feedback;
create policy "public soft delete feedback" on public.feedback for update to anon using (true) with check (true);
drop policy if exists "public soft delete worker notes" on public.worker_notes;
create policy "public soft delete worker notes" on public.worker_notes for update to anon using (true) with check (true);

-- 2) Až po nasazení v88: veřejnost už nesmí mazat natrvalo
--    (verze v87 a starší by mazání hlásily jako chybu).
revoke delete on public.feedback, public.worker_notes from anon;
drop policy if exists "public delete feedback" on public.feedback;
drop policy if exists "public delete worker notes" on public.worker_notes;

-- Veřejnost smí mazat jen dosud nevyplněné prodejní směny.
drop policy if exists "public delete sales days" on public.sales_days;
create policy "public delete sales days" on public.sales_days for delete to anon using (status = 'pending');
