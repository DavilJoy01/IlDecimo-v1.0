-- Security audit finding (2026-09-16), flagged but deliberately deferred at
-- the time: public.matches' own SELECT policy is `using (true)` -- any
-- authenticated client can read every column of every match row directly
-- (table access, not the app UI), for any status and any location,
-- regardless of the "nearby open matches" feature's intended scope. This
-- bypasses two things by design elsewhere in the schema:
--   * the public discovery surface is meant to be "open matches near me",
--     served by the SECURITY DEFINER public.nearby_open_matches() RPC
--     (distance-filtered, status = 'open' only, limited columns) -- that
--     RPC is unaffected by this migration either way, since SECURITY
--     DEFINER functions bypass RLS on the tables they query;
--   * matches that are 'draft', 'full', 'started', 'completed' or
--     'cancelled' are never returned by that RPC at all, yet a raw
--     `supabase.from('matches').select()` call (trivial with the public
--     anon/authenticated key, no app UI involved) could read every one of
--     them anyway -- exact address/coordinates included -- for a match the
--     caller has no relationship to whatsoever.
--
-- Fix: a caller may only select a match row when it is either (a) still
-- open (preserves the existing, intentional "browse nearby open matches"
-- discovery flow -- confirmed the client fetches a tapped match's full
-- detail via a direct `matches` SELECT, not only through the RPC), or (b)
-- one they have an actual relationship to: creator, a match_participants
-- row of any status (covers a pending 'requested' row, and lets a
-- participant keep viewing a match's own history after it moves to
-- 'completed'), or a match_invitations row as the invitee.
--
-- A first version of this migration used plain `exists (select 1 from
-- public.match_participants ...)` subqueries directly in the USING clause.
-- That is wrong and was caught by the pgTAP suite (023, 025, 026, 027 all
-- started failing with "infinite recursion detected in policy for relation
-- matches"): match_participants' own SELECT policy
-- (participants_select_relevant) subqueries public.matches for
-- auth.uid() = creator_id, so evaluating matches' policy needed
-- match_participants' policy, which needed matches' policy again. The fix
-- (same pattern already used for is_fellow_participant/
-- users_have_mutual_block in 20260916000000) is to route the
-- match_participants/match_invitations check through a SECURITY DEFINER
-- function: it runs as the function owner, which bypasses RLS on the
-- tables it queries internally, so it never re-enters matches' own policy.
-- Like those two functions, it self-restricts to auth.uid() so it cannot
-- be called directly as an RPC to probe an arbitrary (match, user) pair.
create or replace function public.user_related_to_match(p_match_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select p_user_id = auth.uid() and (
    exists (
      select 1 from public.match_participants mp
      where mp.match_id = p_match_id
        and mp.user_id = p_user_id
    )
    or exists (
      select 1 from public.match_invitations mi
      where mi.match_id = p_match_id
        and mi.invitee_id = p_user_id
    )
  );
$$;

grant execute on function public.user_related_to_match(uuid, uuid) to authenticated;
revoke execute on function public.user_related_to_match(uuid, uuid) from public, anon;

drop policy "matches_select_authenticated" on public.matches;

create policy "matches_select_relevant" on public.matches
  for select to authenticated using (
    status = 'open'
    or auth.uid() = creator_id
    or public.user_related_to_match(matches.id, auth.uid())
  );

-- Verified safe against every other RLS policy that subqueries
-- public.matches for the *current caller's own* creator_id
-- (participants_select_relevant, its update-policy sibling, and both
-- match_messages policies in 20260904000000_fix_match_messages_creator_access.sql):
-- each only ever needs that subquery to resolve for the actual creator,
-- who is always visible under the new policy via the direct
-- `auth.uid() = creator_id` clause -- no recursion there, since neither of
-- those subqueries goes through user_related_to_match.
