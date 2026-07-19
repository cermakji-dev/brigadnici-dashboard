grant delete on public.feedback to authenticated;

drop policy if exists "authenticated delete feedback" on public.feedback;
create policy "authenticated delete feedback" on public.feedback
for delete to authenticated
using (public.is_app_member());
