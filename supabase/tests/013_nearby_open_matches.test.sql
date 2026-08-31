-- supabase/tests/013_nearby_open_matches.test.sql
begin;
select plan(5);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','creator@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','player@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');

-- Palermo city center
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players, status)
values ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111',5,'Campo Vicino','Via Roma 1',38.1157,13.3615,'2026-09-05','20:00','21:30',10,'open');

-- Roughly 200km away (Naples)
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players, status)
values ('66666666-6666-6666-6666-666666666666','11111111-1111-1111-1111-111111111111',5,'Campo Lontano','Via Napoli 1',40.8518,14.2681,'2026-09-05','20:00','21:30',10,'open');

-- a draft match near Palermo should never show up regardless of radius
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players, status)
values ('77777777-7777-7777-7777-777777777777','11111111-1111-1111-1111-111111111111',5,'Campo Bozza','Via Bozza 1',38.1157,13.3615,'2026-09-05','20:00','21:30',10,'draft');

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
insert into public.match_participants (id, match_id, user_id, status)
values ('88888888-8888-8888-8888-888888888888','44444444-4444-4444-4444-444444444444','22222222-2222-2222-2222-222222222222','requested');

select is(
  (select count(*)::int from public.nearby_open_matches(38.1157, 13.3615, 20)),
  1,
  'searching with a 20km radius returns only the nearby open match'
);

select is(
  (select field_name from public.nearby_open_matches(38.1157, 13.3615, 20) limit 1),
  'Campo Vicino',
  'the nearby match is correctly identified'
);

select is(
  (select approved_players_count from public.nearby_open_matches(38.1157, 13.3615, 20) limit 1),
  0::bigint,
  'a merely requested (not yet approved) participant does not count toward approved_players_count'
);

select is(
  (select count(*)::int from public.nearby_open_matches(38.1157, 13.3615, 500)),
  2,
  'widening the radius to 500km also returns the far-away match, but never the draft one'
);

set local role anon;
select throws_ok(
  $$ select * from public.nearby_open_matches(38.1157, 13.3615, 20) $$,
  'permission denied for function nearby_open_matches',
  'an unauthenticated (anon) caller can no longer execute nearby_open_matches'
);
reset role;

select * from finish();
rollback;
