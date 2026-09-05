-- supabase/tests/020_friend_response_and_block_notifications.test.sql
begin;
select plan(5);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','mario@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','luca@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333','gino@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('33333333-3333-3333-3333-333333333333','+390000000003','Gino','Verdi','1992-01-01',170,'both','player');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.friendships (id, requester_id, receiver_id)
values ('99999999-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
update public.friendships set status = 'accepted' where id = '99999999-1111-1111-1111-111111111111';

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
select is(
  (select type from public.notifications where user_id = '11111111-1111-1111-1111-111111111111' order by created_at desc limit 1),
  'friend_request_approved',
  'the requester is notified when their friend request is accepted'
);

select is(
  (select payload->>'message' from public.notifications where user_id = '11111111-1111-1111-1111-111111111111' and type = 'friend_request_approved' order by created_at desc limit 1),
  'Luca Bianchi ha accettato la tua richiesta di amicizia',
  'the acceptance notification carries the exact expected Italian text'
);

-- A second friendship (Mario -> Gino), this time rejected.
insert into public.friendships (id, requester_id, receiver_id)
values ('99999999-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333');

select tests.authenticate_as('33333333-3333-3333-3333-333333333333');
update public.friendships set status = 'rejected' where id = '99999999-2222-2222-2222-222222222222';

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
select is(
  (select type from public.notifications where user_id = '11111111-1111-1111-1111-111111111111' order by created_at desc limit 1),
  'friend_request_rejected',
  'the requester is notified when their friend request is rejected'
);

-- Block-deletes-friendship: Mario and Luca are friends (accepted above);
-- Mario blocks Luca; the friendship must be gone afterward.
select is(
  (select count(*)::int from public.friendships where id = '99999999-1111-1111-1111-111111111111'),
  1,
  'sanity check: the Mario/Luca friendship exists before the block'
);

insert into public.user_blocks (blocker_id, blocked_id)
values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.friendships where id = '99999999-1111-1111-1111-111111111111'),
  0,
  'blocking a friend deletes the existing friendship row'
);

select * from finish();
rollback;
