-- supabase/tests/009_user_blocks.test.sql
begin;
select plan(4);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','mario@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','luca@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');

select throws_ok(
  $$ insert into public.user_blocks (blocker_id, blocked_id) values ('11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111') $$,
  null,
  'a user cannot block themselves'
);

select throws_ok(
  $$ insert into public.user_blocks (blocker_id, blocked_id) values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111') $$,
  null,
  'a user cannot create a block on someone else''s behalf'
);

insert into public.user_blocks (blocker_id, blocked_id) values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.user_blocks),
  1,
  'a user can block another user'
);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.user_blocks),
  0,
  'the blocked user cannot see that they have been blocked'
);

select * from finish();
rollback;
