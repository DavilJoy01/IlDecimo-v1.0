-- supabase/migrations/20260903000100_restrict_match_update_lifecycle.sql
-- Cancelling a match is now a status update (see cancelMatch in the mobile
-- app) rather than a hard delete, so the update policy needs the same
-- lifecycle guard the old delete policy had: a match that already started or
-- completed can no longer be modified by its creator, cancellation included.
drop policy "matches_update_creator_only" on public.matches;

create policy "matches_update_creator_only" on public.matches
  for update to authenticated
  using (auth.uid() = creator_id and status not in ('started', 'completed'))
  with check (auth.uid() = creator_id);
