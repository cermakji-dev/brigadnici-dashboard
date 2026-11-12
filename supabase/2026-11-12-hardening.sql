-- Po kontrole (Supabase advisors): triggerové a pomocné funkce nejdou volat přes API,
-- RLS vyhodnocuje auth.* jednou na dotaz, indexy pro cizí klíče.
revoke execute on function public.audit_worker_change() from public, anon, authenticated;
revoke execute on function public.stamp_editor() from public, anon, authenticated;
revoke execute on function public.current_editor_label() from public, anon, authenticated;
revoke execute on function public.is_app_member() from public, anon;
revoke execute on function public.is_app_admin() from public, anon;
grant execute on function public.is_app_member(), public.is_app_admin() to authenticated;
alter policy "member reads own membership" on public.app_members using (email = lower(((select auth.jwt()) ->> 'email')));
alter policy "authenticated insert attendance" on public.attendance_totals with check (public.is_app_member() and imported_by = (select auth.uid()));
alter policy "authenticated update attendance" on public.attendance_totals using (public.is_app_member()) with check (public.is_app_member() and imported_by = (select auth.uid()));
alter policy "authenticated insert feedback" on public.feedback with check (public.is_app_member() and created_by = (select auth.uid()));
alter policy "members insert onboarding" on public.worker_onboarding with check (public.is_app_member() and updated_by = (select auth.uid()));
alter policy "members update onboarding" on public.worker_onboarding using (public.is_app_member()) with check (public.is_app_member() and updated_by = (select auth.uid()));
alter policy "authenticated insert worker notes" on public.worker_notes with check (public.is_app_member() and created_by = (select auth.uid()));
alter policy "members insert app feedback" on public.app_feedback with check (public.is_app_member() and created_by = (select auth.uid()));
create index if not exists app_feedback_created_by_idx on public.app_feedback (created_by);
create index if not exists attendance_totals_imported_by_idx on public.attendance_totals (imported_by);
create index if not exists feedback_created_by_idx on public.feedback (created_by);
create index if not exists sales_days_updated_by_idx on public.sales_days (updated_by);
create index if not exists worker_audit_changed_by_idx on public.worker_audit (changed_by);
create index if not exists worker_notes_created_by_idx on public.worker_notes (created_by);
create index if not exists worker_onboarding_updated_by_idx on public.worker_onboarding (updated_by);
