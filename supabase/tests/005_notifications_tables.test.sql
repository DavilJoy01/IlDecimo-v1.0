-- supabase/tests/005_notifications_tables.test.sql
begin;
select plan(6);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','mario@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','luca@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

insert into public.notifications (user_id, type, payload)
values ('11111111-1111-1111-1111-111111111111', 'match_reminder', '{"message":"ciao"}'::jsonb);

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.notifications),
  1,
  'the owner can see their own notification'
);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.notifications),
  0,
  'another user cannot see someone else''s notification'
);

select throws_ok(
  $$ insert into public.notifications (user_id, type, payload) values ('22222222-2222-2222-2222-222222222222', 'match_reminder', '{}'::jsonb) $$,
  null,
  'a regular authenticated user cannot insert notifications directly'
);

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.notifications set read_at = now() where user_id = '11111111-1111-1111-1111-111111111111';

select isnt(
  (select read_at from public.notifications where user_id = '11111111-1111-1111-1111-111111111111'),
  null,
  'a user can mark their own notification as read'
);

insert into public.user_push_tokens (user_id, push_token) values ('11111111-1111-1111-1111-111111111111', 'ExponentPushToken[abc]');

select is(
  (select count(*)::int from public.user_push_tokens where user_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'a user can register their own push token'
);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.user_push_tokens),
  0,
  'another user cannot see someone else''s push tokens'
);

select * from finish();
rollback;
