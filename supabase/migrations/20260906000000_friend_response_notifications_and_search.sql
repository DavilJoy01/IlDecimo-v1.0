-- supabase/migrations/20260906000000_friend_response_notifications_and_search.sql
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'join_request_received','join_request_approved','join_request_rejected',
  'friend_request_received','friend_request_approved','friend_request_rejected',
  'match_invitation','private_message','match_message',
  'match_message_mention','match_reminder','match_time_changed','match_location_changed',
  'match_cancelled'
));

-- Mirrors notify_on_participant_change's shape: notify the REQUESTER (not
-- the receiver, who already got notified on insert by the pre-existing
-- notify_on_friend_request trigger) once a decision is made. The `if` below
-- restates what enforce_friendship_transition's BEFORE trigger already
-- guarantees (old.status = 'pending', new.status in ('accepted','rejected')
-- whenever an update is allowed through at all) -- cheap, and keeps this
-- trigger correct even if that guarantee is ever weakened later.
create or replace function public.notify_on_friend_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receiver_name text;
begin
  if old.status = 'pending' and new.status in ('accepted','rejected') then
    select first_name || ' ' || last_name into v_receiver_name from public.users where id = new.receiver_id;

    insert into public.notifications (user_id, type, payload)
    values (
      new.requester_id,
      case when new.status = 'accepted' then 'friend_request_approved' else 'friend_request_rejected' end,
      jsonb_build_object(
        'message',
        case when new.status = 'accepted'
          then v_receiver_name || ' ha accettato la tua richiesta di amicizia'
          else v_receiver_name || ' ha rifiutato la tua richiesta di amicizia'
        end,
        'friendship_id', new.id,
        'user_id', new.receiver_id
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_on_friend_response on public.friendships;
create trigger trg_notify_on_friend_response
  after update on public.friendships
  for each row execute function public.notify_on_friend_response();

-- Blocking someone clears any trace of a prior friendship, regardless of
-- its status (pending, accepted, or rejected).
create or replace function public.delete_friendship_on_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.friendships
  where least(requester_id, receiver_id) = least(new.blocker_id, new.blocked_id)
    and greatest(requester_id, receiver_id) = greatest(new.blocker_id, new.blocked_id);
  return new;
end;
$$;

drop trigger if exists trg_delete_friendship_on_block on public.user_blocks;
create trigger trg_delete_friendship_on_block
  after insert on public.user_blocks
  for each row execute function public.delete_friendship_on_block();

-- user_public_profiles has no RLS of its own (a plain view with a grant,
-- security_invoker = false) -- a raw client-side query filtered by
-- unique_user_id would leak blocked users into search results. This RPC
-- does the lookup server-side, excluding the caller's own row and any row
-- with a mutual block, so "no such code", "that's you", and "blocked" are
-- all indistinguishable from the caller's side (never reveal a block).
--
-- IMPORTANT for callers (tests included): this RETURNs a single row, not
-- SETOF. When the query below matches nothing, Postgres does NOT produce
-- zero rows from a `FROM search_user_by_code(...)` call or a bare scalar
-- call through PostgREST -- it produces exactly one row/object with every
-- column NULL (confirmed empirically through the real PostgREST JSON
-- layer: a "not found" call serializes as `{"id": null, ...}`, never JSON
-- `null`). Never test or consume this with `count(*) = 0` or `!data`; check
-- whether the returned `id` is NULL instead (see Task 2's `searchUserByCode`
-- and this task's own pgTAP test for the correct pattern).
create or replace function public.search_user_by_code(p_code text)
returns public.user_public_profiles
language sql
security definer
set search_path = ''
stable
as $$
  select p.*
  from public.user_public_profiles p
  where p.unique_user_id = p_code
    and p.id <> auth.uid()
    and not public.users_have_mutual_block(auth.uid(), p.id)
  limit 1;
$$;

grant execute on function public.search_user_by_code(text) to authenticated;
revoke execute on function public.search_user_by_code(text) from public, anon;
