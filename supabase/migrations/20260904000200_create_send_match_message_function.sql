-- supabase/migrations/20260904000200_create_send_match_message_function.sql
drop trigger if exists trg_notify_on_match_message on public.match_messages;
drop function if exists public.notify_on_match_message();

-- security definer (like the dropped trigger and Task 2's enforce_valid_mention):
-- this function must insert notifications on behalf of OTHER users, and
-- public.notifications has no insert grant/RLS policy for any role -- writes
-- to it only ever happen through security-definer functions, matching every
-- other notification-writing codepath in this codebase. Because security
-- definer bypasses RLS on match_messages and match_message_mentions too, the
-- two checks their RLS policies provide (participant/creator authorization,
-- and no self-mention) are re-implemented explicitly below.
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

  foreach v_mentioned_id in array p_mentions loop
    if v_mentioned_id = auth.uid() then
      raise exception 'cannot mention yourself';
    end if;
    insert into public.match_message_mentions (message_id, mentioned_user_id)
    values (v_message.id, v_mentioned_id);
  end loop;

  select field_name into v_field_name from public.matches where id = p_match_id;

  for v_recipient in
    select user_id from public.match_participants
    where match_id = p_match_id and status in ('approved','active') and user_id <> auth.uid()
    union
    select creator_id from public.matches where id = p_match_id and creator_id <> auth.uid()
  loop
    insert into public.notifications (user_id, type, payload)
    values (
      v_recipient.user_id,
      case when v_recipient.user_id = any(p_mentions) then 'match_message_mention' else 'match_message' end,
      jsonb_build_object(
        'message',
        case when v_recipient.user_id = any(p_mentions)
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

grant execute on function public.send_match_message(uuid, text, uuid[]) to authenticated;
revoke execute on function public.send_match_message(uuid, text, uuid[]) from public, anon;
