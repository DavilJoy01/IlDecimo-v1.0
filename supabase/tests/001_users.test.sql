-- supabase/tests/001_users.test.sql
begin;
select plan(6);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'mario@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111', '+390000000001', 'Mario', 'Rossi', '1990-01-01', 180, 'right', 'player');

select matches(
  (select unique_user_id from public.users where id = '11111111-1111-1111-1111-111111111111'),
  '^FC-\d{6}$',
  'unique_user_id is auto-generated in FC-XXXXXX format'
);

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222', 'luca@example.com');

select throws_ok(
  $$ insert into public.users (id, unique_user_id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
     values ('22222222-2222-2222-2222-222222222222', 'FC-999999', '+390000000002', 'Luca', 'Bianchi', '1991-01-01', 175, 'left', 'goalkeeper') $$,
  'unique_user_id cannot be set manually',
  'inserting with a manual unique_user_id fails'
);

select throws_ok(
  $$ update public.users set unique_user_id = 'FC-000001' where id = '11111111-1111-1111-1111-111111111111' $$,
  'unique_user_id is immutable',
  'updating unique_user_id fails'
);

select lives_ok(
  $$ update public.users set first_name = 'Mario Updated' where id = '11111111-1111-1111-1111-111111111111' $$,
  'updating other profile fields succeeds'
);

select throws_ok(
  $$ insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
     values ('11111111-1111-1111-1111-111111111111', '+390000000009', 'Dup', 'Licate', '1990-01-01', 180, 'right', 'player') $$,
  null,
  'inserting a duplicate primary key fails'
);

select throws_ok(
  $$ insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
     values ('22222222-2222-2222-2222-222222222222', '+390000000001', 'Luca', 'Bianchi', '1991-01-01', 175, 'left', 'goalkeeper') $$,
  null,
  'inserting a duplicate phone number fails'
);

select * from finish();
rollback;
