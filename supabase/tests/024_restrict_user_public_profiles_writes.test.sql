-- supabase/tests/024_restrict_user_public_profiles_writes.test.sql
begin;
select plan(4);

-- Static privilege check: `authenticated` must have SELECT only on this
-- view, never INSERT/UPDATE/DELETE (Supabase grants ALL by default on
-- every new relation; anon/public were already revoked in
-- 20260830101700_final_review_hardening.sql, but authenticated was not).
select ok(
  has_table_privilege('authenticated', 'public.user_public_profiles', 'SELECT'),
  'authenticated can still SELECT from user_public_profiles'
);
select ok(
  not has_table_privilege('authenticated', 'public.user_public_profiles', 'UPDATE'),
  'authenticated cannot UPDATE user_public_profiles'
);
select ok(
  not has_table_privilege('authenticated', 'public.user_public_profiles', 'DELETE'),
  'authenticated cannot DELETE from user_public_profiles'
);

-- Behavioral check: an authenticated user attempting to write another
-- user's row through the view (which forwards to public.users, bypassing
-- its RLS, since the view has none of its own) must be rejected outright
-- by the missing table privilege, not merely a no-op.
insert into auth.users (id, email) values ('55555555-5555-5555-5555-555555555555','attacker@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('55555555-5555-5555-5555-555555555555','+390000000010','Attacker','Test','1990-01-01',180,'right','player');

insert into auth.users (id, email) values ('66666666-6666-6666-6666-666666666666','victim@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('66666666-6666-6666-6666-666666666666','+390000000011','Victim','Test','1991-01-01',175,'left','player');

select tests.authenticate_as('55555555-5555-5555-5555-555555555555');
select throws_ok(
  $$update public.user_public_profiles set first_name = 'HACKED' where id = '66666666-6666-6666-6666-666666666666'$$,
  '42501',
  'permission denied for view user_public_profiles',
  'an authenticated user cannot UPDATE another user''s row through the view'
);

select * from finish();
rollback;
