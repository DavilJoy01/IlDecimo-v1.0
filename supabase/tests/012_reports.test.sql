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
  $$ insert into public.reports (reporter_id, reason) values ('11111111-1111-1111-1111-111111111111','comportamento scorretto') $$,
  null,
  'a report must target either a user or a match'
);

insert into public.reports (id, reporter_id, reported_user_id, reason)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','comportamento scorretto in chat');

select throws_ok(
  $$ insert into public.reports (reporter_id, reported_user_id, reason) values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','falso report') $$,
  null,
  'a user cannot file a report on someone else''s behalf'
);

select is(
  (select count(*)::int from public.reports),
  1,
  'the reporter can see their own report'
);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.reports),
  0,
  'the reported user cannot see reports filed against them'
);

select * from finish();
rollback;
