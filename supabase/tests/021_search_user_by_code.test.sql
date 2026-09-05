-- supabase/tests/021_search_user_by_code.test.sql
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

select is(
  (select unique_user_id from public.search_user_by_code((select unique_user_id from public.user_public_profiles where id = '22222222-2222-2222-2222-222222222222'))),
  (select unique_user_id from public.user_public_profiles where id = '22222222-2222-2222-2222-222222222222'),
  'searching by a real code returns that user'
);

-- search_user_by_code is declared to RETURN a single public.user_public_profiles
-- row, not SETOF -- when its body query finds no match, Postgres does not
-- produce zero rows from a `FROM function(...)` call, it produces exactly
-- ONE row whose every column is NULL (confirmed empirically against this
-- exact function, including through the real PostgREST JSON layer, not just
-- raw psql: a "not found" call serializes as `{"id": null, "unique_user_id":
-- null, ...}`, never bare JSON `null`). So every "not found" case below
-- checks that the returned row's `id` is NULL -- count(*) would misleadingly
-- report 1, not 0, in every one of these cases.
select is(
  (select id from public.search_user_by_code('FC-999999')),
  null,
  'searching by a nonexistent code returns a null-id row'
);

select is(
  (select id from public.search_user_by_code((select unique_user_id from public.user_public_profiles where id = '11111111-1111-1111-1111-111111111111'))),
  null,
  'searching by your own code returns a null-id row'
);

insert into public.user_blocks (blocker_id, blocked_id) values ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333');

select is(
  (select id from public.search_user_by_code((select unique_user_id from public.user_public_profiles where id = '33333333-3333-3333-3333-333333333333'))),
  null,
  'searching for someone you blocked returns a null-id row'
);

select tests.authenticate_as('33333333-3333-3333-3333-333333333333');
select is(
  (select id from public.search_user_by_code((select unique_user_id from public.user_public_profiles where id = '11111111-1111-1111-1111-111111111111'))),
  null,
  'searching for someone who blocked you also returns a null-id row (mutual block check works both directions)'
);

select * from finish();
rollback;
