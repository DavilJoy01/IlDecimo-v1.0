-- supabase/tests/023_get_user_profile_and_history.test.sql
begin;
select plan(18);

-- TARGET: the person whose profile/history we look at.
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','target@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

-- VIEWER: calls the RPCs.
insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','viewer@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

-- BLOCKER: used for the block tests.
insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333','blocker@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('33333333-3333-3333-3333-333333333333','+390000000003','Gino','Verdi','1992-01-01',170,'both','player');

-- CREATOR: creates the matches TARGET participates in (never TARGET itself,
-- since a match's creator never has their own match_participants row).
insert into auth.users (id, email) values ('44444444-4444-4444-4444-444444444444','creator@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('44444444-4444-4444-4444-444444444444','+390000000004','Sara','Neri','1993-01-01',165,'right','player');

-- m1: TARGET created it, completed -- should appear, role=creator.
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',5,'Campo A','Via A 1',38.11,13.36,'2026-01-10','10:00','11:00',10);
update public.matches set status = 'completed' where id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- m2: TARGET created it, cancelled -- must be excluded entirely.
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',5,'Campo B','Via B 1',38.11,13.36,'2026-01-11','10:00','11:00',10);
update public.matches set status = 'cancelled' where id = 'aaaaaaaa-0000-0000-0000-000000000002';

-- m3: CREATOR's match, TARGET participated and completed it -- should appear.
select tests.authenticate_as('44444444-4444-4444-4444-444444444444');
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('aaaaaaaa-0000-0000-0000-000000000003','44444444-4444-4444-4444-444444444444',5,'Campo C','Via C 1',38.11,13.36,'2026-01-05','10:00','11:00',10);
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.match_participants (id, match_id, user_id, status)
values ('bbbbbbbb-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','requested');
select tests.authenticate_as('44444444-4444-4444-4444-444444444444');
update public.match_participants set status = 'approved' where id = 'bbbbbbbb-0000-0000-0000-000000000003';
update public.match_participants set status = 'completed' where id = 'bbbbbbbb-0000-0000-0000-000000000003';
update public.matches set status = 'completed' where id = 'aaaaaaaa-0000-0000-0000-000000000003';

-- m4: CREATOR's match, TARGET left before completion -- should appear.
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('aaaaaaaa-0000-0000-0000-000000000004','44444444-4444-4444-4444-444444444444',5,'Campo D','Via D 1',38.11,13.36,'2026-01-01','10:00','11:00',10);
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.match_participants (id, match_id, user_id, status)
values ('bbbbbbbb-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','requested');
select tests.authenticate_as('44444444-4444-4444-4444-444444444444');
update public.match_participants set status = 'approved' where id = 'bbbbbbbb-0000-0000-0000-000000000004';
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'left' where id = 'bbbbbbbb-0000-0000-0000-000000000004';
select tests.authenticate_as('44444444-4444-4444-4444-444444444444');
update public.matches set status = 'completed' where id = 'aaaaaaaa-0000-0000-0000-000000000004';

-- m5: CREATOR's match, TARGET only requested (never approved) -- excluded.
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('aaaaaaaa-0000-0000-0000-000000000005','44444444-4444-4444-4444-444444444444',5,'Campo E','Via E 1',38.11,13.36,'2026-01-06','10:00','11:00',10);
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.match_participants (id, match_id, user_id, status)
values ('bbbbbbbb-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111','requested');
select tests.authenticate_as('44444444-4444-4444-4444-444444444444');
update public.matches set status = 'completed' where id = 'aaaaaaaa-0000-0000-0000-000000000005';

-- m6: CREATOR's match, TARGET is 'active' but the match itself never
-- completed (still 'open') -- excluded (outcome not in completed/left AND
-- match not completed either -- covers the filter from both sides).
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('aaaaaaaa-0000-0000-0000-000000000006','44444444-4444-4444-4444-444444444444',5,'Campo F','Via F 1',38.11,13.36,'2026-01-07','10:00','11:00',10);
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.match_participants (id, match_id, user_id, status)
values ('bbbbbbbb-0000-0000-0000-000000000006','aaaaaaaa-0000-0000-0000-000000000006','11111111-1111-1111-1111-111111111111','requested');
select tests.authenticate_as('44444444-4444-4444-4444-444444444444');
update public.match_participants set status = 'approved' where id = 'bbbbbbbb-0000-0000-0000-000000000006';
update public.match_participants set status = 'active' where id = 'bbbbbbbb-0000-0000-0000-000000000006';

-- m7: TARGET creates their own match AND also holds a match_participants row
-- for it (nothing in the schema/RLS prevents a creator from self-joining --
-- only a client-side UI convention hides the join button from creators).
-- Must appear exactly once, as role=creator, never duplicated as
-- role=participant too (the union's participant branch explicitly excludes
-- m.creator_id = target_id for this reason). Dated before m4 (the oldest of
-- m1/m3/m4) so it lands after both already-tested pagination pages and
-- doesn't shift their expected contents.
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('aaaaaaaa-0000-0000-0000-000000000007','11111111-1111-1111-1111-111111111111',5,'Campo G','Via G 1',38.11,13.36,'2025-12-20','10:00','11:00',10);
insert into public.match_participants (id, match_id, user_id, status)
values ('bbbbbbbb-0000-0000-0000-000000000007','aaaaaaaa-0000-0000-0000-000000000007','11111111-1111-1111-1111-111111111111','requested');
update public.match_participants set status = 'approved' where id = 'bbbbbbbb-0000-0000-0000-000000000007';
update public.match_participants set status = 'completed' where id = 'bbbbbbbb-0000-0000-0000-000000000007';
update public.matches set status = 'completed' where id = 'aaaaaaaa-0000-0000-0000-000000000007';

-- All read calls below are made as VIEWER (auth.uid() must not be TARGET,
-- to also implicitly confirm the RPCs work for a third party, not just self).
select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select is(
  (select id from public.get_user_profile('11111111-1111-1111-1111-111111111111')),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'get_user_profile returns the target row when there is no block'
);

select is(
  (select count(*)::int from public.get_user_match_history('11111111-1111-1111-1111-111111111111', null, null, null, 20)),
  4,
  'get_user_match_history returns exactly the 4 valid history entries (m1, m3, m4, m7), excluding m2/m5/m6'
);

select is(
  (select count(*)::int from public.get_user_match_history('11111111-1111-1111-1111-111111111111', null, null, null, 20) where match_id = 'aaaaaaaa-0000-0000-0000-000000000007'),
  1,
  'm7 (creator who also self-joined as participant) appears exactly once, not duplicated'
);
select is(
  (select role from public.get_user_match_history('11111111-1111-1111-1111-111111111111', null, null, null, 20) where match_id = 'aaaaaaaa-0000-0000-0000-000000000007'),
  'creator',
  'm7''s single appearance is role=creator, not participant'
);

select is(
  (select role from public.get_user_match_history('11111111-1111-1111-1111-111111111111', null, null, null, 20) where match_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'creator',
  'm1 (created and completed) has role=creator'
);
select is(
  (select outcome from public.get_user_match_history('11111111-1111-1111-1111-111111111111', null, null, null, 20) where match_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'completed',
  'm1 (created and completed) has outcome=completed'
);

select is(
  (select role from public.get_user_match_history('11111111-1111-1111-1111-111111111111', null, null, null, 20) where match_id = 'aaaaaaaa-0000-0000-0000-000000000003'),
  'participant',
  'm3 (participated, completed) has role=participant'
);
select is(
  (select outcome from public.get_user_match_history('11111111-1111-1111-1111-111111111111', null, null, null, 20) where match_id = 'aaaaaaaa-0000-0000-0000-000000000003'),
  'completed',
  'm3 (participated, completed) has outcome=completed'
);

select is(
  (select role from public.get_user_match_history('11111111-1111-1111-1111-111111111111', null, null, null, 20) where match_id = 'aaaaaaaa-0000-0000-0000-000000000004'),
  'participant',
  'm4 (participated, left) has role=participant'
);
select is(
  (select outcome from public.get_user_match_history('11111111-1111-1111-1111-111111111111', null, null, null, 20) where match_id = 'aaaaaaaa-0000-0000-0000-000000000004'),
  'left',
  'm4 (participated, left) has outcome=left'
);

select is(
  (select count(*)::int from public.get_user_match_history('11111111-1111-1111-1111-111111111111', null, null, null, 20) where match_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  0,
  'm2 (created but cancelled) never appears'
);

select is(
  (select count(*)::int from public.get_user_match_history('11111111-1111-1111-1111-111111111111', null, null, null, 20) where match_id = 'aaaaaaaa-0000-0000-0000-000000000005'),
  0,
  'm5 (only requested, never approved) never appears'
);

select is(
  (select count(*)::int from public.get_user_match_history('11111111-1111-1111-1111-111111111111', null, null, null, 20) where match_id = 'aaaaaaaa-0000-0000-0000-000000000006'),
  0,
  'm6 (active in a match that never completed) never appears'
);

-- Pagination: page_size=2, ordered by match_date desc -- expect m1 (01-10)
-- then m3 (01-05) on the first page.
select is(
  (select array_agg(match_id order by match_date desc) from (select * from public.get_user_match_history('11111111-1111-1111-1111-111111111111', null, null, null, 2)) t),
  array['aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'aaaaaaaa-0000-0000-0000-000000000003'::uuid],
  'first page (page_size=2) returns m1 then m3, most recent first'
);

-- Second page, cursored on m3's own (match_date, start_time, match_id) --
-- expect m4 (01-01) then m7 (2025-12-20), the two remaining entries in
-- order, no repeats/gaps. (m7 was deliberately dated before m4 so the
-- first-page assertion above stays m1/m3 unaffected.)
select is(
  (select array_agg(match_id) from (select * from public.get_user_match_history('11111111-1111-1111-1111-111111111111', '2026-01-05'::date, '10:00'::time, 'aaaaaaaa-0000-0000-0000-000000000003'::uuid, 2)) t),
  array['aaaaaaaa-0000-0000-0000-000000000004'::uuid, 'aaaaaaaa-0000-0000-0000-000000000007'::uuid],
  'second page (cursored after m3) returns m4 then m7, no duplicates or gaps'
);

-- Block tests: TARGET blocks BLOCKER. Confirms both directions and both RPCs.
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.user_blocks (blocker_id, blocked_id) values ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333');

select tests.authenticate_as('33333333-3333-3333-3333-333333333333');
select is(
  (select count(*)::int from public.get_user_profile('11111111-1111-1111-1111-111111111111')),
  0,
  'get_user_profile returns nothing when the caller was blocked by the target'
);

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
select is(
  (select count(*)::int from public.get_user_profile('33333333-3333-3333-3333-333333333333')),
  0,
  'get_user_profile returns nothing in the reverse direction (calling on someone you blocked)'
);

select tests.authenticate_as('33333333-3333-3333-3333-333333333333');
select is(
  (select count(*)::int from public.get_user_match_history('11111111-1111-1111-1111-111111111111', null, null, null, 20)),
  0,
  'get_user_match_history returns nothing when blocked'
);

select * from finish();
rollback;
