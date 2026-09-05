-- supabase/tests/022_hide_conversation_on_block.test.sql
begin;
select plan(6);

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
insert into public.private_conversations (id, user_a_id, user_b_id)
values ('99999999-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');

-- Mario (user_a) blocks Luca (user_b) -- Mario's own side should hide.
insert into public.user_blocks (blocker_id, blocked_id) values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');

select isnt(
  (select hidden_for_a_at from public.private_conversations where id = '99999999-1111-1111-1111-111111111111'),
  null,
  'blocking the other participant hides the conversation for the blocker (as user_a)'
);

select is(
  (select hidden_for_b_at from public.private_conversations where id = '99999999-1111-1111-1111-111111111111'),
  null,
  'the blocked participant (user_b) does not have their own side hidden'
);

delete from public.user_blocks where blocker_id = '11111111-1111-1111-1111-111111111111' and blocked_id = '22222222-2222-2222-2222-222222222222';

select is(
  (select hidden_for_a_at from public.private_conversations where id = '99999999-1111-1111-1111-111111111111'),
  null,
  'unblocking clears the hidden_for_a_at column again'
);

-- Second conversation, opposite roles: Gino (user_a) <-> Mario (user_b), this
-- time Mario (holding the user_b role) does the blocking.
insert into public.private_conversations (id, user_a_id, user_b_id)
values ('99999999-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111');

insert into public.user_blocks (blocker_id, blocked_id) values ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333');

select isnt(
  (select hidden_for_b_at from public.private_conversations where id = '99999999-2222-2222-2222-222222222222'),
  null,
  'blocking works correctly when the blocker holds the user_b role'
);

select is(
  (select hidden_for_a_at from public.private_conversations where id = '99999999-2222-2222-2222-222222222222'),
  null,
  'the blocked participant (user_a in this case) does not have their own side hidden'
);

delete from public.user_blocks where blocker_id = '11111111-1111-1111-1111-111111111111' and blocked_id = '33333333-3333-3333-3333-333333333333';

select is(
  (select hidden_for_b_at from public.private_conversations where id = '99999999-2222-2222-2222-222222222222'),
  null,
  'unblocking clears hidden_for_b_at when the blocker held the user_b role'
);

select * from finish();
rollback;
