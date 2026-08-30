-- supabase/tests/008_friendships.test.sql
begin;
select plan(7);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','mario@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','luca@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333','carlo@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('33333333-3333-3333-3333-333333333333','+390000000003','Carlo','Verdi','1992-01-01',182,'right','player');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');

select throws_ok(
  $$ insert into public.friendships (requester_id, receiver_id) values ('11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111') $$,
  null,
  'a user cannot send a friend request to themselves'
);

insert into public.friendships (id, requester_id, receiver_id)
values ('99999999-9999-9999-9999-999999999999','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select is(
  (select type from public.notifications where user_id = '22222222-2222-2222-2222-222222222222' order by created_at desc limit 1),
  'friend_request_received',
  'the receiver is notified of the new friend request'
);

select throws_ok(
  $$ insert into public.friendships (requester_id, receiver_id) values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111') $$,
  null,
  'a duplicate friendship request in the opposite direction fails (RLS allows the insert attempt; the unique pair index rejects it)'
);

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');

select throws_ok(
  $$ update public.friendships set status = 'accepted' where id = '99999999-9999-9999-9999-999999999999' $$,
  'only the receiver can accept or reject a friend request',
  'the requester cannot accept their own request'
);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select throws_ok(
  $$ update public.friendships set status = 'accepted', requester_id = '33333333-3333-3333-3333-333333333333' where id = '99999999-9999-9999-9999-999999999999' $$,
  'requester_id cannot be changed',
  'the receiver cannot tamper with the requester_id when accepting'
);

update public.friendships set status = 'accepted' where id = '99999999-9999-9999-9999-999999999999';

select is(
  (select status from public.friendships where id = '99999999-9999-9999-9999-999999999999'),
  'accepted',
  'the receiver can accept the friend request'
);

select throws_ok(
  $$ update public.friendships set status = 'rejected' where id = '99999999-9999-9999-9999-999999999999' $$,
  'a friendship decision cannot be changed once made',
  'a decision cannot be reversed once made'
);

select * from finish();
rollback;
