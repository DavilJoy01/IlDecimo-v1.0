begin;
select plan(5);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','creator@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','other@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');

insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111',5,'Campo Palermo','Via Roma 1',38.1157,13.3615,'2026-09-05','20:00','21:30',10);

select isnt(
  (select location from public.matches where id = '33333333-3333-3333-3333-333333333333'),
  null,
  'location geography column is generated from latitude/longitude'
);

select throws_ok(
  $$ insert into public.matches (creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
     values ('22222222-2222-2222-2222-222222222222', 5, 'Fake', 'Via Finta 1', 38.1, 13.3, '2026-09-05','20:00','21:30',10) $$,
  null,
  'a user cannot create a match with someone else as creator_id'
);

update public.matches set description = 'Portare maglia bianca' where id = '33333333-3333-3333-3333-333333333333';

select is(
  (select description from public.matches where id = '33333333-3333-3333-3333-333333333333'),
  'Portare maglia bianca',
  'the creator can update their own match'
);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

update public.matches set description = 'Hacked' where id = '33333333-3333-3333-3333-333333333333';

select is(
  (select description from public.matches where id = '33333333-3333-3333-3333-333333333333'),
  'Portare maglia bianca',
  'a non-creator update is silently rejected by RLS, description unchanged'
);

delete from public.matches where id = '33333333-3333-3333-3333-333333333333';

select ok(
  exists(select 1 from public.matches where id = '33333333-3333-3333-3333-333333333333'),
  'a non-creator delete is silently rejected by RLS, match still exists'
);

select * from finish();
rollback;
