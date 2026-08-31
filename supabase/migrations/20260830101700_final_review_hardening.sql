-- 1. CRITICAL: stop anon from reading the public-profile view via Supabase's
-- default table/view grants, which the earlier tasks never revoked (only
-- function-level default grants were caught and fixed, in Task 14).
revoke all on public.user_public_profiles from anon;
revoke all on public.user_public_profiles from public;

-- 2. CRITICAL: interpret match_date/start_time/end_time as Europe/Rome local
-- time, not the session's UTC default -- this is a single-market (Italy) MVP,
-- so a fixed zone is the smallest correct fix. Also wires up
-- matches_played_count, which nothing was ever incrementing.
create or replace function public.transition_match_statuses()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match record;
  v_participant record;
begin
  for v_match in
    select id, field_name from public.matches
    where status in ('open','full')
      and reminder_sent_at is null
      and (match_date + start_time) at time zone 'Europe/Rome' <= now() + interval '1 hour'
      and (match_date + start_time) at time zone 'Europe/Rome' > now()
  loop
    for v_participant in
      select user_id from public.match_participants
      where match_id = v_match.id and status in ('approved','active')
    loop
      insert into public.notifications (user_id, type, payload)
      values (
        v_participant.user_id,
        'match_reminder',
        jsonb_build_object('message', 'La tua partita a ' || v_match.field_name || ' inizia tra meno di un''ora', 'match_id', v_match.id)
      );
    end loop;

    update public.matches set reminder_sent_at = now() where id = v_match.id;
  end loop;

  update public.matches
  set status = 'started'
  where status in ('open','full')
    and (match_date + start_time) at time zone 'Europe/Rome' <= now();

  for v_match in
    select id from public.matches
    where status = 'started'
      and (match_date + end_time) at time zone 'Europe/Rome' <= now()
  loop
    for v_participant in
      select user_id from public.match_participants
      where match_id = v_match.id and status in ('approved','active')
    loop
      update public.match_participants
      set status = 'completed'
      where match_id = v_match.id and user_id = v_participant.user_id;

      update public.users
      set matches_completed_count = matches_completed_count + 1,
          matches_played_count = matches_played_count + 1
      where id = v_participant.user_id;
    end loop;

    update public.matches set status = 'completed' where id = v_match.id;
  end loop;
end;
$$;

-- 3. Pin every server-derived column on users, not just unique_user_id.
create or replace function public.protect_users_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.unique_user_id is distinct from old.unique_user_id then
    raise exception 'unique_user_id is immutable';
  end if;
  if auth.uid() is not null and new.phone is distinct from old.phone then
    raise exception 'phone cannot be changed directly; contact support to update your phone number';
  end if;
  if auth.uid() is not null and (
    new.matches_played_count is distinct from old.matches_played_count
    or new.matches_completed_count is distinct from old.matches_completed_count
    or new.matches_abandoned_count is distinct from old.matches_abandoned_count
  ) then
    raise exception 'match statistics are server-managed and cannot be changed directly';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'created_at cannot be changed';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- 4. Block-aware friendships and match_invitations inserts.
--
-- NOTE: deviates from the brief's literal SQL. The brief's raw `not exists
-- (select 1 from public.user_blocks b where ...)` subquery -- the same shape
-- already used by private_conversations_insert_participant_no_block (Task
-- 10) -- runs under the caller's own role, and user_blocks' RLS
-- (user_blocks_select_own: `using (auth.uid() = blocker_id)`) only lets the
-- blocker see the block row. So when the *blocked* party is the one issuing
-- the insert, the subquery can't see the row that blocks them and the check
-- silently passes -- exactly the direction the brief's own test (assertion
-- 5, "a blocked user cannot send a friend request to the person who blocked
-- them") exercises. Wrapping the check in a security definer helper (the
-- same RLS-bypass pattern already used by public.is_fellow_participant for
-- match_participants, Task 4) makes it symmetric. private_conversations'
-- existing check has the same latent gap but is out of scope for this task
-- (not one of the 10 findings) and is left untouched; see the task report.
create or replace function public.users_have_mutual_block(p_user_a uuid, p_user_b uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = p_user_a and b.blocked_id = p_user_b)
       or (b.blocker_id = p_user_b and b.blocked_id = p_user_a)
  );
$$;

alter policy "friendships_insert_as_requester" on public.friendships
  with check (
    auth.uid() = requester_id
    and not public.users_have_mutual_block(requester_id, receiver_id)
  );

alter policy "match_invitations_insert_as_inviter" on public.match_invitations
  with check (
    auth.uid() = inviter_id
    and not public.users_have_mutual_block(inviter_id, invitee_id)
  );

-- 5. A creator can no longer delete a match that has already started or completed.
alter policy "matches_delete_creator_only" on public.matches
  using (auth.uid() = creator_id and status not in ('started','completed'));

-- 6. Let either party delete a friendship in any state: unfriend (accepted),
-- withdraw (pending), or clear a rejected row to allow a fresh request.
grant delete on public.friendships to authenticated;

create policy "friendships_delete_participant" on public.friendships
  for delete to authenticated using (auth.uid() = requester_id or auth.uid() = receiver_id);

-- 7. clock_timestamp(), not now(), for the two chat tables' created_at --
-- same fix already applied to match_participant_events and notifications.
alter table public.match_messages alter column created_at set default clock_timestamp();
alter table public.private_messages alter column created_at set default clock_timestamp();

-- 8. Indexes for RLS-filtered reads and the cron sweep.
create index match_participant_events_match_participant_id_idx on public.match_participant_events (match_participant_id);
create index match_participants_user_id_idx on public.match_participants (user_id);
create index friendships_requester_id_idx on public.friendships (requester_id);
create index friendships_receiver_id_idx on public.friendships (receiver_id);
create index match_invitations_invitee_id_idx on public.match_invitations (invitee_id);
create index matches_creator_id_idx on public.matches (creator_id);
create index matches_cron_sweep_idx on public.matches (status, reminder_sent_at, match_date, start_time);

-- 9. Same implicit-PUBLIC-grant-on-create gap Task 14 found, applied to the
-- test-only helpers -- defense in depth in case the `tests` schema is ever
-- exposed to PostgREST.
revoke execute on function tests.authenticate_as(uuid) from public;
revoke execute on function tests.clear_authentication() from public;

-- 10. Wire the chat/notification tables into Realtime.
alter publication supabase_realtime add table public.match_messages, public.private_messages, public.notifications;
