-- supabase/tests/007_match_messages.test.sql
begin;
select plan(5);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','creator@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','approved@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333','pending@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('33333333-3333-3333-3333-333333333333','+390000000003','Gino','Verdi','1992-01-01',170,'both','player');

insert into auth.users (id, email) values ('44444444-4444-4444-4444-444444444444','other-approved@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('44444444-4444-4444-4444-444444444444','+390000000004','Anna','Neri','1993-01-01',165,'right','player');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('55555555-5555-5555-5555-555555555555','11111111-1111-1111-1111-111111111111',5,'Campo Palermo','Via Roma 1',38.1157,13.3615,'2026-09-05','20:00','21:30',10);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
insert into public.match_participants (id, match_id, user_id, status)
values ('66666666-6666-6666-6666-666666666666','55555555-5555-5555-5555-555555555555','22222222-2222-2222-2222-222222222222','requested');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'approved' where id = '66666666-6666-6666-6666-666666666666';

select tests.authenticate_as('44444444-4444-4444-4444-444444444444');
insert into public.match_participants (id, match_id, user_id, status)
values ('88888888-8888-8888-8888-888888888888','55555555-5555-5555-5555-555555555555','44444444-4444-4444-4444-444444444444','requested');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'approved' where id = '88888888-8888-8888-8888-888888888888';

select tests.authenticate_as('33333333-3333-3333-3333-333333333333');
insert into public.match_participants (id, match_id, user_id, status)
values ('77777777-7777-7777-7777-777777777777','55555555-5555-5555-5555-555555555555','33333333-3333-3333-3333-333333333333','requested');

select throws_ok(
  $$ insert into public.match_messages (match_id, sender_id, body) values ('55555555-5555-5555-5555-555555555555','33333333-3333-3333-3333-333333333333','Ciao a tutti') $$,
  null,
  'a user with a pending (not approved) request cannot post in the room chat'
);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
insert into public.match_messages (id, match_id, sender_id, body)
values ('99999999-9999-9999-9999-999999999999','55555555-5555-5555-5555-555555555555','22222222-2222-2222-2222-222222222222','Ciao a tutti');

select is(
  (select count(*)::int from public.match_messages where match_id = '55555555-5555-5555-5555-555555555555'),
  1,
  'an approved participant can post in the room chat'
);

select tests.authenticate_as('33333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.match_messages where match_id = '55555555-5555-5555-5555-555555555555'),
  0,
  'a user with a pending request cannot read the room chat'
);

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.match_messages where match_id = '55555555-5555-5555-5555-555555555555'),
  1,
  'the creator can read the room chat even without an approved participant row for their own match'
);

insert into public.match_messages (match_id, sender_id, body)
values ('55555555-5555-5555-5555-555555555555','11111111-1111-1111-1111-111111111111','Ciao, sono il creatore');

select is(
  (select count(*)::int from public.match_messages where match_id = '55555555-5555-5555-5555-555555555555' and sender_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'the creator can also post in the room chat even without an approved participant row for their own match'
);

select * from finish();
rollback;
