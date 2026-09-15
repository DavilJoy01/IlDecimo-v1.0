-- supabase/tests/027_restrict_probe_helpers_to_self.test.sql
--
-- 20260916000000_restrict_probe_helpers_to_self.sql closes an information
-- disclosure gap left open by 20260830101700_final_review_hardening.sql's
-- own fix: that migration revoked EXECUTE on users_have_mutual_block from
-- anon, but left `authenticated` able to call it (and is_fellow_participant)
-- with two arbitrary IDs that have nothing to do with the caller, learning
-- real block/participation facts RLS exists specifically to hide from
-- everyone except the parties involved. See 017_final_review_hardening's
-- existing anon-side assertion for the half of this already covered.
begin;
select plan(6);

-- Two users with a real, one-directional block between them.
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','mario@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','luca@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

-- A third, unrelated user -- the one who will attempt to probe Mario/Luca.
insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333','anna@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('33333333-3333-3333-3333-333333333333','+390000000003','Anna','Verdi','1992-01-01',168,'right','player');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.user_blocks (blocker_id, blocked_id) values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');

-- A real match Mario created, with Luca as an approved participant.
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('55555555-5555-5555-5555-555555555555','11111111-1111-1111-1111-111111111111',5,'Campo Test','Via Test 1',38.1157,13.3615,'2026-09-20','20:00','21:30',10);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
insert into public.match_participants (match_id, user_id, status) values ('55555555-5555-5555-5555-555555555555','22222222-2222-2222-2222-222222222222','requested');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'approved' where match_id = '55555555-5555-5555-5555-555555555555' and user_id = '22222222-2222-2222-2222-222222222222';

-- Anna -- who is neither party to the block nor anything to do with this
-- match -- tries to probe both facts about Mario and Luca directly.
select tests.authenticate_as('33333333-3333-3333-3333-333333333333');

select is(
  users_have_mutual_block('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222'),
  false,
  'an unrelated authenticated caller cannot learn that two other users have blocked each other, even though a real block exists'
);

select is(
  is_fellow_participant('55555555-5555-5555-5555-555555555555','22222222-2222-2222-2222-222222222222'),
  false,
  'an unrelated authenticated caller cannot learn that an arbitrary user participates in an arbitrary match, even though it is true'
);

-- Sanity check: the exact same facts, asked by someone actually entitled to
-- know them, still come back correct -- this migration must not just make
-- both helpers always return false.
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');

select is(
  users_have_mutual_block('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222'),
  true,
  'the blocker themselves still correctly learns the block exists'
);

-- The match's creator (Mario) never holds a match_participants row for
-- their own match (a pre-existing, already-documented property of this
-- schema -- creator access is checked separately, not via participation),
-- so the realistic self-check here is Luca -- an actual approved
-- participant -- confirming his own status, matching exactly how
-- participants_select_relevant calls this helper (with auth.uid() as the
-- second argument, for the querying user themselves).
select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select is(
  is_fellow_participant('55555555-5555-5555-5555-555555555555','22222222-2222-2222-2222-222222222222'),
  true,
  'an approved participant still correctly learns their own fellow-participant status'
);

-- And the RLS policies that depend on these helpers still work end to end,
-- not just the helper functions in isolation.
select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select is(
  (select status from public.match_participants where match_id = '55555555-5555-5555-5555-555555555555' and user_id = '22222222-2222-2222-2222-222222222222'),
  'approved',
  'the approved participant can still see their own row via RLS'
);

select throws_ok(
  $$ insert into public.friendships (requester_id, receiver_id) values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111') $$,
  null,
  'the block still correctly blocks a friend request through the RLS policy that calls users_have_mutual_block'
);

select * from finish();
rollback;
