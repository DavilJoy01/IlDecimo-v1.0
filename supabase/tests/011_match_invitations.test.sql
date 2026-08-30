-- supabase/tests/011_match_invitations.test.sql
begin;
select plan(7);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','mario@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','luca@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111',5,'Campo Palermo','Via Roma 1',38.1157,13.3615,'2026-09-05','20:00','21:30',10);

select throws_ok(
  $$ insert into public.match_invitations (match_id, inviter_id, invitee_id) values ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111') $$,
  null,
  'a user cannot invite themselves'
);

insert into public.match_invitations (id, match_id, inviter_id, invitee_id)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select is(
  (select type from public.notifications where user_id = '22222222-2222-2222-2222-222222222222' order by created_at desc limit 1),
  'match_invitation',
  'the invitee is notified of the invitation'
);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
update public.match_invitations set status = 'viewed' where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select is(
  (select status from public.match_invitations where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'viewed',
  'the invitee can mark the invitation as viewed'
);

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('55555555-5555-5555-5555-555555555555','11111111-1111-1111-1111-111111111111',5,'Campo Mondello','Via Mare 2',38.0896,13.3854,'2026-09-06','19:00','20:30',12);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select throws_ok(
  $$ update public.match_invitations set match_id = '55555555-5555-5555-5555-555555555555' where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $$,
  'match_id cannot be changed',
  'an invitee cannot change the match_id of an invitation'
);

select throws_ok(
  $$ update public.match_invitations set inviter_id = '22222222-2222-2222-2222-222222222222' where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $$,
  'inviter_id cannot be changed',
  'an invitee cannot change the inviter_id of an invitation'
);

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');

select throws_ok(
  $$ insert into public.match_invitations (match_id, inviter_id, invitee_id) values ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222') $$,
  null,
  'a duplicate invitation for the same match/invitee pair fails (same inviter, same invitee, so RLS allows the attempt and the unique index rejects it)'
);

select is(
  (select count(*)::int from public.match_participants where match_id = '44444444-4444-4444-4444-444444444444'),
  0,
  'an invitation never inserts a match_participants row on its own -- approval is still required separately'
);

select * from finish();
rollback;
