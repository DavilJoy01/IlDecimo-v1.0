begin;
select plan(2);

select ok(
  exists(select 1 from pg_extension where extname = 'postgis'),
  'postgis extension is enabled'
);

select ok(
  exists(select 1 from pg_proc where proname = 'authenticate_as' and pronamespace = 'tests'::regnamespace),
  'tests.authenticate_as helper exists'
);

select * from finish();
rollback;
