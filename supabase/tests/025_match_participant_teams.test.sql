-- supabase/tests/025_match_participant_teams.test.sql
begin;
select plan(17);

-- CREATOR: creates both matches used below.
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','creator@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Creator','Test','1990-01-01',180,'right','player');

-- OUTSIDER: not the creator, used for the "not the creator" negative tests.
insert into auth.users (id, email) values ('99999999-9999-9999-9999-999999999999','outsider@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('99999999-9999-9999-9999-999999999999','+390000000099','Outsider','Test','1990-01-01',180,'right','player');

-- P1..P6, P7, Q1..Q8: all auth.users/public.users rows are created up front,
-- before any tests.authenticate_as() call. authenticate_as() switches the
-- session role to 'authenticated' for the rest of the transaction (it uses
-- set_config(..., true), which is transaction-local and never reverts), and
-- 'authenticated' lacks INSERT on auth.users -- so every user row must exist
-- before the first authenticate_as() call below.
insert into auth.users (id, email) values
  ('20000000-0000-0000-0000-000000000001','p1@example.com'),
  ('20000000-0000-0000-0000-000000000002','p2@example.com'),
  ('20000000-0000-0000-0000-000000000003','p3@example.com'),
  ('20000000-0000-0000-0000-000000000004','p4@example.com'),
  ('20000000-0000-0000-0000-000000000005','p5@example.com'),
  ('20000000-0000-0000-0000-000000000006','p6@example.com'),
  ('20000000-0000-0000-0000-000000000007','p7@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role) values
  ('20000000-0000-0000-0000-000000000001','+390000001001','P','One','1990-01-01',175,'right','player'),
  ('20000000-0000-0000-0000-000000000002','+390000001002','P','Two','1990-01-01',175,'right','player'),
  ('20000000-0000-0000-0000-000000000003','+390000001003','P','Three','1990-01-01',175,'right','player'),
  ('20000000-0000-0000-0000-000000000004','+390000001004','P','Four','1990-01-01',175,'right','player'),
  ('20000000-0000-0000-0000-000000000005','+390000001005','P','Five','1990-01-01',175,'right','player'),
  ('20000000-0000-0000-0000-000000000006','+390000001006','P','Six','1990-01-01',175,'right','player'),
  ('20000000-0000-0000-0000-000000000007','+390000001007','P','Seven','1990-01-01',175,'right','player');

insert into auth.users (id, email) values
  ('40000000-0000-0000-0000-000000000001','q1@example.com'),
  ('40000000-0000-0000-0000-000000000002','q2@example.com'),
  ('40000000-0000-0000-0000-000000000003','q3@example.com'),
  ('40000000-0000-0000-0000-000000000004','q4@example.com'),
  ('40000000-0000-0000-0000-000000000005','q5@example.com'),
  ('40000000-0000-0000-0000-000000000006','q6@example.com'),
  ('40000000-0000-0000-0000-000000000007','q7@example.com'),
  ('40000000-0000-0000-0000-000000000008','q8@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role) values
  ('40000000-0000-0000-0000-000000000001','+390000002001','Q','One','1990-01-01',175,'right','player'),
  ('40000000-0000-0000-0000-000000000002','+390000002002','Q','Two','1990-01-01',175,'right','player'),
  ('40000000-0000-0000-0000-000000000003','+390000002003','Q','Three','1990-01-01',175,'right','player'),
  ('40000000-0000-0000-0000-000000000004','+390000002004','Q','Four','1990-01-01',175,'right','player'),
  ('40000000-0000-0000-0000-000000000005','+390000002005','Q','Five','1990-01-01',175,'right','player'),
  ('40000000-0000-0000-0000-000000000006','+390000002006','Q','Six','1990-01-01',175,'right','player'),
  ('40000000-0000-0000-0000-000000000007','+390000002007','Q','Seven','1990-01-01',175,'right','player'),
  ('40000000-0000-0000-0000-000000000008','+390000002008','Q','Eight','1990-01-01',175,'right','player');

-- Match M: match_type=5, 6 approved participants (P1..P6) -- enough to fill
-- team A (5) and prove the 6th is rejected there, but succeeds on team B.
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',5,'Campo M','Via M 1',38.11,13.36,'2026-02-01','10:00','11:00',12);

-- Insert each as 'requested' (as themselves), then approve as CREATOR.
select tests.authenticate_as('20000000-0000-0000-0000-000000000001');
insert into public.match_participants (id, match_id, user_id, status) values ('30000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','requested');
select tests.authenticate_as('20000000-0000-0000-0000-000000000002');
insert into public.match_participants (id, match_id, user_id, status) values ('30000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','requested');
select tests.authenticate_as('20000000-0000-0000-0000-000000000003');
insert into public.match_participants (id, match_id, user_id, status) values ('30000000-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','requested');
select tests.authenticate_as('20000000-0000-0000-0000-000000000004');
insert into public.match_participants (id, match_id, user_id, status) values ('30000000-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','requested');
select tests.authenticate_as('20000000-0000-0000-0000-000000000005');
insert into public.match_participants (id, match_id, user_id, status) values ('30000000-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000005','requested');
select tests.authenticate_as('20000000-0000-0000-0000-000000000006');
insert into public.match_participants (id, match_id, user_id, status) values ('30000000-0000-0000-0000-000000000006','aaaaaaaa-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000006','requested');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'approved' where match_id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- 1. Creator can assign an approved participant to team A.
update public.match_participants set team = 'A' where id = '30000000-0000-0000-0000-000000000001';
select is(
  (select team from public.match_participants where id = '30000000-0000-0000-0000-000000000001'),
  'A',
  'creator can assign an approved participant to team A'
);

-- 2. Fails if the caller is not the creator. The update policy's USING
-- clause only lets the participant themselves or the match creator match a
-- row at all, so an outsider's UPDATE matches zero rows via RLS and the
-- trigger's own creator check never runs -- same silent-block pattern as
-- 003_match_participants.test.sql's "a random user cannot modify a
-- participation row they are not party to" assertion.
select tests.authenticate_as('99999999-9999-9999-9999-999999999999');
update public.match_participants set team = 'B' where id = '30000000-0000-0000-0000-000000000002';
-- Re-authenticate as the creator before verifying: the outsider has zero RLS
-- visibility into this row (participants_select_relevant only allows the
-- creator or the participant themselves), so checking with is() while still
-- authenticated as the outsider would always read NULL regardless of the
-- row's actual team value, making the assertion a false positive.
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
select is(
  (select team from public.match_participants where id = '30000000-0000-0000-0000-000000000002'),
  null,
  'a non-creator cannot assign a team; RLS silently blocks the update before the trigger runs'
);

-- 3. Fails if the participant is not approved/active (still requested).
select tests.authenticate_as('20000000-0000-0000-0000-000000000007');
insert into public.match_participants (id, match_id, user_id, status) values ('30000000-0000-0000-0000-000000000007','aaaaaaaa-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000007','requested');
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
select throws_ok(
  $$update public.match_participants set team = 'A' where id = '30000000-0000-0000-0000-000000000007'$$,
  'P0001',
  'only an approved or active participant can be assigned a team',
  'cannot assign a team to a still-requested participant'
);

-- Fill team A to its match_type=5 cap: P1 is already in A, add P2..P4 (4 more, total 5).
update public.match_participants set team = 'A' where id = '30000000-0000-0000-0000-000000000002';
update public.match_participants set team = 'A' where id = '30000000-0000-0000-0000-000000000003';
update public.match_participants set team = 'A' where id = '30000000-0000-0000-0000-000000000004';
update public.match_participants set team = 'A' where id = '30000000-0000-0000-0000-000000000005';

-- 4. The 6th player fails to join team A (already full at match_type=5).
select throws_ok(
  $$update public.match_participants set team = 'A' where id = '30000000-0000-0000-0000-000000000006'$$,
  'P0001',
  'team A is already full',
  'a 6th player cannot join a full team A'
);

-- 5. The same 6th player succeeds on team B instead (per-team cap, not aggregate).
update public.match_participants set team = 'B' where id = '30000000-0000-0000-0000-000000000006';
select is(
  (select team from public.match_participants where id = '30000000-0000-0000-0000-000000000006'),
  'B',
  'the 6th player succeeds joining team B instead (cap is per-team)'
);

-- 6. team clears to null automatically when status becomes 'left'.
select tests.authenticate_as('20000000-0000-0000-0000-000000000001');
update public.match_participants set status = 'left' where id = '30000000-0000-0000-0000-000000000001';
select is(
  (select team from public.match_participants where id = '30000000-0000-0000-0000-000000000001'),
  null,
  'team clears to null automatically when a participant leaves'
);

-- 7. A team-only update (status unchanged) now works -- this is the bug this
-- plan's own trigger change fixes (the old trigger's `else` branch rejected
-- any update where status didn't change).
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set team = 'B' where id = '30000000-0000-0000-0000-000000000003';
select is(
  (select team from public.match_participants where id = '30000000-0000-0000-0000-000000000003'),
  'B',
  'a team-only update (status unchanged) succeeds'
);

-- 8. Changing status AND team in the same call silently keeps team unchanged.
-- P7 must go through a VALID transition chain first (requested -> approved ->
-- left), since 'left' is only reachable from 'approved'/'active', not directly
-- from 'requested' -- then the re-request (left -> requested) is the one
-- transition whose branch already sets `new.team := old.team` explicitly, so
-- it's the natural place to prove a simultaneous team='A' attempt is ignored.
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'approved' where id = '30000000-0000-0000-0000-000000000007';
select tests.authenticate_as('20000000-0000-0000-0000-000000000007');
update public.match_participants set status = 'left' where id = '30000000-0000-0000-0000-000000000007';
-- Re-request (left -> requested) must be done by the participant themselves;
-- attempt to also set team='A' in the same call.
update public.match_participants set status = 'requested', team = 'A' where id = '30000000-0000-0000-0000-000000000007';
select is(
  (select team from public.match_participants where id = '30000000-0000-0000-0000-000000000007'),
  null,
  'changing status and team together silently keeps team unchanged (null here, from the left transition)'
);

-- 9. Removing an existing assignment (team: 'A' -> null) works.
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set team = null where id = '30000000-0000-0000-0000-000000000004';
select is(
  (select team from public.match_participants where id = '30000000-0000-0000-0000-000000000004'),
  null,
  'creator can remove an existing team assignment'
);

-- 10. An approved participant cannot assign their own team -- RLS lets them
-- reach their own row (that's how they're allowed to leave the match), so
-- this exercises the trigger's actual creator-only check, unlike assertion 2
-- (an outsider), whose update never reaches the trigger at all via RLS.
select tests.authenticate_as('20000000-0000-0000-0000-000000000006');
select throws_ok(
  $$update public.match_participants set team = 'A' where id = '30000000-0000-0000-0000-000000000006'$$,
  'P0001',
  'only the match creator can assign a team',
  'an approved participant cannot assign their own team even though RLS lets them reach the row'
);

-- Match M2: match_type=5, 6 approved participants (Q1..Q6) + 1 requested + 1
-- rejected, used for shuffle_match_teams tests.
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',5,'Campo M2','Via M2 1',38.11,13.36,'2026-02-02','10:00','11:00',12);

select tests.authenticate_as('40000000-0000-0000-0000-000000000001');
insert into public.match_participants (id, match_id, user_id, status) values ('50000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','requested');
select tests.authenticate_as('40000000-0000-0000-0000-000000000002');
insert into public.match_participants (id, match_id, user_id, status) values ('50000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','requested');
select tests.authenticate_as('40000000-0000-0000-0000-000000000003');
insert into public.match_participants (id, match_id, user_id, status) values ('50000000-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000003','requested');
select tests.authenticate_as('40000000-0000-0000-0000-000000000004');
insert into public.match_participants (id, match_id, user_id, status) values ('50000000-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000004','requested');
select tests.authenticate_as('40000000-0000-0000-0000-000000000005');
insert into public.match_participants (id, match_id, user_id, status) values ('50000000-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000005','requested');
select tests.authenticate_as('40000000-0000-0000-0000-000000000006');
insert into public.match_participants (id, match_id, user_id, status) values ('50000000-0000-0000-0000-000000000006','aaaaaaaa-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000006','requested');
select tests.authenticate_as('40000000-0000-0000-0000-000000000007');
insert into public.match_participants (id, match_id, user_id, status) values ('50000000-0000-0000-0000-000000000007','aaaaaaaa-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000007','requested');
select tests.authenticate_as('40000000-0000-0000-0000-000000000008');
insert into public.match_participants (id, match_id, user_id, status) values ('50000000-0000-0000-0000-000000000008','aaaaaaaa-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000008','requested');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'approved' where id in (
  '50000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000003',
  '50000000-0000-0000-0000-000000000004','50000000-0000-0000-0000-000000000005','50000000-0000-0000-0000-000000000006'
);
update public.match_participants set status = 'rejected' where id = '50000000-0000-0000-0000-000000000008';
-- 50000000-...07 stays 'requested'.

-- Pre-existing manual assignment before shuffling, to prove shuffle
-- redistributes from scratch rather than respecting it.
update public.match_participants set team = 'A' where id = '50000000-0000-0000-0000-000000000001';
update public.match_participants set team = 'A' where id = '50000000-0000-0000-0000-000000000002';

-- 11. shuffle_match_teams fails if the caller is not the creator.
select tests.authenticate_as('99999999-9999-9999-9999-999999999999');
select throws_ok(
  $$select public.shuffle_match_teams('aaaaaaaa-0000-0000-0000-000000000002')$$,
  'P0001',
  'only the match creator can shuffle teams',
  'shuffle_match_teams fails when called by a non-creator'
);

-- 12. shuffle_match_teams as the real creator succeeds and respects the cap.
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
select lives_ok(
  $$select public.shuffle_match_teams('aaaaaaaa-0000-0000-0000-000000000002')$$,
  'shuffle_match_teams runs successfully for the creator'
);

select ok(
  (select count(*) from public.match_participants where match_id = 'aaaaaaaa-0000-0000-0000-000000000002' and team = 'A') <= 5,
  'after shuffling, team A never exceeds match_type (5)'
);
select ok(
  (select count(*) from public.match_participants where match_id = 'aaaaaaaa-0000-0000-0000-000000000002' and team = 'B') <= 5,
  'after shuffling, team B never exceeds match_type (5)'
);

-- 13. All 6 approved participants end up on a team (6 <= 5*2, none left over).
select is(
  (select count(*)::int from public.match_participants where match_id = 'aaaaaaaa-0000-0000-0000-000000000002' and status = 'approved' and team is not null),
  6,
  'all 6 approved participants are assigned to a team after shuffling (6 fits within 2x5)'
);

-- 14. The requested and rejected participants were never touched by the shuffle.
select is(
  (select team from public.match_participants where id = '50000000-0000-0000-0000-000000000007'),
  null,
  'the still-requested participant is untouched by shuffle_match_teams'
);
select is(
  (select team from public.match_participants where id = '50000000-0000-0000-0000-000000000008'),
  null,
  'the rejected participant is untouched by shuffle_match_teams'
);

select * from finish();
rollback;
