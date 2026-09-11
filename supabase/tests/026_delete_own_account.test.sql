-- supabase/tests/026_delete_own_account.test.sql
begin;
select plan(9);

-- CALLER: the user who will delete their own account.
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','caller@example.com');
update auth.users set phone = '+390000000001' where id = '11111111-1111-1111-1111-111111111111';
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

-- OTHER: a second user, both to receive a message from the caller and to
-- own a match the caller will join and later be removed from.
insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','other@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

-- Match created BY THE CALLER (must be gone entirely after deletion).
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players, status)
values ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',5,'Campo Caller','Via A 1',38.11,13.36,'2026-02-01','10:00','11:00',10,'open');

-- Match created BY OTHER, the caller is an approved participant (the
-- caller's own row here must be gone after deletion; the match itself and
-- OTHER's ownership of it must be untouched).
select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players, status)
values ('aaaaaaaa-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222',5,'Campo Other','Via B 1',38.11,13.36,'2026-02-02','10:00','11:00',10,'open');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.match_participants (id, match_id, user_id, status)
values ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','requested');
select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
update public.match_participants set status = 'approved' where id = 'bbbbbbbb-0000-0000-0000-000000000001';

-- A message the caller sent, which must survive deletion: it has to live
-- in a match that is NOT deleted by this plan, i.e. one created by OTHER
-- (not by the caller) -- the caller's own matches are hard-deleted, which
-- would take any message inside them along for the ride regardless of
-- sender. OTHER's match, where the caller is merely a participant, is
-- never touched by the caller's own account deletion. match_messages'
-- own insert policy requires sender_id = auth.uid(), so re-authenticate
-- as the caller (not OTHER, the last authenticated role above) first.
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.match_messages (id, match_id, sender_id, body)
values ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Ci vediamo al campo!');

-- 1. Unauthenticated call is rejected outright.
select tests.clear_authentication();
select throws_ok(
  $$select public.delete_own_account()$$,
  'P0001',
  'must be authenticated to delete an account',
  'delete_own_account rejects an unauthenticated caller'
);

-- Perform the real deletion, as the caller.
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
select public.delete_own_account();

-- 2. The caller's own match is gone entirely.
select is(
  (select count(*)::int from public.matches where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0,
  'a match created by the deleted account no longer exists'
);

-- 3. OTHER's match is untouched -- still exists, still owned by OTHER.
select is(
  (select creator_id from public.matches where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'a match created by someone else survives untouched'
);

-- 4. The caller's participation in OTHER's match is gone (spot freed).
select is(
  (select count(*)::int from public.match_participants where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  0,
  'the deleted account''s own participation in someone else''s match is removed'
);

-- 5. The message the caller sent in OTHER's match still exists, content
-- unchanged -- re-authenticate as OTHER first: the caller's own
-- match_messages_select_participants visibility into this match just
-- disappeared as a side effect of step 2 above (their own
-- match_participants row there was deleted), so reading as the caller
-- would now see nothing regardless of whether the message survived.
-- OTHER, the match's creator, always has visibility and is unaffected by
-- anything this deletion does.
select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
select is(
  (select body from public.match_messages where id = 'cccccccc-0000-0000-0000-000000000001'),
  'Ci vediamo al campo!',
  'a message sent by the deleted account survives with its content intact'
);

-- 6. The message's sender, read through the surviving row, now shows the
-- anonymized placeholder identity. Joined through public.user_public_profiles
-- (not public.users directly): public.users' own "users_select_self" RLS
-- policy only lets a user read their own row, so OTHER reading the
-- caller's (deleted account's) name must go through the read-only view
-- that every other part of this app uses for exactly this purpose (see
-- e.g. mobile/src/api/matchMessages.ts) -- joining public.users directly
-- here would see no row at all (RLS-blocked) regardless of anonymization.
select is(
  (select p.first_name || ' ' || p.last_name from public.match_messages m join public.user_public_profiles p on p.id = m.sender_id where m.id = 'cccccccc-0000-0000-0000-000000000001'),
  'Utente eliminato',
  'the surviving message''s sender now reads as the anonymized placeholder'
);

-- 7. public.users.phone no longer holds the real number (freed).
-- Re-authenticate as the caller first: the previous assertion left the
-- session authenticated as OTHER, and public.users' "users_select_self"
-- RLS policy only lets a user read their own row -- reading the caller's
-- row as OTHER would silently return 0 rows (NULL), making this assertion
-- pass vacuously (NULL isnt '+390000000001' is true) regardless of whether
-- anonymization actually happened. Verified this by reproducing the exact
-- session state against the running local db: the un-re-authenticated
-- query returns 0 rows, not the real (still-unanonymized or anonymized)
-- value, so the brief's assertion as given would not actually be checking
-- anything here.
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
select isnt(
  (select phone from public.users where id = '11111111-1111-1111-1111-111111111111'),
  '+390000000001',
  'the deleted account''s public.users.phone is no longer the real number'
);

-- 8. The real phone number is reusable -- inserting a fresh public.users
-- row with it does not violate the unique constraint.
select tests.clear_authentication();
insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333','newcomer@example.com');
select lives_ok(
  $$insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
    values ('33333333-3333-3333-3333-333333333333','+390000000001','New','Comer','1995-01-01',170,'right','player')$$,
  'the freed phone number can be reused by a brand-new registration'
);

-- 9. auth.users is disabled: banned far in the future, phone cleared.
select ok(
  (select banned_until from auth.users where id = '11111111-1111-1111-1111-111111111111') > now() + interval '100 years',
  'the deleted account''s auth.users row is banned far into the future'
);

select * from finish();
rollback;
