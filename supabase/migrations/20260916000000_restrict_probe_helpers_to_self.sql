-- Security audit finding (2026-09-15/16): public.is_fellow_participant and
-- public.users_have_mutual_block are both SECURITY DEFINER helpers granted
-- EXECUTE to `authenticated` (required -- both are called directly inside
-- RLS USING/WITH CHECK clauses, which run as the querying role, not
-- elevated). Every *legitimate* call site -- confirmed by grepping every
-- policy and function that references them -- always passes auth.uid() as
-- one of the two arguments:
--   * is_fellow_participant(match_id, auth.uid())        -- both existing
--     policies (match_participants, match_participant_events)
--   * users_have_mutual_block(auth.uid(), target_id)     -- get_user_profile,
--     get_user_match_history, search_user_by_code
--   * users_have_mutual_block(requester_id/inviter_id/user_a_id/user_b_id, ...)
--     -- friendships/match_invitations/private_conversations/private_messages
--     insert policies, where the auth.uid()-equality is already enforced by
--     the same WITH CHECK clause's other conjunct for any row that matters
--
-- Because neither function checks WHICH role is asking, any authenticated
-- client can call the RPC directly with two arbitrary IDs that have nothing
-- to do with them and get a real answer back:
--   * users_have_mutual_block(userX, userY) leaks whether two OTHER users
--     have blocked each other -- exactly the fact user_blocks_select_own's
--     RLS ("using (auth.uid() = blocker_id)") exists to hide, and the exact
--     attack 20260830101700_final_review_hardening.sql's own comment
--     already named ("any caller ... can probe arbitrary (user_a, user_b)
--     pairs and learn who blocked whom") -- but that migration's fix
--     (`revoke ... from public, anon`) only closed it for anonymous
--     callers, leaving every signed-up account able to run the exact same
--     probe.
--   * is_fellow_participant(matchId, userX) leaks whether an arbitrary user
--     is a confirmed participant of an arbitrary match, to a caller with no
--     relationship to that match at all -- bypassing
--     participants_select_relevant's RLS the same way.
--
-- Fix: both helpers now return false outright unless auth.uid() is one of
-- the identities being compared. Every legitimate call site above already
-- satisfies that (confirmed by the grep, and by the pre-existing pgTAP
-- suite passing unchanged against this new version) -- only the
-- direct-RPC-probe path loses the ability to learn anything real.

create or replace function public.is_fellow_participant(p_match_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select p_user_id = auth.uid() and exists (
    select 1 from public.match_participants mp2
    where mp2.match_id = p_match_id
      and mp2.user_id = p_user_id
      and mp2.status in ('approved','active','completed')
  );
$$;

create or replace function public.users_have_mutual_block(p_user_a uuid, p_user_b uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select (auth.uid() = p_user_a or auth.uid() = p_user_b) and exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = p_user_a and b.blocked_id = p_user_b)
       or (b.blocker_id = p_user_b and b.blocked_id = p_user_a)
  );
$$;
