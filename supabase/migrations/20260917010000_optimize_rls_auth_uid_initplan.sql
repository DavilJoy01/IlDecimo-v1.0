-- supabase/migrations/20260917010000_optimize_rls_auth_uid_initplan.sql
--
-- Supabase advisor 'auth_rls_initplan' (WARN, 37 findings): every RLS policy
-- below calls auth.uid() directly, which Postgres re-evaluates for every row
-- scanned. Wrapping it as (select auth.uid()) lets the planner hoist it into
-- an InitPlan, evaluated once per query instead of once per row -- same result,
-- meaningfully faster on any table scan larger than a handful of rows. No
-- behavior change: verified by re-running the full pgTAP suite unchanged.

alter policy friendships_delete_participant on public.friendships
  using (
    (((select auth.uid()) = requester_id) OR ((select auth.uid()) = receiver_id))
  );

alter policy friendships_insert_as_requester on public.friendships
  with check (
    (((select auth.uid()) = requester_id) AND (NOT users_have_mutual_block(requester_id, receiver_id)))
  );

alter policy friendships_select_participants on public.friendships
  using (
    (((select auth.uid()) = requester_id) OR ((select auth.uid()) = receiver_id))
  );

alter policy friendships_update_by_participants on public.friendships
  using (
    (((select auth.uid()) = requester_id) OR ((select auth.uid()) = receiver_id))
  )
  with check (
    (((select auth.uid()) = requester_id) OR ((select auth.uid()) = receiver_id))
  );

alter policy match_invitations_insert_as_inviter on public.match_invitations
  with check (
    (((select auth.uid()) = inviter_id) AND (NOT users_have_mutual_block(inviter_id, invitee_id)))
  );

alter policy match_invitations_select_participants on public.match_invitations
  using (
    (((select auth.uid()) = inviter_id) OR ((select auth.uid()) = invitee_id))
  );

alter policy match_invitations_update_as_invitee on public.match_invitations
  using (
    ((select auth.uid()) = invitee_id)
  )
  with check (
    ((select auth.uid()) = invitee_id)
  );

alter policy match_message_mentions_insert_own_message on public.match_message_mentions
  with check (
    ((mentioned_user_id <> (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM match_messages mm
  WHERE ((mm.id = match_message_mentions.message_id) AND (mm.sender_id = (select auth.uid()))))))
  );

alter policy match_message_mentions_select_participants on public.match_message_mentions
  using (
    (EXISTS ( SELECT 1
   FROM match_messages mm
  WHERE ((mm.id = match_message_mentions.message_id) AND ((EXISTS ( SELECT 1
           FROM match_participants mp
          WHERE ((mp.match_id = mm.match_id) AND (mp.user_id = (select auth.uid())) AND (mp.status = ANY (ARRAY['approved'::text, 'active'::text, 'completed'::text]))))) OR ((select auth.uid()) = ( SELECT matches.creator_id
           FROM matches
          WHERE (matches.id = mm.match_id)))))))
  );

alter policy match_messages_insert_participants on public.match_messages
  with check (
    ((sender_id = (select auth.uid())) AND ((EXISTS ( SELECT 1
   FROM match_participants mp
  WHERE ((mp.match_id = match_messages.match_id) AND (mp.user_id = (select auth.uid())) AND (mp.status = ANY (ARRAY['approved'::text, 'active'::text, 'completed'::text]))))) OR ((select auth.uid()) = ( SELECT matches.creator_id
   FROM matches
  WHERE (matches.id = match_messages.match_id)))))
  );

alter policy match_messages_select_participants on public.match_messages
  using (
    ((EXISTS ( SELECT 1
   FROM match_participants mp
  WHERE ((mp.match_id = match_messages.match_id) AND (mp.user_id = (select auth.uid())) AND (mp.status = ANY (ARRAY['approved'::text, 'active'::text, 'completed'::text]))))) OR ((select auth.uid()) = ( SELECT matches.creator_id
   FROM matches
  WHERE (matches.id = match_messages.match_id))))
  );

alter policy participant_events_select_relevant on public.match_participant_events
  using (
    (((select auth.uid()) = ( SELECT match_participants.user_id
   FROM match_participants
  WHERE (match_participants.id = match_participant_events.match_participant_id))) OR ((select auth.uid()) = ( SELECT matches.creator_id
   FROM matches
  WHERE (matches.id = ( SELECT match_participants.match_id
           FROM match_participants
          WHERE (match_participants.id = match_participant_events.match_participant_id))))) OR is_fellow_participant(( SELECT match_participants.match_id
   FROM match_participants
  WHERE (match_participants.id = match_participant_events.match_participant_id)), (select auth.uid())))
  );

alter policy participants_insert_self on public.match_participants
  with check (
    ((select auth.uid()) = user_id)
  );

alter policy participants_select_relevant on public.match_participants
  using (
    (((select auth.uid()) = user_id) OR ((select auth.uid()) = ( SELECT matches.creator_id
   FROM matches
  WHERE (matches.id = match_participants.match_id))) OR is_fellow_participant(match_id, (select auth.uid())))
  );

alter policy participants_update_self_or_creator on public.match_participants
  using (
    (((select auth.uid()) = user_id) OR ((select auth.uid()) = ( SELECT matches.creator_id
   FROM matches
  WHERE (matches.id = match_participants.match_id))))
  )
  with check (
    (((select auth.uid()) = user_id) OR ((select auth.uid()) = ( SELECT matches.creator_id
   FROM matches
  WHERE (matches.id = match_participants.match_id))))
  );

alter policy matches_delete_creator_only on public.matches
  using (
    (((select auth.uid()) = creator_id) AND (status <> ALL (ARRAY['started'::text, 'completed'::text])))
  );

alter policy matches_insert_as_creator on public.matches
  with check (
    ((select auth.uid()) = creator_id)
  );

alter policy matches_select_relevant on public.matches
  using (
    ((status = 'open'::text) OR ((select auth.uid()) = creator_id) OR user_related_to_match(id, (select auth.uid())))
  );

alter policy matches_update_creator_only on public.matches
  using (
    (((select auth.uid()) = creator_id) AND (status <> ALL (ARRAY['started'::text, 'completed'::text])))
  )
  with check (
    ((select auth.uid()) = creator_id)
  );

alter policy notifications_select_own on public.notifications
  using (
    ((select auth.uid()) = user_id)
  );

alter policy notifications_update_own on public.notifications
  using (
    ((select auth.uid()) = user_id)
  )
  with check (
    ((select auth.uid()) = user_id)
  );

alter policy private_conversations_insert_participant_no_block on public.private_conversations
  with check (
    ((((select auth.uid()) = user_a_id) OR ((select auth.uid()) = user_b_id)) AND (NOT users_have_mutual_block(user_a_id, user_b_id)) AND (hidden_for_a_at IS NULL) AND (hidden_for_b_at IS NULL))
  );

alter policy private_conversations_select_participants on public.private_conversations
  using (
    (((select auth.uid()) = user_a_id) OR ((select auth.uid()) = user_b_id))
  );

alter policy private_messages_insert_participant_no_block on public.private_messages
  with check (
    ((sender_id = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM private_conversations c
  WHERE ((c.id = private_messages.conversation_id) AND ((c.user_a_id = (select auth.uid())) OR (c.user_b_id = (select auth.uid()))) AND (NOT users_have_mutual_block(c.user_a_id, c.user_b_id))))))
  );

alter policy private_messages_select_participants on public.private_messages
  using (
    (EXISTS ( SELECT 1
   FROM private_conversations c
  WHERE ((c.id = private_messages.conversation_id) AND ((c.user_a_id = (select auth.uid())) OR (c.user_b_id = (select auth.uid()))))))
  );

alter policy private_messages_update_read_receipt on public.private_messages
  using (
    ((EXISTS ( SELECT 1
   FROM private_conversations c
  WHERE ((c.id = private_messages.conversation_id) AND ((c.user_a_id = (select auth.uid())) OR (c.user_b_id = (select auth.uid())))))) AND (sender_id IS DISTINCT FROM (select auth.uid())))
  );

alter policy reports_insert_own on public.reports
  with check (
    ((select auth.uid()) = reporter_id)
  );

alter policy reports_select_own on public.reports
  using (
    ((select auth.uid()) = reporter_id)
  );

alter policy user_blocks_delete_own on public.user_blocks
  using (
    ((select auth.uid()) = blocker_id)
  );

alter policy user_blocks_insert_own on public.user_blocks
  with check (
    ((select auth.uid()) = blocker_id)
  );

alter policy user_blocks_select_own on public.user_blocks
  using (
    ((select auth.uid()) = blocker_id)
  );

alter policy user_push_tokens_delete_own on public.user_push_tokens
  using (
    ((select auth.uid()) = user_id)
  );

alter policy user_push_tokens_insert_own on public.user_push_tokens
  with check (
    ((select auth.uid()) = user_id)
  );

alter policy user_push_tokens_select_own on public.user_push_tokens
  using (
    ((select auth.uid()) = user_id)
  );

alter policy users_insert_self on public.users
  with check (
    ((select auth.uid()) = id)
  );

alter policy users_select_self on public.users
  using (
    ((select auth.uid()) = id)
  );

alter policy users_update_self on public.users
  using (
    ((select auth.uid()) = id)
  )
  with check (
    ((select auth.uid()) = id)
  );
