-- supabase/migrations/20260914000000_add_type_to_push_notification_data.sql
-- send_push_notification_for_new_notification only ever sent `payload` as
-- the push's `data` object -- never `type` or the notification's own `id`.
-- The mobile app's tap-to-navigate logic (navigateForNotification) routes
-- entirely on `type`, and marking a tapped push's underlying row read needs
-- its `id` -- without both, a received push notification could never be
-- routed anywhere when tapped. Merges them into `data` alongside the
-- existing payload fields; `type`/`notification_id` are not otherwise used
-- payload keys, so this cannot collide with anything already sent.
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
      'data', new.payload || jsonb_build_object('type', new.type, 'notification_id', new.id)
    )
  );

  return new;
end;
$$;
