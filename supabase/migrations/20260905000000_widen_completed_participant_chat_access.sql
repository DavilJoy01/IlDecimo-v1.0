-- supabase/migrations/20260905000000_widen_completed_participant_chat_access.sql
-- transition_match_statuses() (20260830101500) flips every approved/active
-- participant to completed within a minute of the match's end_time -- so
-- 'completed' is the steady state of any past match's chat, not a rare edge
-- case. The chat access grant (match_messages RLS, see
-- 20260904000000_fix_match_messages_creator_access.sql) already includes
-- 'completed'; this migration widens the two places that had fallen out of
-- sync with that grant -- mention validity and notification fan-out -- so a
-- match's post-game chat keeps behaving like any other, instead of silently
-- degrading to read/post-only with no mentions or notifications the moment
-- the match ends.

create or replace function public.enforce_valid_mention()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match_id uuid;
  v_creator_id uuid;
  v_is_valid boolean;
begin
  select match_id into v_match_id from public.match_messages where id = new.message_id;
  select creator_id into v_creator_id from public.matches where id = v_match_id;

  if new.mentioned_user_id = v_creator_id then
    v_is_valid := true;
  else
    select exists(
      select 1 from public.match_participants
      where match_id = v_match_id
        and user_id = new.mentioned_user_id
        and status in ('approved','active','completed')
    ) into v_is_valid;
  end if;

  if not v_is_valid then
    raise exception 'cannot mention a user who is not the creator or an approved/active/completed participant of this match';
  end if;

  return new;
end;
$$;

-- Also: p_mentions is deduplicated before use, so a client sending the same
-- id twice (should never happen given selectMention's own dedup, but the RPC
-- shouldn't rely on that) can't hit match_message_mentions_pkey's unique
-- constraint and roll back an otherwise-valid send.
create or replace function public.send_match_message(
  p_match_id uuid,
  p_body text,
  p_mentions uuid[] default '{}'
)
returns public.match_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message public.match_messages;
  v_mentioned_id uuid;
  v_field_name text;
  v_recipient record;
  v_mentions uuid[];
begin
  if not exists (
    select 1 from public.match_participants mp
    where mp.match_id = p_match_id
      and mp.user_id = auth.uid()
      and mp.status in ('approved','active','completed')
  ) and not exists (
    select 1 from public.matches m where m.id = p_match_id and m.creator_id = auth.uid()
  ) then
    raise exception 'not authorized to post in this match room';
  end if;

  insert into public.match_messages (match_id, sender_id, body)
  values (p_match_id, auth.uid(), p_body)
  returning * into v_message;

  select array(select distinct unnest(p_mentions)) into v_mentions;

  foreach v_mentioned_id in array v_mentions loop
    if v_mentioned_id = auth.uid() then
      raise exception 'cannot mention yourself';
    end if;
    insert into public.match_message_mentions (message_id, mentioned_user_id)
    values (v_message.id, v_mentioned_id);
  end loop;

  select field_name into v_field_name from public.matches where id = p_match_id;

  for v_recipient in
    select user_id from public.match_participants
    where match_id = p_match_id and status in ('approved','active','completed') and user_id <> auth.uid()
    union
    select creator_id from public.matches where id = p_match_id and creator_id <> auth.uid()
  loop
    insert into public.notifications (user_id, type, payload)
    values (
      v_recipient.user_id,
      case when v_recipient.user_id = any(v_mentions) then 'match_message_mention' else 'match_message' end,
      jsonb_build_object(
        'message',
        case when v_recipient.user_id = any(v_mentions)
          then 'Sei stato menzionato in ' || v_field_name
          else 'Nuovo messaggio nella stanza di ' || v_field_name
        end,
        'match_id', p_match_id
      )
    );
  end loop;

  return v_message;
end;
$$;
