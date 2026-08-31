-- supabase/tests/017_final_review_hardening.test.sql
begin;
select plan(8);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','mario@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','luca@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

select tests.clear_authentication();
set local role anon;

select throws_ok(
  $$ select count(*) from public.user_public_profiles $$,
  null,
  'anon can no longer read user_public_profiles at all'
);

reset role;
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');

select throws_ok(
  $$ update public.users set matches_completed_count = 9999 where id = '11111111-1111-1111-1111-111111111111' $$,
  'match statistics are server-managed and cannot be changed directly',
  'a user cannot forge their own match statistics'
);

select throws_ok(
  $$ update public.users set phone = '+390000009999' where id = '11111111-1111-1111-1111-111111111111' $$,
  'phone cannot be changed directly; contact support to update your phone number',
  'a user cannot change their own phone number directly'
);

insert into public.user_blocks (blocker_id, blocked_id) values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');

select throws_ok(
  $$ insert into public.friendships (requester_id, receiver_id) values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222') $$,
  null,
  'a user cannot send a friend request to someone they blocked'
);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select throws_ok(
  $$ insert into public.friendships (requester_id, receiver_id) values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111') $$,
  null,
  'a blocked user cannot send a friend request to the person who blocked them'
);

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
delete from public.user_blocks where blocker_id = '11111111-1111-1111-1111-111111111111' and blocked_id = '22222222-2222-2222-2222-222222222222';

insert into public.friendships (id, requester_id, receiver_id)
values ('99999999-9999-9999-9999-999999999999','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
update public.friendships set status = 'rejected' where id = '99999999-9999-9999-9999-999999999999';
delete from public.friendships where id = '99999999-9999-9999-9999-999999999999';

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.friendships (id, requester_id, receiver_id)
values ('88888888-8888-8888-8888-888888888888','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.friendships where requester_id = '11111111-1111-1111-1111-111111111111' and receiver_id = '22222222-2222-2222-2222-222222222222'),
  1,
  'a fresh friend request succeeds after the previous rejected one was deleted'
);

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players, status)
values ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111',5,'Campo Palermo','Via Roma 1',38.1157,13.3615,'2026-09-05','20:00','21:30',10,'completed');

delete from public.matches where id = '44444444-4444-4444-4444-444444444444';

select ok(
  exists(select 1 from public.matches where id = '44444444-4444-4444-4444-444444444444'),
  'a creator cannot delete a match that has already completed (silently rejected by RLS, match still exists)'
);

select ok(
  exists(
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename in ('match_messages','private_messages','notifications')
  ),
  'match_messages, private_messages, and notifications are added to the realtime publication'
);

select * from finish();
rollback;
