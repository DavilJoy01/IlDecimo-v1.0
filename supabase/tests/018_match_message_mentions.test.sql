-- supabase/tests/018_match_message_mentions.test.sql
begin;
select plan(5);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','creator@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','approved@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333','stranger@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('33333333-3333-3333-3333-333333333333','+390000000003','Gino','Verdi','1992-01-01',170,'both','player');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('55555555-5555-5555-5555-555555555555','11111111-1111-1111-1111-111111111111',5,'Campo Palermo','Via Roma 1',38.1157,13.3615,'2026-09-05','20:00','21:30',10);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
insert into public.match_participants (id, match_id, user_id, status)
values ('66666666-6666-6666-6666-666666666666','55555555-5555-5555-5555-555555555555','22222222-2222-2222-2222-222222222222','requested');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'approved' where id = '66666666-6666-6666-6666-666666666666';

insert into public.match_messages (id, match_id, sender_id, body)
values ('99999999-9999-9999-9999-999999999999','55555555-5555-5555-5555-555555555555','11111111-1111-1111-1111-111111111111','Ciao Luca');

insert into public.match_message_mentions (message_id, mentioned_user_id)
values ('99999999-9999-9999-9999-999999999999','22222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.match_message_mentions where message_id = '99999999-9999-9999-9999-999999999999'),
  1,
  'the creator can mention an approved participant in their own message'
);

select throws_ok(
  $$ insert into public.match_message_mentions (message_id, mentioned_user_id)
     values ('99999999-9999-9999-9999-999999999999','33333333-3333-3333-3333-333333333333') $$,
  'cannot mention a user who is not the creator or an approved/active/completed participant of this match',
  'mentioning a user who is not the creator or an approved/active/completed participant is rejected'
);

-- transition_match_statuses() (the periodic cron) flips every
-- approved/active participant to completed shortly after a match ends --
-- 'completed' is the steady state of any past match's chat, not a rare edge
-- case, so mentioning a completed participant must keep working. Use a FRESH
-- message + mention insert (not the pre-existing row from above) so this
-- actually exercises the trigger against Luca's new status, rather than
-- reading a row the trigger validated back when Luca was still 'approved'.
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'completed' where id = '66666666-6666-6666-6666-666666666666';

insert into public.match_messages (id, match_id, sender_id, body)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','55555555-5555-5555-5555-555555555555','11111111-1111-1111-1111-111111111111','Grazie per oggi Luca');

insert into public.match_message_mentions (message_id, mentioned_user_id)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','22222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.match_message_mentions where message_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  1,
  'a completed participant can still be mentioned'
);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
insert into public.match_messages (id, match_id, sender_id, body)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','55555555-5555-5555-5555-555555555555','22222222-2222-2222-2222-222222222222','Ciao Mario');

select throws_ok(
  $$ insert into public.match_message_mentions (message_id, mentioned_user_id)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222') $$,
  null,
  'a user cannot mention themselves'
);

select throws_ok(
  $$ insert into public.match_message_mentions (message_id, mentioned_user_id)
     values ('99999999-9999-9999-9999-999999999999','11111111-1111-1111-1111-111111111111') $$,
  null,
  'a user cannot insert a mention row for a message they did not send'
);

select * from finish();
rollback;
