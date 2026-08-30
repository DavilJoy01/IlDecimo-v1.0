begin;
select plan(8);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','creator@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','player@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333','intruder@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('33333333-3333-3333-3333-333333333333','+390000000003','Gino','Verdi','1992-01-01',170,'both','player');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111',5,'Campo Palermo','Via Roma 1',38.1157,13.3615,'2026-09-05','20:00','21:30',10);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select throws_ok(
  $$ insert into public.match_participants (match_id, user_id, status) values ('44444444-4444-4444-4444-444444444444','22222222-2222-2222-2222-222222222222','approved') $$,
  'a new participation must start as requested',
  'a participant cannot self-insert as approved'
);

select throws_ok(
  $$ insert into public.match_participants (match_id, user_id, status) values ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111','requested') $$,
  'a user can only request participation for themselves',
  'a user cannot request participation on behalf of someone else'
);

insert into public.match_participants (id, match_id, user_id, status)
values ('55555555-5555-5555-5555-555555555555','44444444-4444-4444-4444-444444444444','22222222-2222-2222-2222-222222222222','requested');

select throws_ok(
  $$ update public.match_participants set status = 'approved' where id = '55555555-5555-5555-5555-555555555555' $$,
  'only the match creator can approve or reject a request',
  'a participant cannot self-approve'
);

select tests.authenticate_as('33333333-3333-3333-3333-333333333333');
update public.match_participants set status = 'approved' where id = '55555555-5555-5555-5555-555555555555';

select is(
  (select status from public.match_participants where id = '55555555-5555-5555-5555-555555555555'),
  'requested',
  'a random user cannot modify a participation row they are not party to; RLS silently blocks it'
);

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'approved' where id = '55555555-5555-5555-5555-555555555555';

select is(
  (select status from public.match_participants where id = '55555555-5555-5555-5555-555555555555'),
  'approved',
  'the match creator can approve a participation request'
);

update public.match_participants set status = 'active' where id = '55555555-5555-5555-5555-555555555555';

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
update public.match_participants set status = 'left' where id = '55555555-5555-5555-5555-555555555555';

select is(
  (select leave_count from public.match_participants where id = '55555555-5555-5555-5555-555555555555'),
  1,
  'leaving increments leave_count to 1'
);

update public.match_participants set status = 'requested' where id = '55555555-5555-5555-5555-555555555555';

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'approved' where id = '55555555-5555-5555-5555-555555555555';
update public.match_participants set status = 'active' where id = '55555555-5555-5555-5555-555555555555';

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
update public.match_participants set status = 'left' where id = '55555555-5555-5555-5555-555555555555';

select is(
  (select leave_count from public.match_participants where id = '55555555-5555-5555-5555-555555555555'),
  2,
  'leaving a second time increments leave_count to 2'
);

select throws_ok(
  $$ update public.match_participants set status = 'requested' where id = '55555555-5555-5555-5555-555555555555' $$,
  'maximum number of re-entries (2) reached for this match',
  'a third re-entry attempt is rejected after 2 leaves'
);

select * from finish();
rollback;
