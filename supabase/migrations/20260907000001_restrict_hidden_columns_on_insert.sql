-- supabase/migrations/20260907000001_restrict_hidden_columns_on_insert.sql
-- hidden_for_a_at/hidden_for_b_at (added in 20260907000000) are supposed to
-- be written only by trg_hide_conversation_on_block /
-- trg_unhide_conversation_on_unblock, never by a client directly. But the
-- INSERT policy on private_conversations predates those columns and its
-- `with check` doesn't constrain them at all, so a client could insert a row
-- that sets hidden_for_b_at itself, hiding the conversation from the other
-- participant with nothing to ever clear it (the unhide trigger only fires
-- on an actual user_blocks delete). Require both columns be null on insert,
-- keeping every existing condition from the policy unchanged.
alter policy "private_conversations_insert_participant_no_block" on public.private_conversations
  with check (
    (auth.uid() = user_a_id or auth.uid() = user_b_id)
    and not public.users_have_mutual_block(user_a_id, user_b_id)
    and hidden_for_a_at is null
    and hidden_for_b_at is null
  );
