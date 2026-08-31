-- supabase/migrations/20260830101600_send_push_notifications.sql
create or replace function public.send_push_notification_for_new_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tokens text[];
begin
  select array_agg(push_token) into v_tokens
  from public.user_push_tokens
  where user_id = new.user_id;

  if v_tokens is null or array_length(v_tokens, 1) = 0 then
    return new;
  end if;

  perform net.http_post(
    url := 'https://exp.host/--/api/v2/push/send',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'to', v_tokens,
      'title', 'App Calcio',
      'body', coalesce(new.payload->>'message', 'Hai una nuova notifica'),
      'data', new.payload
    )
  );

  return new;
end;
$$;

create trigger trg_send_push_notification
  after insert on public.notifications
  for each row execute function public.send_push_notification_for_new_notification();
