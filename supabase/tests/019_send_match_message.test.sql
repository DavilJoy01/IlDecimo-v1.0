-- supabase/tests/019_send_match_message.test.sql
begin;
select plan(6);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','creator@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','approved-a@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333','approved-b@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('33333333-3333-3333-3333-333333333333','+390000000003','Gino','Verdi','1992-01-01',170,'both','player');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('55555555-5555-5555-5555-555555555555','11111111-1111-1111-1111-111111111111',5,'Campo Palermo','Via Roma 1',38.1157,13.3615,'2026-09-05','20:00','21:30',10);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
insert into public.match_participants (id, match_id, user_id, status)
values ('aaaaaaaa-1111-1111-1111-111111111111','55555555-5555-5555-5555-555555555555','22222222-2222-2222-2222-222222222222','requested');

select tests.authenticate_as('33333333-3333-3333-3333-333333333333');
insert into public.match_participants (id, match_id, user_id, status)
values ('bbbbbbbb-2222-2222-2222-222222222222','55555555-5555-5555-5555-555555555555','33333333-3333-3333-3333-333333333333','requested');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'approved' where match_id = '55555555-5555-5555-5555-555555555555';

-- Creator sends a plain message (no mentions) -- both approved participants
-- should get the generic notification.
select send_match_message('55555555-5555-5555-5555-555555555555', 'Ciao a tutti', '{}');

select is(
  (select count(*)::int from public.match_messages where match_id = '55555555-5555-5555-5555-555555555555'),
  1,
  'send_match_message inserts the message row'
);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
select is(
  (select type from public.notifications where user_id = '22222222-2222-2222-2222-222222222222' order by created_at desc limit 1),
  'match_message',
  'a non-mentioned approved participant gets the generic match_message notification'
);

-- Now the creator sends a message mentioning only Luca.
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
select send_match_message('55555555-5555-5555-5555-555555555555', 'Ciao @Luca', array['22222222-2222-2222-2222-222222222222']::uuid[]);

select is(
  (select count(*)::int from public.match_message_mentions mm join public.match_messages m on m.id = mm.message_id where m.body = 'Ciao @Luca'),
  1,
  'send_match_message records the mention row'
);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
select is(
  (select type from public.notifications where user_id = '22222222-2222-2222-2222-222222222222' order by created_at desc limit 1),
  'match_message_mention',
  'the mentioned participant gets the dedicated match_message_mention notification'
);

select tests.authenticate_as('33333333-3333-3333-3333-333333333333');
select is(
  (select type from public.notifications where user_id = '33333333-3333-3333-3333-333333333333' order by created_at desc limit 1),
  'match_message',
  'a participant who was not mentioned still gets the generic notification for the same message'
);

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
select throws_ok(
  $$ select send_match_message('55555555-5555-5555-5555-555555555555', 'bad mention', array['99999999-9999-9999-9999-999999999999']::uuid[]) $$,
  'cannot mention a user who is not the creator or an approved/active participant of this match',
  'sending a message with an invalid mention rolls back the whole send'
);

select * from finish();
rollback;
