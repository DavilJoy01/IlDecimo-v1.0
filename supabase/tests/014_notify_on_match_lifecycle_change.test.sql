-- supabase/tests/014_notify_on_match_lifecycle_change.test.sql
begin;
select plan(3);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','creator@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','player@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111',5,'Campo Palermo','Via Roma 1',38.1157,13.3615,'2026-09-05','20:00','21:30',10);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
insert into public.match_participants (id, match_id, user_id, status)
values ('55555555-5555-5555-5555-555555555555','44444444-4444-4444-4444-444444444444','22222222-2222-2222-2222-222222222222','requested');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'approved' where id = '55555555-5555-5555-5555-555555555555';

update public.matches set start_time = '21:00', end_time = '22:30' where id = '44444444-4444-4444-4444-444444444444';

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select is(
  (select type from public.notifications where user_id = '22222222-2222-2222-2222-222222222222' order by created_at desc limit 1),
  'match_time_changed',
  'an approved participant is notified when the match time changes'
);

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.matches set address = 'Via Nuova 5' where id = '44444444-4444-4444-4444-444444444444';

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select is(
  (select type from public.notifications where user_id = '22222222-2222-2222-2222-222222222222' order by created_at desc limit 1),
  'match_location_changed',
  'an approved participant is notified when the match address changes'
);

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.matches set status = 'cancelled' where id = '44444444-4444-4444-4444-444444444444';

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select is(
  (select type from public.notifications where user_id = '22222222-2222-2222-2222-222222222222' order by created_at desc limit 1),
  'match_cancelled',
  'an approved participant is notified when the match is cancelled'
);

select * from finish();
rollback;
