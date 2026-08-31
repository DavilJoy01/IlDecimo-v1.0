-- supabase/tests/015_transition_match_statuses.test.sql
begin;
select plan(5);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','creator@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','player@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');

insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players, status)
values ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111',5,'Campo Palermo','Via Roma 1',38.1157,13.3615, (current_date - 1), '20:00','21:30',10,'open');

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
insert into public.match_participants (id, match_id, user_id, status)
values ('55555555-5555-5555-5555-555555555555','44444444-4444-4444-4444-444444444444','22222222-2222-2222-2222-222222222222','requested');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'approved' where id = '55555555-5555-5555-5555-555555555555';
update public.match_participants set status = 'active' where id = '55555555-5555-5555-5555-555555555555';

-- transition_match_statuses() is a system-only function (invoked by pg_cron, which
-- runs as a superuser) and is deliberately never granted to `authenticated` -- an
-- ordinary signed-in user should not be able to force match completions/reminders
-- on demand. Simulate the cron caller by clearing authentication first.
select tests.clear_authentication();
select public.transition_match_statuses();

select is(
  (select status from public.matches where id = '44444444-4444-4444-4444-444444444444'),
  'completed',
  'a match whose end time has passed transitions to completed'
);

select is(
  (select status from public.match_participants where id = '55555555-5555-5555-5555-555555555555'),
  'completed',
  'an active participant is marked completed when the match completes'
);

select is(
  (select matches_completed_count from public.user_public_profiles where id = '22222222-2222-2222-2222-222222222222'),
  1,
  'the participant''s completed match counter is incremented'
);

insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players, status)
values (
  '66666666-6666-6666-6666-666666666666','11111111-1111-1111-1111-111111111111',5,'Campo Imminente','Via Roma 2',38.1157,13.3615,
  current_date,
  to_char((now() + interval '30 minutes') at time zone 'Europe/Rome', 'HH24:MI')::time,
  to_char((now() + interval '90 minutes') at time zone 'Europe/Rome', 'HH24:MI')::time,
  10,'open'
);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
insert into public.match_participants (id, match_id, user_id, status)
values ('66666666-6666-6666-6666-666666666666','66666666-6666-6666-6666-666666666666','22222222-2222-2222-2222-222222222222','requested');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'approved' where id = '66666666-6666-6666-6666-666666666666';

select tests.clear_authentication();
select public.transition_match_statuses();

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select is(
  (select type from public.notifications where user_id = '22222222-2222-2222-2222-222222222222' order by created_at desc limit 1),
  'match_reminder',
  'a reminder notification is sent when a match starts within the next hour'
);

select tests.clear_authentication();

select ok(
  exists(select 1 from cron.job where jobname = 'transition-match-statuses'),
  'the cron job is registered to run the transition function periodically'
);

select * from finish();
rollback;
