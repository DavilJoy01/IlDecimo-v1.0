-- supabase/tests/016_send_push_notifications.test.sql
begin;
select plan(3);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','player@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

-- Deliberately not calling tests.authenticate_as here: this test exercises the
-- push-delivery trigger itself, not RLS. In production, notifications are only
-- ever inserted by other SECURITY DEFINER functions (Tasks 7/8/9/11/12/15/16),
-- never directly by an authenticated client (notifications has no insert grant
-- for `authenticated`), so the fixture inserts below run as the test's default
-- superuser role, matching how these rows are actually created.

select lives_ok(
  $$ insert into public.notifications (user_id, type, payload) values ('11111111-1111-1111-1111-111111111111', 'match_reminder', '{"message":"La tua partita inizia tra 1 ora"}'::jsonb) $$,
  'inserting a notification with no registered push token does not raise an error'
);

insert into public.user_push_tokens (user_id, push_token) values ('11111111-1111-1111-1111-111111111111', 'ExponentPushToken[test-token]');

select lives_ok(
  $$ insert into public.notifications (user_id, type, payload) values ('11111111-1111-1111-1111-111111111111', 'match_reminder', '{"message":"La tua partita inizia tra 1 ora"}'::jsonb) $$,
  'inserting a notification with a registered push token does not raise an error'
);

select ok(
  (select count(*) from net.http_request_queue) >= 1,
  'a push notification HTTP request is queued via pg_net'
);

select * from finish();
rollback;
