-- supabase/tests/028_restrict_matches_select_to_relevant.test.sql
--
-- 20260916010000_restrict_matches_select_to_relevant_parties.sql closes an
-- information disclosure gap: public.matches' SELECT policy used to be
-- `using (true)`, letting any authenticated caller read every match row
-- directly (any status, any location -- exact address/coordinates
-- included) regardless of whether they have anything to do with it. This
-- verifies the tightened policy still lets every legitimate viewer see a
-- match (an open match anyone can browse, the creator, a participant of
-- any status, an invitee) while a true stranger can no longer see a
-- non-open match they have no relationship to.
begin;
select plan(6);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','mario@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','luca@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333','anna@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('33333333-3333-3333-3333-333333333333','+390000000003','Anna','Verdi','1992-01-01',168,'right','player');

insert into auth.users (id, email) values ('44444444-4444-4444-4444-444444444444','sara@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('44444444-4444-4444-4444-444444444444','+390000000004','Sara','Neri','1993-01-01',165,'right','player');

-- Mario creates two matches: one that stays open (the public discovery
-- surface), one that has already been completed (private history).
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');

insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players, status)
values ('aaaaaaaa-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111',5,'Campo Aperto','Via Roma 1',38.1157,13.3615,'2026-09-20','20:00','21:30',10,'open');

insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players, status)
values ('bbbbbbbb-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',5,'Campo Concluso','Via Roma 2',38.1157,13.3615,'2026-08-01','20:00','21:30',10,'completed');

-- Luca is an approved participant of the completed match.
select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
insert into public.match_participants (match_id, user_id, status) values ('bbbbbbbb-2222-2222-2222-222222222222','22222222-2222-2222-2222-222222222222','requested');
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'approved' where match_id = 'bbbbbbbb-2222-2222-2222-222222222222' and user_id = '22222222-2222-2222-2222-222222222222';

-- Sara is invited to the completed match but hasn't responded yet.
insert into public.match_invitations (match_id, inviter_id, invitee_id) values ('bbbbbbbb-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','44444444-4444-4444-4444-444444444444');

-- Anna has no relationship at all to either match.
select tests.authenticate_as('33333333-3333-3333-3333-333333333333');

select is(
  (select field_name from public.matches where id = 'aaaaaaaa-1111-1111-1111-111111111111'),
  'Campo Aperto',
  'any authenticated user can still see an open match -- the public discovery surface is preserved'
);

select is(
  (select count(*)::int from public.matches where id = 'bbbbbbbb-2222-2222-2222-222222222222'),
  0,
  'a stranger with no relationship to a non-open match can no longer read it directly'
);

-- The creator always sees their own matches, open or not.
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.matches where id = 'bbbbbbbb-2222-2222-2222-222222222222'),
  1,
  'the creator can still see their own completed match'
);

-- The approved participant sees the completed match they played in.
select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select is(
  (select status from public.matches where id = 'bbbbbbbb-2222-2222-2222-222222222222'),
  'completed',
  'an approved participant can still see the completed match they took part in'
);

-- The invitee sees the match they were invited to, even unresponded.
select tests.authenticate_as('44444444-4444-4444-4444-444444444444');

select is(
  (select count(*)::int from public.matches where id = 'bbbbbbbb-2222-2222-2222-222222222222'),
  1,
  'an invitee can see the match they were invited to before responding'
);

-- And the RLS-dependent policies that subquery matches.creator_id for the
-- current caller (participants_select_relevant, match_messages policies)
-- still resolve correctly for the actual creator -- not just in isolation.
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');

select is(
  (select status from public.match_participants where match_id = 'bbbbbbbb-2222-2222-2222-222222222222' and user_id = '22222222-2222-2222-2222-222222222222'),
  'approved',
  'the creator can still see a participant row on their own match via the RLS policy that subqueries matches.creator_id'
);

select * from finish();
rollback;
