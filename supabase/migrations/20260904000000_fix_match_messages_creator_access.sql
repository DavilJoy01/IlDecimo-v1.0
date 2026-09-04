-- supabase/migrations/20260904000000_fix_match_messages_creator_access.sql
-- The creator of a match never has a row in match_participants for their own
-- match, so the original policies (which only check match_participants.status)
-- locked them out of their own match's chat. The equivalent policies on
-- match_participants itself already special-case the creator; these two did
-- not, which was an oversight in the original migration, not a design choice.
drop policy "match_messages_select_participants" on public.match_messages;
drop policy "match_messages_insert_participants" on public.match_messages;

create policy "match_messages_select_participants" on public.match_messages
  for select to authenticated using (
    exists (
      select 1 from public.match_participants mp
      where mp.match_id = match_messages.match_id
        and mp.user_id = auth.uid()
        and mp.status in ('approved','active','completed')
    )
    or auth.uid() = (select creator_id from public.matches where id = match_messages.match_id)
  );

create policy "match_messages_insert_participants" on public.match_messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and (
      exists (
        select 1 from public.match_participants mp
        where mp.match_id = match_messages.match_id
          and mp.user_id = auth.uid()
          and mp.status in ('approved','active','completed')
      )
      or auth.uid() = (select creator_id from public.matches where id = match_messages.match_id)
    )
  );
