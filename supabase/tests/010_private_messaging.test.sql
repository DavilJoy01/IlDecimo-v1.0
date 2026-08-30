-- supabase/tests/010_private_messaging.test.sql
begin;
select plan(7);

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
values ('99999999-9999-9999-9999-999999999999','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');

insert into public.private_messages (id, conversation_id, sender_id, body)
values ('88888888-8888-8888-8888-888888888888','99999999-9999-9999-9999-999999999999','11111111-1111-1111-1111-111111111111','Ciao Luca!');

select tests.authenticate_as('33333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.private_messages where conversation_id = '99999999-9999-9999-9999-999999999999'),
  0,
  'a user outside the conversation cannot read its messages'
);

select throws_ok(
  $$ insert into public.private_messages (conversation_id, sender_id, body) values ('99999999-9999-9999-9999-999999999999','33333333-3333-3333-3333-333333333333','Intruso') $$,
  null,
  'a user outside the conversation cannot post in it'
);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select is(
  (select type from public.notifications where user_id = '22222222-2222-2222-2222-222222222222' order by created_at desc limit 1),
  'private_message',
  'the recipient is notified of a new private message'
);

update public.private_messages set read_at = now() where id = '88888888-8888-8888-8888-888888888888';

select isnt(
  (select read_at from public.private_messages where id = '88888888-8888-8888-8888-888888888888'),
  null,
  'the recipient can mark a message as read'
);

select throws_ok(
  $$ update public.private_messages set body = 'edited' where id = '88888888-8888-8888-8888-888888888888' $$,
  'only read_at can be updated on a private message',
  'a message body cannot be edited after sending'
);

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.user_blocks (blocker_id, blocked_id) values ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333');

select throws_ok(
  $$ insert into public.private_conversations (user_a_id, user_b_id) values ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333') $$,
  null,
  'a blocked pair cannot start a new conversation'
);

select is(
  (select count(*)::int from public.private_conversations),
  1,
  'the earlier legitimate conversation still exists'
);

select * from finish();
rollback;
