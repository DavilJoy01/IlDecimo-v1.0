# Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the entire Supabase backend (schema, RLS, triggers, geolocation search, notification pipeline, and scheduled jobs) for the app-calcio MVP, fully testable with pgTAP before any mobile UI exists.

**Architecture:** Every table lives in Postgres with Row Level Security enabled; every business rule from the spec (approval-only entry, 2-exit limit, chat access, notification fan-out, automatic match lifecycle) is enforced by a trigger or RLS policy in the database itself, never left to client code. Notifications are inserted by domain triggers and delivered to Expo Push via `pg_net` directly from a database trigger — no Edge Functions are needed for this plan.

**Tech Stack:** Supabase CLI (local dev), Postgres 15, PostGIS, pgTAP, pg_cron, pg_net.

**Spec:** [docs/superpowers/specs/2026-08-30-app-calcio-mvp-design.md](../specs/2026-08-30-app-calcio-mvp-design.md)

## Global Constraints

- Every table gets `alter table ... enable row level security;` — no table is ever left without RLS.
- No table grants blanket privileges to `authenticated`; each task grants only the specific operations (`select`/`insert`/`update`/`delete`) its policies actually need.
- `unique_user_id` is generated server-side in the format `FC-XXXXXX` and is immutable after creation (spec REGOLA 8).
- A user's precise location is never persisted anywhere in the database — only `matches.location` (a public venue address) is stored (spec section 2, privacy note).
- The 2-exit rule (max 2 re-entries per user per match) is enforced in a `BEFORE UPDATE` trigger on `match_participants`, not just in the app (spec REGOLA 3/4).
- Only the match creator may approve/reject a join request or modify/cancel a match (spec REGOLA 1).
- Chat (`match_messages`, `private_messages`) is readable/writable only by authorized participants (spec REGOLA 6).
- All migrations live in `supabase/migrations/`, all pgTAP tests in `supabase/tests/`, one test file per migration.
- Every migration is written to be replayed **in order, from a fresh database**, via `supabase db reset` — the actual Supabase CLI workflow this plan is tested against. `create or replace function` is used because functions are genuinely redefined across later tasks; plain `create table`/`create trigger`/`create policy` are correct as-is and do NOT need `if not exists`/`drop ... if exists` guards, since `db reset` always starts from zero and each migration runs exactly once per reset, matching standard Supabase migration conventions (this plan never re-applies a single migration to an already-migrated database).
- Every test file is self-contained (creates its own fixtures) and wrapped in `begin; ... rollback;` so tests never leak state into each other.
- Every `security definer` function pins `set search_path = ''` (or the narrowest schema list it actually needs, e.g. `'extensions'` for PostGIS calls) — an unpinned search path on a privilege-elevated function is a real hijack vector, not a style nit.
- `public.users.phone` is never exposed to anyone but its owner; any cross-user profile read goes through `public.user_public_profiles`, never the base table.

---

### Task 1: Project setup — Supabase CLI, extensions, pgTAP test helper

**Files:**
- Create: `supabase/config.toml` (via `supabase init`)
- Create: `supabase/migrations/20260830100000_enable_extensions_and_test_helpers.sql`
- Create: `supabase/tests/000_extensions.test.sql`

**Interfaces:**
- Produces: extensions `pgtap`, `postgis`, `pg_cron`, `pg_net` enabled in the `extensions` schema; a `tests` schema with `tests.authenticate_as(user_id uuid) returns void` used by every later test file to simulate an authenticated request.

- [ ] **Step 1: Install the Supabase CLI and verify**

Run: `brew install supabase/tap/supabase && supabase --version`
Expected: prints a version number (e.g. `1.x.x`).

- [ ] **Step 2: Initialize the Supabase project**

Run (from the repo root, `/Users/giovanni/Desktop/app calcio`): `supabase init`
This creates `supabase/config.toml` and empty `supabase/migrations/`.

- [ ] **Step 3: Write the migration enabling extensions and the test helper**

```sql
-- supabase/migrations/20260830100000_enable_extensions_and_test_helpers.sql
create extension if not exists pgtap with schema extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

create schema if not exists tests;

create or replace function tests.authenticate_as(user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_id, 'role', 'authenticated')::text,
    true
  );
end;
$$;

create or replace function tests.clear_authentication()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

grant usage on schema tests to authenticated;
grant execute on function tests.authenticate_as(uuid) to authenticated;
grant execute on function tests.clear_authentication() to authenticated;
```

- [ ] **Step 4: Write the smoke test**

```sql
-- supabase/tests/000_extensions.test.sql
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
```

- [ ] **Step 5: Start the local stack and run the test**

Run: `supabase start` (requires Docker running), then `supabase test db`
Expected: `000_extensions.test.sql .. ok` and both assertions pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/config.toml supabase/migrations/20260830100000_enable_extensions_and_test_helpers.sql supabase/tests/000_extensions.test.sql
git commit -m "chore: bootstrap Supabase project with pgTAP test helper"
```

---

### Task 2: `users` table with immutable, auto-generated `unique_user_id`

**Files:**
- Create: `supabase/migrations/20260830100100_create_users_table.sql`
- Create: `supabase/tests/001_users.test.sql`

**Interfaces:**
- Consumes: `auth.users` (Supabase Auth's built-in table, already present in the local stack).
- Produces: table `public.users(id, unique_user_id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role, profile_image_url, matches_played_count, matches_completed_count, matches_abandoned_count, created_at, updated_at)`, used as the FK target (`public.users(id)`) by every later table; view `public.user_public_profiles(id, unique_user_id, first_name, last_name, birth_date, height_cm, preferred_foot, player_role, profile_image_url, matches_played_count, matches_completed_count, matches_abandoned_count)` — every later feature that reads *another* user's profile (search by ID, friend profiles, match participant lists) reads this view, never the base table, since the base table's own SELECT is owner-only and `phone` is never exposed to anyone but its owner.

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/001_users.test.sql
begin;
select plan(9);

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

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.users where id = '11111111-1111-1111-1111-111111111111'),
  0,
  'a non-owner cannot see another user''s row via the base table'
);

select is(
  (select count(*)::int from public.user_public_profiles where id = '11111111-1111-1111-1111-111111111111'),
  1,
  'a non-owner can see another user''s public profile via the view'
);

select throws_ok(
  $$ select phone from public.user_public_profiles limit 1 $$,
  null,
  'the public profile view does not expose the phone column at all'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: FAIL — `relation "public.users" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260830100100_create_users_table.sql
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  unique_user_id text unique,
  phone text unique not null,
  first_name text not null,
  last_name text not null,
  birth_date date not null,
  height_cm integer not null check (height_cm > 0 and height_cm < 250),
  preferred_foot text not null check (preferred_foot in ('left','right','both')),
  player_role text not null check (player_role in ('player','goalkeeper','both')),
  profile_image_url text,
  matches_played_count integer not null default 0,
  matches_completed_count integer not null default 0,
  matches_abandoned_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence public.user_id_seq start 100000;

create or replace function public.generate_unique_user_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.unique_user_id is not null then
    raise exception 'unique_user_id cannot be set manually';
  end if;
  new.unique_user_id := 'FC-' || lpad(nextval('public.user_id_seq')::text, 6, '0');
  return new;
end;
$$;

create trigger trg_generate_unique_user_id
  before insert on public.users
  for each row execute function public.generate_unique_user_id();

create or replace function public.protect_users_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.unique_user_id is distinct from old.unique_user_id then
    raise exception 'unique_user_id is immutable';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_protect_users_row
  before update on public.users
  for each row execute function public.protect_users_row();

alter table public.users enable row level security;

grant select, insert, update on public.users to authenticated;

create policy "users_select_self" on public.users
  for select to authenticated using (auth.uid() = id);

create policy "users_insert_self" on public.users
  for insert to authenticated with check (auth.uid() = id);

create policy "users_update_self" on public.users
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create view public.user_public_profiles
with (security_invoker = false) as
select
  id, unique_user_id, first_name, last_name, birth_date, height_cm,
  preferred_foot, player_role, profile_image_url,
  matches_played_count, matches_completed_count, matches_abandoned_count
from public.users;

grant select on public.user_public_profiles to authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase test db`
Expected: `001_users.test.sql .. ok`, all 9 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260830100100_create_users_table.sql supabase/tests/001_users.test.sql
git commit -m "feat: add users table with immutable auto-generated unique_user_id"
```

---

### Task 3: `matches` table with PostGIS location and creator-only mutation

**Files:**
- Create: `supabase/migrations/20260830100200_create_matches_table.sql`
- Create: `supabase/tests/002_matches.test.sql`

**Interfaces:**
- Consumes: `public.users(id)` (Task 2).
- Produces: table `public.matches(id, creator_id, match_type, field_name, address, latitude, longitude, location, match_date, start_time, end_time, max_players, description, status, created_at, updated_at)`.

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/002_matches.test.sql
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: FAIL — `relation "public.matches" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260830100200_create_matches_table.sql
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.users(id) on delete cascade,
  match_type integer not null check (match_type in (5,7,8)),
  field_name text not null,
  address text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  location geography(Point,4326) generated always as (
    ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
  ) stored,
  match_date date not null,
  start_time time not null,
  end_time time not null check (end_time > start_time),
  max_players integer not null check (max_players > 0),
  description text,
  status text not null default 'open' check (status in ('draft','open','full','started','completed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index matches_location_idx on public.matches using gist (location);

create or replace function public.touch_matches_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_matches_updated_at
  before update on public.matches
  for each row execute function public.touch_matches_updated_at();

alter table public.matches enable row level security;

grant select, insert, update, delete on public.matches to authenticated;

create policy "matches_select_authenticated" on public.matches
  for select to authenticated using (true);

create policy "matches_insert_as_creator" on public.matches
  for insert to authenticated with check (auth.uid() = creator_id);

create policy "matches_update_creator_only" on public.matches
  for update to authenticated using (auth.uid() = creator_id) with check (auth.uid() = creator_id);

create policy "matches_delete_creator_only" on public.matches
  for delete to authenticated using (auth.uid() = creator_id);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase test db`
Expected: `002_matches.test.sql .. ok`, all 5 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260830100200_create_matches_table.sql supabase/tests/002_matches.test.sql
git commit -m "feat: add matches table with PostGIS location and creator-only mutation"
```

---

### Task 4: `match_participants` — request/approval state machine and 2-exit limit

This is the core of REGOLA 1–4: no automatic entry, only the creator approves, and a user can leave and re-enter the same match at most twice.

**Files:**
- Create: `supabase/migrations/20260830100300_create_match_participants_table.sql`
- Create: `supabase/tests/003_match_participants.test.sql`

**Interfaces:**
- Consumes: `public.matches(id, creator_id)` (Task 3), `public.users(id)` (Task 2).
- Produces: table `public.match_participants(id, match_id, user_id, status, join_count, leave_count, requested_at, approved_at, left_at)`; function `public.enforce_participant_state_machine()` used only internally by its own trigger.

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/003_match_participants.test.sql
begin;
select plan(13);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','creator@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','player@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333','intruder@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('33333333-3333-3333-3333-333333333333','+390000000003','Gino','Verdi','1992-01-01',170,'both','player');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111',5,'Campo Palermo','Via Roma 1',38.1157,13.3615,'2026-09-05','20:00','21:30',10);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select throws_ok(
  $$ insert into public.match_participants (match_id, user_id, status) values ('44444444-4444-4444-4444-444444444444','22222222-2222-2222-2222-222222222222','approved') $$,
  'a new participation must start as requested',
  'a participant cannot self-insert as approved'
);

select throws_ok(
  $$ insert into public.match_participants (match_id, user_id, status) values ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111','requested') $$,
  'a user can only request participation for themselves',
  'a user cannot request participation on behalf of someone else'
);

insert into public.match_participants (id, match_id, user_id, status)
values ('55555555-5555-5555-5555-555555555555','44444444-4444-4444-4444-444444444444','22222222-2222-2222-2222-222222222222','requested');

select throws_ok(
  $$ update public.match_participants set status = 'approved' where id = '55555555-5555-5555-5555-555555555555' $$,
  'only the match creator can approve or reject a request',
  'a participant cannot self-approve'
);

select tests.authenticate_as('33333333-3333-3333-3333-333333333333');
update public.match_participants set status = 'approved' where id = '55555555-5555-5555-5555-555555555555';

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');

select is(
  (select status from public.match_participants where id = '55555555-5555-5555-5555-555555555555'),
  'requested',
  'a random user cannot modify a participation row they are not party to; RLS silently blocks it'
);

update public.match_participants set status = 'approved' where id = '55555555-5555-5555-5555-555555555555';

select is(
  (select status from public.match_participants where id = '55555555-5555-5555-5555-555555555555'),
  'approved',
  'the match creator can approve a participation request'
);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select throws_ok(
  $$ update public.match_participants set status = 'active' where id = '55555555-5555-5555-5555-555555555555' $$,
  'only the match creator can activate a participant',
  'a participant cannot self-activate'
);

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'active' where id = '55555555-5555-5555-5555-555555555555';

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
update public.match_participants set status = 'left' where id = '55555555-5555-5555-5555-555555555555';

select is(
  (select leave_count from public.match_participants where id = '55555555-5555-5555-5555-555555555555'),
  1,
  'leaving increments leave_count to 1'
);

update public.match_participants set status = 'requested', leave_count = 0 where id = '55555555-5555-5555-5555-555555555555';

select is(
  (select leave_count from public.match_participants where id = '55555555-5555-5555-5555-555555555555'),
  1,
  'a caller-supplied leave_count is ignored; the trigger keeps the server-computed value regardless of what the client sends'
);

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'approved' where id = '55555555-5555-5555-5555-555555555555';
update public.match_participants set status = 'active' where id = '55555555-5555-5555-5555-555555555555';

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
update public.match_participants set status = 'left' where id = '55555555-5555-5555-5555-555555555555';

select is(
  (select leave_count from public.match_participants where id = '55555555-5555-5555-5555-555555555555'),
  2,
  'leaving a second time increments leave_count to 2'
);

select throws_ok(
  $$ update public.match_participants set status = 'requested' where id = '55555555-5555-5555-5555-555555555555' $$,
  'maximum number of re-entries (2) reached for this match',
  'a third re-entry attempt is rejected after 2 leaves'
);

select throws_ok(
  $$ update public.match_participants set status = 'left' where id = '55555555-5555-5555-5555-555555555555' $$,
  'invalid participation status transition from left to left',
  'an unhandled transition (already left, attempting left again) is rejected by the catch-all'
);

select tests.authenticate_as('33333333-3333-3333-3333-333333333333');
insert into public.match_participants (id, match_id, user_id, status)
values ('99999999-9999-9999-9999-999999999999','44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333','requested');

select throws_ok(
  $$ update public.match_participants set match_id = '77777777-7777-7777-7777-777777777777' where id = '99999999-9999-9999-9999-999999999999' $$,
  'match_id cannot be changed',
  'a participant cannot move their own row to a different match'
);

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');

select throws_ok(
  $$ update public.match_participants set user_id = '11111111-1111-1111-1111-111111111111' where id = '99999999-9999-9999-9999-999999999999' $$,
  'user_id cannot be changed',
  'the match creator cannot reassign a participation row to a different user'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: FAIL — `relation "public.match_participants" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260830100300_create_match_participants_table.sql
create table public.match_participants (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null check (status in ('requested','approved','rejected','active','left','completed')),
  join_count integer not null default 1,
  leave_count integer not null default 0,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  left_at timestamptz,
  unique (match_id, user_id)
);

create or replace function public.enforce_participant_state_machine()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator_id uuid;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'requested' then
      raise exception 'a new participation must start as requested';
    end if;
    if new.user_id is distinct from auth.uid() then
      raise exception 'a user can only request participation for themselves';
    end if;
    new.join_count := 1;
    new.leave_count := 0;
    new.requested_at := now();
    new.approved_at := null;
    new.left_at := null;
    return new;
  end if;

  -- UPDATE: the row's identity is never caller-writable, in either direction.
  if new.match_id is distinct from old.match_id then
    raise exception 'match_id cannot be changed';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id cannot be changed';
  end if;

  select creator_id into v_creator_id from public.matches where id = old.match_id;

  -- Every derived/audit column defaults to its current value; only the
  -- specific branch below that legitimately changes one is allowed to.
  -- This closes the gap where a caller's UPDATE statement could set these
  -- columns directly alongside a status change the trigger does approve.
  new.join_count := old.join_count;
  new.leave_count := old.leave_count;
  new.requested_at := old.requested_at;
  new.approved_at := old.approved_at;
  new.left_at := old.left_at;

  if new.status = 'requested' and old.status = 'left' then
    if auth.uid() is distinct from old.user_id then
      raise exception 'only the participant themselves can re-request to join';
    end if;
    if old.leave_count >= 2 then
      raise exception 'maximum number of re-entries (2) reached for this match';
    end if;
    new.join_count := old.join_count + 1;
    new.requested_at := now();
    new.approved_at := null;
    new.left_at := null;

  elsif new.status in ('approved','rejected') and old.status = 'requested' then
    if auth.uid() is distinct from v_creator_id then
      raise exception 'only the match creator can approve or reject a request';
    end if;
    if new.status = 'approved' then
      new.approved_at := now();
    end if;

  elsif new.status = 'active' and old.status = 'approved' then
    if auth.uid() is distinct from v_creator_id then
      raise exception 'only the match creator can activate a participant';
    end if;

  elsif new.status = 'left' and old.status in ('approved','active') then
    if auth.uid() is distinct from old.user_id then
      raise exception 'only the participant themselves can leave the match';
    end if;
    new.leave_count := old.leave_count + 1;
    new.left_at := now();

  elsif new.status = 'completed' and old.status in ('approved','active') then
    if auth.uid() is not null and auth.uid() is distinct from v_creator_id then
      raise exception 'only the match creator or the system can mark a participation completed';
    end if;

  else
    raise exception 'invalid participation status transition from % to %', old.status, new.status;
  end if;

  return new;
end;
$$;

create trigger trg_enforce_participant_state_machine
  before insert or update on public.match_participants
  for each row execute function public.enforce_participant_state_machine();

alter table public.match_participants enable row level security;

grant select, insert, update on public.match_participants to authenticated;

-- A same-table correlated subquery directly inside this policy's `using`
-- clause makes Postgres raise "infinite recursion detected in policy for
-- relation" (evaluating the policy for one row would require re-evaluating
-- the same table's RLS for the subquery's rows). Wrapping the check in a
-- SECURITY DEFINER function breaks that direct self-reference.
create or replace function public.is_fellow_participant(p_match_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.match_participants mp2
    where mp2.match_id = p_match_id
      and mp2.user_id = p_user_id
      and mp2.status in ('approved','active','completed')
  );
$$;

create policy "participants_select_relevant" on public.match_participants
  for select to authenticated using (
    auth.uid() = user_id
    or auth.uid() = (select creator_id from public.matches where id = match_id)
    or public.is_fellow_participant(match_id, auth.uid())
  );

create policy "participants_insert_self" on public.match_participants
  for insert to authenticated with check (auth.uid() = user_id);

create policy "participants_update_self_or_creator" on public.match_participants
  for update to authenticated
  using (
    auth.uid() = user_id
    or auth.uid() = (select creator_id from public.matches where id = match_id)
  )
  with check (
    auth.uid() = user_id
    or auth.uid() = (select creator_id from public.matches where id = match_id)
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase test db`
Expected: `003_match_participants.test.sql .. ok`, all 13 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260830100300_create_match_participants_table.sql supabase/tests/003_match_participants.test.sql
git commit -m "feat: enforce approval-only entry and 2-exit limit on match_participants"
```

---

### Task 5: `match_participant_events` — persistent participation history

**Files:**
- Create: `supabase/migrations/20260830100400_create_match_participant_events_table.sql`
- Create: `supabase/tests/004_match_participant_events.test.sql`

**Interfaces:**
- Consumes: `public.match_participants(id, status)` (Task 4).
- Produces: table `public.match_participant_events(id, match_participant_id, from_status, to_status, changed_at)`, populated automatically — no application code ever inserts into it directly.

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/004_match_participant_events.test.sql
begin;
select plan(3);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','creator@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','player@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111',5,'Campo Palermo','Via Roma 1',38.1157,13.3615,'2026-09-05','20:00','21:30',10);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
insert into public.match_participants (id, match_id, user_id, status)
values ('55555555-5555-5555-5555-555555555555','44444444-4444-4444-4444-444444444444','22222222-2222-2222-2222-222222222222','requested');

select is(
  (select count(*)::int from public.match_participant_events where match_participant_id = '55555555-5555-5555-5555-555555555555'),
  1,
  'the initial request is logged as one event'
);

select is(
  (select to_status from public.match_participant_events where match_participant_id = '55555555-5555-5555-5555-555555555555'),
  'requested',
  'the initial event records to_status = requested'
);

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'approved' where id = '55555555-5555-5555-5555-555555555555';

select results_eq(
  $$ select from_status, to_status from public.match_participant_events where match_participant_id = '55555555-5555-5555-5555-555555555555' order by changed_at desc limit 1 $$,
  $$ values ('requested'::text, 'approved'::text) $$,
  'approving the request appends a new event recording the transition'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: FAIL — `relation "public.match_participant_events" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260830100400_create_match_participant_events_table.sql
-- clock_timestamp(), not now(): now()/transaction_timestamp() returns the same
-- value for every call within one transaction, so two events logged in the same
-- transaction (as happens inside a single pgTAP test, and could happen in any
-- multi-step production transaction) would tie on changed_at and make ordering
-- by it unreliable. clock_timestamp() reflects true wall-clock time per call.
create table public.match_participant_events (
  id uuid primary key default gen_random_uuid(),
  match_participant_id uuid not null references public.match_participants(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_at timestamptz not null default clock_timestamp()
);

alter table public.match_participant_events enable row level security;

grant select on public.match_participant_events to authenticated;

create policy "participant_events_select_relevant" on public.match_participant_events
  for select to authenticated using (
    exists (
      select 1 from public.match_participants mp
      where mp.id = match_participant_events.match_participant_id
        and (
          mp.user_id = auth.uid()
          or auth.uid() = (select creator_id from public.matches where id = mp.match_id)
          or public.is_fellow_participant(mp.match_id, auth.uid())
        )
    )
  );

create or replace function public.log_participant_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.match_participant_events (match_participant_id, from_status, to_status)
    values (new.id, null, new.status);
  elsif tg_op = 'UPDATE' and new.status <> old.status then
    insert into public.match_participant_events (match_participant_id, from_status, to_status)
    values (new.id, old.status, new.status);
  end if;
  return new;
end;
$$;

create trigger trg_log_participant_status_change
  after insert or update on public.match_participants
  for each row execute function public.log_participant_status_change();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase test db`
Expected: `004_match_participant_events.test.sql .. ok`, all 3 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260830100400_create_match_participant_events_table.sql supabase/tests/004_match_participant_events.test.sql
git commit -m "feat: log every match_participants status change to a persistent history table"
```

---

### Task 6: `notifications` and `user_push_tokens` tables

**Files:**
- Create: `supabase/migrations/20260830100500_create_notifications_tables.sql`
- Create: `supabase/tests/005_notifications_tables.test.sql`

**Interfaces:**
- Consumes: `public.users(id)` (Task 2).
- Produces: table `public.notifications(id, user_id, type, payload, read_at, created_at)` with `type` enum `('join_request_received','join_request_approved','join_request_rejected','friend_request_received','match_invitation','private_message','match_message','match_reminder','match_time_changed','match_location_changed','match_cancelled')`; table `public.user_push_tokens(id, user_id, push_token, created_at)`. Every later domain trigger (Tasks 7, 8, 9, 11, 12, 15, 16) inserts into `public.notifications`; Task 17 reads `public.user_push_tokens` and reacts to inserts into `public.notifications`.

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/005_notifications_tables.test.sql
begin;
select plan(6);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','mario@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','luca@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

insert into public.notifications (user_id, type, payload)
values ('11111111-1111-1111-1111-111111111111', 'match_reminder', '{"message":"ciao"}'::jsonb);

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.notifications),
  1,
  'the owner can see their own notification'
);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.notifications),
  0,
  'another user cannot see someone else''s notification'
);

select throws_ok(
  $$ insert into public.notifications (user_id, type, payload) values ('22222222-2222-2222-2222-222222222222', 'match_reminder', '{}'::jsonb) $$,
  null,
  'a regular authenticated user cannot insert notifications directly'
);

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.notifications set read_at = now() where user_id = '11111111-1111-1111-1111-111111111111';

select isnt(
  (select read_at from public.notifications where user_id = '11111111-1111-1111-1111-111111111111'),
  null,
  'a user can mark their own notification as read'
);

insert into public.user_push_tokens (user_id, push_token) values ('11111111-1111-1111-1111-111111111111', 'ExponentPushToken[abc]');

select is(
  (select count(*)::int from public.user_push_tokens where user_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'a user can register their own push token'
);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.user_push_tokens),
  0,
  'another user cannot see someone else''s push tokens'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: FAIL — `relation "public.notifications" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260830100500_create_notifications_tables.sql
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null check (type in (
    'join_request_received','join_request_approved','join_request_rejected',
    'friend_request_received','match_invitation','private_message','match_message',
    'match_reminder','match_time_changed','match_location_changed','match_cancelled'
  )),
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  -- clock_timestamp(), not now(): now()/transaction_timestamp() is frozen for the
  -- whole transaction, so two notifications for the same user logged in one
  -- transaction (as happens inside a single pgTAP test, and could happen inside
  -- any single production transaction that fires more than one notification —
  -- e.g. Task 16's periodic sweep) would tie on created_at, making "get the
  -- user's latest notification" (`order by created_at desc limit 1`, used
  -- throughout this plan's tests) non-deterministic.
  created_at timestamptz not null default clock_timestamp()
);

create index notifications_user_id_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

grant select, update on public.notifications to authenticated;

create policy "notifications_select_own" on public.notifications
  for select to authenticated using (auth.uid() = user_id);

create policy "notifications_update_own" on public.notifications
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.user_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  push_token text not null,
  created_at timestamptz not null default now(),
  unique (user_id, push_token)
);

alter table public.user_push_tokens enable row level security;

grant select, insert, delete on public.user_push_tokens to authenticated;

create policy "user_push_tokens_select_own" on public.user_push_tokens
  for select to authenticated using (auth.uid() = user_id);

create policy "user_push_tokens_insert_own" on public.user_push_tokens
  for insert to authenticated with check (auth.uid() = user_id);

create policy "user_push_tokens_delete_own" on public.user_push_tokens
  for delete to authenticated using (auth.uid() = user_id);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase test db`
Expected: `005_notifications_tables.test.sql .. ok`, all 6 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260830100500_create_notifications_tables.sql supabase/tests/005_notifications_tables.test.sql
git commit -m "feat: add notifications and user_push_tokens tables"
```

---

### Task 7: Notify on join-request lifecycle (request received / approved / rejected)

**Files:**
- Create: `supabase/migrations/20260830100600_notify_on_participant_change.sql`
- Create: `supabase/tests/006_notify_on_participant_change.test.sql`

**Interfaces:**
- Consumes: `public.match_participants` (Task 4), `public.matches(creator_id, field_name)` (Task 3), `public.notifications` (Task 6).
- Produces: trigger `trg_notify_on_participant_change` (internal only).

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/006_notify_on_participant_change.test.sql
begin;
select plan(3);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','creator@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','player@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111',5,'Campo Palermo','Via Roma 1',38.1157,13.3615,'2026-09-05','20:00','21:30',10);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
insert into public.match_participants (id, match_id, user_id, status)
values ('55555555-5555-5555-5555-555555555555','44444444-4444-4444-4444-444444444444','22222222-2222-2222-2222-222222222222','requested');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');

select is(
  (select type from public.notifications where user_id = '11111111-1111-1111-1111-111111111111' order by created_at desc limit 1),
  'join_request_received',
  'the creator is notified when a new join request comes in'
);

update public.match_participants set status = 'approved' where id = '55555555-5555-5555-5555-555555555555';

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select is(
  (select type from public.notifications where user_id = '22222222-2222-2222-2222-222222222222' order by created_at desc limit 1),
  'join_request_approved',
  'the participant is notified when their request is approved'
);

select tests.authenticate_as('33333333-3333-3333-3333-333333333333');
insert into public.match_participants (id, match_id, user_id, status)
values ('66666666-6666-6666-6666-666666666666','44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333','requested');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'rejected' where id = '66666666-6666-6666-6666-666666666666';

select tests.authenticate_as('33333333-3333-3333-3333-333333333333');

select is(
  (select type from public.notifications where user_id = '33333333-3333-3333-3333-333333333333' and payload->>'match_id' = '44444444-4444-4444-4444-444444444444' and type = 'join_request_rejected'),
  'join_request_rejected',
  'the participant (a distinct user from the creator) is notified when their request is rejected'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: FAIL — first assertion returns `null` instead of `join_request_received` (no notification is created yet).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260830100600_notify_on_participant_change.sql
create or replace function public.notify_on_participant_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator_id uuid;
  v_field_name text;
begin
  select creator_id, field_name into v_creator_id, v_field_name
  from public.matches where id = new.match_id;

  if tg_op = 'INSERT' then
    insert into public.notifications (user_id, type, payload)
    values (
      v_creator_id,
      'join_request_received',
      jsonb_build_object(
        'message', 'Hai ricevuto una nuova richiesta di partecipazione per ' || v_field_name,
        'match_id', new.match_id,
        'participant_user_id', new.user_id
      )
    );
  elsif tg_op = 'UPDATE' and new.status = 'approved' and old.status = 'requested' then
    insert into public.notifications (user_id, type, payload)
    values (
      new.user_id,
      'join_request_approved',
      jsonb_build_object('message', 'La tua richiesta per ' || v_field_name || ' è stata approvata', 'match_id', new.match_id)
    );
  elsif tg_op = 'UPDATE' and new.status = 'rejected' and old.status = 'requested' then
    insert into public.notifications (user_id, type, payload)
    values (
      new.user_id,
      'join_request_rejected',
      jsonb_build_object('message', 'La tua richiesta per ' || v_field_name || ' è stata rifiutata', 'match_id', new.match_id)
    );
  end if;

  return new;
end;
$$;

create trigger trg_notify_on_participant_change
  after insert or update on public.match_participants
  for each row execute function public.notify_on_participant_change();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase test db`
Expected: `006_notify_on_participant_change.test.sql .. ok`, all 3 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260830100600_notify_on_participant_change.sql supabase/tests/006_notify_on_participant_change.test.sql
git commit -m "feat: notify creator and participant on join-request lifecycle events"
```

---

### Task 8: `match_messages` — room chat with access control and notifications

**Files:**
- Create: `supabase/migrations/20260830100700_create_match_messages_table.sql`
- Create: `supabase/tests/007_match_messages.test.sql`

**Interfaces:**
- Consumes: `public.match_participants(match_id, user_id, status)` (Task 4), `public.matches(field_name)` (Task 3), `public.notifications` (Task 6).
- Produces: table `public.match_messages(id, match_id, sender_id, body, created_at)`.

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/007_match_messages.test.sql
begin;
select plan(6);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','creator@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','approved@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333','pending@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('33333333-3333-3333-3333-333333333333','+390000000003','Gino','Verdi','1992-01-01',170,'both','player');

insert into auth.users (id, email) values ('44444444-4444-4444-4444-444444444444','other-approved@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('44444444-4444-4444-4444-444444444444','+390000000004','Anna','Neri','1993-01-01',165,'right','player');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('55555555-5555-5555-5555-555555555555','11111111-1111-1111-1111-111111111111',5,'Campo Palermo','Via Roma 1',38.1157,13.3615,'2026-09-05','20:00','21:30',10);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
insert into public.match_participants (id, match_id, user_id, status)
values ('66666666-6666-6666-6666-666666666666','55555555-5555-5555-5555-555555555555','22222222-2222-2222-2222-222222222222','requested');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'approved' where id = '66666666-6666-6666-6666-666666666666';

select tests.authenticate_as('44444444-4444-4444-4444-444444444444');
insert into public.match_participants (id, match_id, user_id, status)
values ('88888888-8888-8888-8888-888888888888','55555555-5555-5555-5555-555555555555','44444444-4444-4444-4444-444444444444','requested');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'approved' where id = '88888888-8888-8888-8888-888888888888';

select tests.authenticate_as('33333333-3333-3333-3333-333333333333');
insert into public.match_participants (id, match_id, user_id, status)
values ('77777777-7777-7777-7777-777777777777','55555555-5555-5555-5555-555555555555','33333333-3333-3333-3333-333333333333','requested');

select throws_ok(
  $$ insert into public.match_messages (match_id, sender_id, body) values ('55555555-5555-5555-5555-555555555555','33333333-3333-3333-3333-333333333333','Ciao a tutti') $$,
  null,
  'a user with a pending (not approved) request cannot post in the room chat'
);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
insert into public.match_messages (id, match_id, sender_id, body)
values ('99999999-9999-9999-9999-999999999999','55555555-5555-5555-5555-555555555555','22222222-2222-2222-2222-222222222222','Ciao a tutti');

select is(
  (select count(*)::int from public.match_messages where match_id = '55555555-5555-5555-5555-555555555555'),
  1,
  'an approved participant can post in the room chat'
);

select tests.authenticate_as('33333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.match_messages where match_id = '55555555-5555-5555-5555-555555555555'),
  0,
  'a user with a pending request cannot read the room chat'
);

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.match_messages where match_id = '55555555-5555-5555-5555-555555555555'),
  0,
  'the creator cannot read the room chat before being an approved participant themselves'
);

select tests.authenticate_as('44444444-4444-4444-4444-444444444444');

select is(
  (select type from public.notifications where user_id = '44444444-4444-4444-4444-444444444444' order by created_at desc limit 1),
  'match_message',
  'another approved participant (distinct from the sender) is notified of a new room message'
);

select tests.authenticate_as('33333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.notifications where user_id = '33333333-3333-3333-3333-333333333333' and type = 'match_message'),
  0,
  'a pending (non-approved) user is not notified of room messages'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: FAIL — `relation "public.match_messages" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260830100700_create_match_messages_table.sql
create table public.match_messages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  sender_id uuid not null references public.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index match_messages_match_id_idx on public.match_messages (match_id, created_at);

alter table public.match_messages enable row level security;

grant select, insert on public.match_messages to authenticated;

create policy "match_messages_select_participants" on public.match_messages
  for select to authenticated using (
    exists (
      select 1 from public.match_participants mp
      where mp.match_id = match_messages.match_id
        and mp.user_id = auth.uid()
        and mp.status in ('approved','active','completed')
    )
  );

create policy "match_messages_insert_participants" on public.match_messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.match_participants mp
      where mp.match_id = match_messages.match_id
        and mp.user_id = auth.uid()
        and mp.status in ('approved','active','completed')
    )
  );

create or replace function public.notify_on_match_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_field_name text;
  v_recipient record;
begin
  select field_name into v_field_name from public.matches where id = new.match_id;

  for v_recipient in
    select user_id from public.match_participants
    where match_id = new.match_id
      and status in ('approved','active')
      and user_id <> new.sender_id
  loop
    insert into public.notifications (user_id, type, payload)
    values (
      v_recipient.user_id,
      'match_message',
      jsonb_build_object('message', 'Nuovo messaggio nella stanza di ' || v_field_name, 'match_id', new.match_id)
    );
  end loop;

  return new;
end;
$$;

create trigger trg_notify_on_match_message
  after insert on public.match_messages
  for each row execute function public.notify_on_match_message();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase test db`
Expected: `007_match_messages.test.sql .. ok`, all 6 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260830100700_create_match_messages_table.sql supabase/tests/007_match_messages.test.sql
git commit -m "feat: add match room chat restricted to approved participants, with notifications"
```

---

### Task 9: `friendships` — request/accept/reject with notification

**Files:**
- Create: `supabase/migrations/20260830100800_create_friendships_table.sql`
- Create: `supabase/tests/008_friendships.test.sql`

**Interfaces:**
- Consumes: `public.users(id, first_name, last_name)` (Task 2), `public.notifications` (Task 6).
- Produces: table `public.friendships(id, requester_id, receiver_id, status, created_at)`.

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/008_friendships.test.sql
begin;
select plan(7);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','mario@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','luca@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

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
  'the receiver cannot fabricate the request as having come from a different, uninvolved user while accepting it'
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: FAIL — `relation "public.friendships" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260830100800_create_friendships_table.sql
create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.users(id) on delete cascade,
  receiver_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  created_at timestamptz not null default now(),
  check (requester_id <> receiver_id)
);

create unique index friendships_unique_pair_idx on public.friendships (
  least(requester_id, receiver_id), greatest(requester_id, receiver_id)
);

create or replace function public.enforce_friendship_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.requester_id is distinct from old.requester_id then
    raise exception 'requester_id cannot be changed';
  end if;
  if new.receiver_id is distinct from old.receiver_id then
    raise exception 'receiver_id cannot be changed';
  end if;
  if old.status <> 'pending' then
    raise exception 'a friendship decision cannot be changed once made';
  end if;
  if new.status not in ('accepted','rejected') then
    raise exception 'a friendship request can only be accepted or rejected';
  end if;
  if auth.uid() is distinct from old.receiver_id then
    raise exception 'only the receiver can accept or reject a friend request';
  end if;
  return new;
end;
$$;

create trigger trg_enforce_friendship_transition
  before update on public.friendships
  for each row execute function public.enforce_friendship_transition();

create or replace function public.notify_on_friend_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requester_name text;
begin
  select first_name || ' ' || last_name into v_requester_name
  from public.users where id = new.requester_id;

  insert into public.notifications (user_id, type, payload)
  values (
    new.receiver_id,
    'friend_request_received',
    jsonb_build_object('message', v_requester_name || ' ti ha inviato una richiesta di amicizia', 'friendship_id', new.id)
  );
  return new;
end;
$$;

create trigger trg_notify_on_friend_request
  after insert on public.friendships
  for each row execute function public.notify_on_friend_request();

alter table public.friendships enable row level security;

grant select, insert, update on public.friendships to authenticated;

create policy "friendships_select_participants" on public.friendships
  for select to authenticated using (auth.uid() = requester_id or auth.uid() = receiver_id);

create policy "friendships_insert_as_requester" on public.friendships
  for insert to authenticated with check (auth.uid() = requester_id);

create policy "friendships_update_by_participants" on public.friendships
  for update to authenticated
  using (auth.uid() = requester_id or auth.uid() = receiver_id)
  with check (auth.uid() = requester_id or auth.uid() = receiver_id);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase test db`
Expected: `008_friendships.test.sql .. ok`, all 7 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260830100800_create_friendships_table.sql supabase/tests/008_friendships.test.sql
git commit -m "feat: add friendships with receiver-only accept/reject and notification"
```

---

### Task 10: `user_blocks`

**Files:**
- Create: `supabase/migrations/20260830100900_create_user_blocks_table.sql`
- Create: `supabase/tests/009_user_blocks.test.sql`

**Interfaces:**
- Consumes: `public.users(id)` (Task 2).
- Produces: table `public.user_blocks(id, blocker_id, blocked_id, created_at)`, consumed by Task 11's RLS policies.

- [ ] **Step 1: Write the failing test**

```sql
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: FAIL — `relation "public.user_blocks" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260830100900_create_user_blocks_table.sql
create table public.user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.users(id) on delete cascade,
  blocked_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

alter table public.user_blocks enable row level security;

grant select, insert, delete on public.user_blocks to authenticated;

create policy "user_blocks_select_own" on public.user_blocks
  for select to authenticated using (auth.uid() = blocker_id);

create policy "user_blocks_insert_own" on public.user_blocks
  for insert to authenticated with check (auth.uid() = blocker_id);

create policy "user_blocks_delete_own" on public.user_blocks
  for delete to authenticated using (auth.uid() = blocker_id);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase test db`
Expected: `009_user_blocks.test.sql .. ok`, all 4 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260830100900_create_user_blocks_table.sql supabase/tests/009_user_blocks.test.sql
git commit -m "feat: add user_blocks table"
```

---

### Task 11: `private_conversations` and `private_messages` — block-aware private chat

**Files:**
- Create: `supabase/migrations/20260830101000_create_private_messaging_tables.sql`
- Create: `supabase/tests/010_private_messaging.test.sql`

**Interfaces:**
- Consumes: `public.users(id, first_name)` (Task 2), `public.user_blocks` (Task 10), `public.notifications` (Task 6).
- Produces: table `public.private_conversations(id, user_a_id, user_b_id, created_at)`; table `public.private_messages(id, conversation_id, sender_id, body, read_at, created_at)`.

- [ ] **Step 1: Write the failing test**

```sql
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: FAIL — `relation "public.private_conversations" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260830101000_create_private_messaging_tables.sql
create table public.private_conversations (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references public.users(id) on delete cascade,
  user_b_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (user_a_id <> user_b_id)
);

create unique index private_conversations_unique_pair_idx on public.private_conversations (
  least(user_a_id, user_b_id), greatest(user_a_id, user_b_id)
);

alter table public.private_conversations enable row level security;

grant select, insert on public.private_conversations to authenticated;

create policy "private_conversations_select_participants" on public.private_conversations
  for select to authenticated using (auth.uid() = user_a_id or auth.uid() = user_b_id);

create policy "private_conversations_insert_participant_no_block" on public.private_conversations
  for insert to authenticated with check (
    (auth.uid() = user_a_id or auth.uid() = user_b_id)
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = user_a_id and b.blocked_id = user_b_id)
         or (b.blocker_id = user_b_id and b.blocked_id = user_a_id)
    )
  );

create table public.private_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.private_conversations(id) on delete cascade,
  sender_id uuid not null references public.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index private_messages_conversation_id_idx on public.private_messages (conversation_id, created_at);

alter table public.private_messages enable row level security;

grant select, insert, update on public.private_messages to authenticated;

create policy "private_messages_select_participants" on public.private_messages
  for select to authenticated using (
    exists (
      select 1 from public.private_conversations c
      where c.id = private_messages.conversation_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );

create policy "private_messages_insert_participant_no_block" on public.private_messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.private_conversations c
      where c.id = private_messages.conversation_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
        and not exists (
          select 1 from public.user_blocks b
          where (b.blocker_id = c.user_a_id and b.blocked_id = c.user_b_id)
             or (b.blocker_id = c.user_b_id and b.blocked_id = c.user_a_id)
        )
    )
  );

create policy "private_messages_update_read_receipt" on public.private_messages
  for update to authenticated
  using (
    sender_id is distinct from auth.uid()
    and exists (
      select 1 from public.private_conversations c
      where c.id = private_messages.conversation_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  )
  with check (true);

create or replace function public.protect_private_message_immutable_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.created_at is distinct from old.created_at
    or new.body is distinct from old.body
    or new.sender_id is distinct from old.sender_id
    or new.conversation_id is distinct from old.conversation_id
  then
    raise exception 'only read_at can be updated on a private message';
  end if;
  return new;
end;
$$;

create trigger trg_protect_private_message_immutable_fields
  before update on public.private_messages
  for each row execute function public.protect_private_message_immutable_fields();

create or replace function public.notify_on_private_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient_id uuid;
  v_sender_name text;
begin
  select case when user_a_id = new.sender_id then user_b_id else user_a_id end
  into v_recipient_id
  from public.private_conversations where id = new.conversation_id;

  select first_name into v_sender_name from public.users where id = new.sender_id;

  insert into public.notifications (user_id, type, payload)
  values (
    v_recipient_id,
    'private_message',
    jsonb_build_object('message', 'Nuovo messaggio da ' || v_sender_name, 'conversation_id', new.conversation_id)
  );
  return new;
end;
$$;

create trigger trg_notify_on_private_message
  after insert on public.private_messages
  for each row execute function public.notify_on_private_message();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase test db`
Expected: `010_private_messaging.test.sql .. ok`, all 7 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260830101000_create_private_messaging_tables.sql supabase/tests/010_private_messaging.test.sql
git commit -m "feat: add block-aware private conversations and messages with read receipts"
```

---

### Task 12: `match_invitations`

**Files:**
- Create: `supabase/migrations/20260830101100_create_match_invitations_table.sql`
- Create: `supabase/tests/011_match_invitations.test.sql`

**Interfaces:**
- Consumes: `public.matches(field_name)` (Task 3), `public.users(id, first_name)` (Task 2), `public.notifications` (Task 6).
- Produces: table `public.match_invitations(id, match_id, inviter_id, invitee_id, status, created_at)`.

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/011_match_invitations.test.sql
begin;
select plan(8);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','mario@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','luca@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111',5,'Campo Palermo','Via Roma 1',38.1157,13.3615,'2026-09-05','20:00','21:30',10);

select throws_ok(
  $$ insert into public.match_invitations (match_id, inviter_id, invitee_id) values ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111') $$,
  null,
  'a user cannot invite themselves'
);

insert into public.match_invitations (id, match_id, inviter_id, invitee_id)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select is(
  (select type from public.notifications where user_id = '22222222-2222-2222-2222-222222222222' order by created_at desc limit 1),
  'match_invitation',
  'the invitee is notified of the invitation'
);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
update public.match_invitations set status = 'viewed' where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select is(
  (select status from public.match_invitations where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'viewed',
  'the invitee can mark the invitation as viewed'
);

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('55555555-5555-5555-5555-555555555555','11111111-1111-1111-1111-111111111111',5,'Campo Mondello','Via Mare 2',38.0896,13.3854,'2026-09-06','19:00','20:30',12);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select throws_ok(
  $$ update public.match_invitations set match_id = '55555555-5555-5555-5555-555555555555' where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $$,
  'match_id cannot be changed',
  'an invitee cannot change the match_id of an invitation'
);

select throws_ok(
  $$ update public.match_invitations set inviter_id = '22222222-2222-2222-2222-222222222222' where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $$,
  'inviter_id cannot be changed',
  'an invitee cannot reassign who the invitation says invited them'
);

select throws_ok(
  $$ update public.match_invitations set invitee_id = '11111111-1111-1111-1111-111111111111' where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $$,
  'invitee_id cannot be changed',
  'the invitee cannot hand the invitation off to a different invitee'
);

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');

select throws_ok(
  $$ insert into public.match_invitations (match_id, inviter_id, invitee_id) values ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222') $$,
  null,
  'a duplicate invitation for the same match/invitee pair fails (same inviter, same invitee, so RLS allows the attempt and the unique index rejects it)'
);

select is(
  (select count(*)::int from public.match_participants where match_id = '44444444-4444-4444-4444-444444444444'),
  0,
  'an invitation never inserts a match_participants row on its own -- approval is still required separately'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: FAIL — `relation "public.match_invitations" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260830101100_create_match_invitations_table.sql
create table public.match_invitations (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  inviter_id uuid not null references public.users(id) on delete cascade,
  invitee_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'sent' check (status in ('sent','viewed','ignored')),
  created_at timestamptz not null default now(),
  unique (match_id, invitee_id),
  check (inviter_id <> invitee_id)
);

alter table public.match_invitations enable row level security;

grant select, insert, update on public.match_invitations to authenticated;

create policy "match_invitations_select_participants" on public.match_invitations
  for select to authenticated using (auth.uid() = inviter_id or auth.uid() = invitee_id);

create policy "match_invitations_insert_as_inviter" on public.match_invitations
  for insert to authenticated with check (auth.uid() = inviter_id);

create policy "match_invitations_update_as_invitee" on public.match_invitations
  for update to authenticated using (auth.uid() = invitee_id) with check (auth.uid() = invitee_id);

create or replace function public.protect_match_invitation_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- UPDATE: the row's identity columns are never caller-writable.
  if new.match_id is distinct from old.match_id then
    raise exception 'match_id cannot be changed';
  end if;
  if new.inviter_id is distinct from old.inviter_id then
    raise exception 'inviter_id cannot be changed';
  end if;
  if new.invitee_id is distinct from old.invitee_id then
    raise exception 'invitee_id cannot be changed';
  end if;

  return new;
end;
$$;

create trigger trg_protect_match_invitation_identity
  before update on public.match_invitations
  for each row execute function public.protect_match_invitation_identity();

create or replace function public.notify_on_match_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inviter_name text;
  v_field_name text;
begin
  select first_name into v_inviter_name from public.users where id = new.inviter_id;
  select field_name into v_field_name from public.matches where id = new.match_id;

  insert into public.notifications (user_id, type, payload)
  values (
    new.invitee_id,
    'match_invitation',
    jsonb_build_object('message', v_inviter_name || ' ti ha invitato a partecipare a una partita a ' || v_field_name, 'match_id', new.match_id)
  );
  return new;
end;
$$;

create trigger trg_notify_on_match_invitation
  after insert on public.match_invitations
  for each row execute function public.notify_on_match_invitation();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase test db`
Expected: `011_match_invitations.test.sql .. ok`, all 8 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260830101100_create_match_invitations_table.sql supabase/tests/011_match_invitations.test.sql
git commit -m "feat: add match_invitations, notifying the invitee without bypassing approval"
```

---

### Task 13: `reports` — minimal moderation for App Store compliance

**Files:**
- Create: `supabase/migrations/20260830101200_create_reports_table.sql`
- Create: `supabase/tests/012_reports.test.sql`

**Interfaces:**
- Consumes: `public.users(id)` (Task 2), `public.matches(id)` (Task 3).
- Produces: table `public.reports(id, reporter_id, reported_user_id, reported_match_id, reason, status, created_at)`. Reviewed manually via the Supabase dashboard (service role) — no admin UI in this plan.

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/012_reports.test.sql
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: FAIL — `relation "public.reports" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260830101200_create_reports_table.sql
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.users(id) on delete cascade,
  reported_user_id uuid references public.users(id) on delete cascade,
  reported_match_id uuid references public.matches(id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 1000),
  status text not null default 'open' check (status in ('open','reviewed','dismissed')),
  created_at timestamptz not null default now(),
  check (reported_user_id is not null or reported_match_id is not null)
);

alter table public.reports enable row level security;

grant select, insert on public.reports to authenticated;

create policy "reports_select_own" on public.reports
  for select to authenticated using (auth.uid() = reporter_id);

create policy "reports_insert_own" on public.reports
  for insert to authenticated with check (auth.uid() = reporter_id);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase test db`
Expected: `012_reports.test.sql .. ok`, all 4 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260830101200_create_reports_table.sql supabase/tests/012_reports.test.sql
git commit -m "feat: add reports table for App Store UGC moderation compliance"
```

---

### Task 14: `nearby_open_matches` — geolocation search RPC

**Files:**
- Create: `supabase/migrations/20260830101300_create_nearby_open_matches_function.sql`
- Create: `supabase/tests/013_nearby_open_matches.test.sql`

**Interfaces:**
- Consumes: `public.matches` (Task 3, uses the `location` geography column), `public.match_participants` (Task 4).
- Produces: function `public.nearby_open_matches(user_lat double precision, user_lng double precision, radius_km double precision default 20) returns table(id uuid, field_name text, match_type integer, match_date date, start_time time, end_time time, max_players integer, distance_km double precision, approved_players_count bigint)`, called by the mobile app via `supabase.rpc('nearby_open_matches', {...})`.

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/013_nearby_open_matches.test.sql
begin;
select plan(5);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','creator@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','player@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');

-- Palermo city center
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players, status)
values ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111',5,'Campo Vicino','Via Roma 1',38.1157,13.3615,'2026-09-05','20:00','21:30',10,'open');

-- Roughly 200km away (Naples)
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players, status)
values ('66666666-6666-6666-6666-666666666666','11111111-1111-1111-1111-111111111111',5,'Campo Lontano','Via Napoli 1',40.8518,14.2681,'2026-09-05','20:00','21:30',10,'open');

-- a draft match near Palermo should never show up regardless of radius
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players, status)
values ('77777777-7777-7777-7777-777777777777','11111111-1111-1111-1111-111111111111',5,'Campo Bozza','Via Bozza 1',38.1157,13.3615,'2026-09-05','20:00','21:30',10,'draft');

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
insert into public.match_participants (id, match_id, user_id, status)
values ('88888888-8888-8888-8888-888888888888','44444444-4444-4444-4444-444444444444','22222222-2222-2222-2222-222222222222','requested');

select is(
  (select count(*)::int from public.nearby_open_matches(38.1157, 13.3615, 20)),
  1,
  'searching with a 20km radius returns only the nearby open match'
);

select is(
  (select field_name from public.nearby_open_matches(38.1157, 13.3615, 20) limit 1),
  'Campo Vicino',
  'the nearby match is correctly identified'
);

select is(
  (select approved_players_count from public.nearby_open_matches(38.1157, 13.3615, 20) limit 1),
  0::bigint,
  'a merely requested (not yet approved) participant does not count toward approved_players_count'
);

select is(
  (select count(*)::int from public.nearby_open_matches(38.1157, 13.3615, 500)),
  2,
  'widening the radius to 500km also returns the far-away match, but never the draft one'
);

set local role anon;

select throws_ok(
  $$ select count(*) from public.nearby_open_matches(38.1157, 13.3615, 20) $$,
  null,
  'an unauthenticated (anon) caller cannot invoke nearby_open_matches at all'
);

reset role;

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: FAIL — `function public.nearby_open_matches(...) does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260830101300_create_nearby_open_matches_function.sql
create or replace function public.nearby_open_matches(
  user_lat double precision,
  user_lng double precision,
  radius_km double precision default 20
)
returns table (
  id uuid,
  field_name text,
  match_type integer,
  match_date date,
  start_time time,
  end_time time,
  max_players integer,
  distance_km double precision,
  approved_players_count bigint
)
language sql
stable
security definer
set search_path = 'extensions'
as $$
  select
    m.id,
    m.field_name,
    m.match_type,
    m.match_date,
    m.start_time,
    m.end_time,
    m.max_players,
    round((ST_Distance(m.location, ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography) / 1000)::numeric, 2)::double precision as distance_km,
    (select count(*) from public.match_participants mp where mp.match_id = m.id and mp.status in ('approved','active')) as approved_players_count
  from public.matches m
  where m.status = 'open'
    and ST_DWithin(m.location, ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography, radius_km * 1000)
  order by distance_km asc;
$$;

grant execute on function public.nearby_open_matches(double precision, double precision, double precision) to authenticated;

-- TWO INDEPENDENT mechanisms grant EXECUTE by default, and both must be closed or
-- anon keeps access via whichever one is left standing:
-- (1) vanilla Postgres implicitly grants EXECUTE to the PUBLIC pseudo-role at
--     CREATE FUNCTION time, unconditionally, for every role including anon;
-- (2) Supabase's own bootstrap ADDITIONALLY grants EXECUTE directly to
--     anon/authenticated/service_role via a default ACL owned by role `postgres`,
--     entirely independent of (1) (confirmed via pg_default_acl).
-- nearby_open_matches -- a directly callable SECURITY DEFINER function -- would
-- otherwise be callable by the fully unauthenticated `anon` role, letting a
-- signed-out caller search every open match. Same for is_fellow_participant()
-- (Task 4's RLS helper, also directly callable as a raw RPC, which would let anon
-- probe arbitrary match/user participation pairs). Revoke anon's access via BOTH
-- mechanisms for both functions (authenticated's access is intentional and stays),
-- and change both defaults going forward so Tasks 15-17's new functions don't
-- default to anon-accessible either.
revoke execute on function public.nearby_open_matches(double precision, double precision, double precision) from public, anon;
revoke execute on function public.is_fellow_participant(uuid, uuid) from public, anon;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase test db`
Expected: `013_nearby_open_matches.test.sql .. ok`, all 5 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260830101300_create_nearby_open_matches_function.sql supabase/tests/013_nearby_open_matches.test.sql
git commit -m "feat: add PostGIS-backed nearby_open_matches search RPC"
```

---

### Task 15: Notify participants on match cancellation, time or location change

**Files:**
- Create: `supabase/migrations/20260830101400_notify_on_match_lifecycle_change.sql`
- Create: `supabase/tests/014_notify_on_match_lifecycle_change.test.sql`

**Interfaces:**
- Consumes: `public.matches` (Task 3), `public.match_participants` (Task 4), `public.notifications` (Task 6).
- Produces: trigger `trg_notify_on_match_lifecycle_change` (internal only).

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/014_notify_on_match_lifecycle_change.test.sql
begin;
select plan(3);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','creator@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','player@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111',5,'Campo Palermo','Via Roma 1',38.1157,13.3615,'2026-09-05','20:00','21:30',10);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
insert into public.match_participants (id, match_id, user_id, status)
values ('55555555-5555-5555-5555-555555555555','44444444-4444-4444-4444-444444444444','22222222-2222-2222-2222-222222222222','requested');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'approved' where id = '55555555-5555-5555-5555-555555555555';

update public.matches set start_time = '21:00', end_time = '22:30' where id = '44444444-4444-4444-4444-444444444444';

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select is(
  (select type from public.notifications where user_id = '22222222-2222-2222-2222-222222222222' order by created_at desc limit 1),
  'match_time_changed',
  'an approved participant is notified when the match time changes'
);

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.matches set address = 'Via Nuova 5' where id = '44444444-4444-4444-4444-444444444444';

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select is(
  (select type from public.notifications where user_id = '22222222-2222-2222-2222-222222222222' order by created_at desc limit 1),
  'match_location_changed',
  'an approved participant is notified when the match address changes'
);

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.matches set status = 'cancelled' where id = '44444444-4444-4444-4444-444444444444';

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select is(
  (select type from public.notifications where user_id = '22222222-2222-2222-2222-222222222222' order by created_at desc limit 1),
  'match_cancelled',
  'an approved participant is notified when the match is cancelled'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: FAIL — first assertion returns `null` (no notification is created on a time change yet).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260830101400_notify_on_match_lifecycle_change.sql
create or replace function public.notify_on_match_lifecycle_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_participant record;
  v_message text;
  v_type text;
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    v_message := 'La partita a ' || new.field_name || ' è stata cancellata';
    v_type := 'match_cancelled';
  elsif new.start_time <> old.start_time or new.end_time <> old.end_time or new.match_date <> old.match_date then
    v_message := 'L''orario della partita a ' || new.field_name || ' è cambiato';
    v_type := 'match_time_changed';
  elsif new.address <> old.address then
    v_message := 'Il luogo della partita è cambiato: ' || new.field_name;
    v_type := 'match_location_changed';
  else
    return new;
  end if;

  for v_participant in
    select user_id from public.match_participants
    where match_id = new.id and status in ('approved','active')
  loop
    insert into public.notifications (user_id, type, payload)
    values (v_participant.user_id, v_type, jsonb_build_object('message', v_message, 'match_id', new.id));
  end loop;

  return new;
end;
$$;

create trigger trg_notify_on_match_lifecycle_change
  after update on public.matches
  for each row execute function public.notify_on_match_lifecycle_change();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase test db`
Expected: `014_notify_on_match_lifecycle_change.test.sql .. ok`, all 3 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260830101400_notify_on_match_lifecycle_change.sql supabase/tests/014_notify_on_match_lifecycle_change.test.sql
git commit -m "feat: notify approved participants on match cancellation, time, or location change"
```

---

### Task 16: Automatic match status transitions, completion counters, and reminders

**Files:**
- Create: `supabase/migrations/20260830101500_transition_match_statuses_and_cron.sql`
- Create: `supabase/tests/015_transition_match_statuses.test.sql`

**Interfaces:**
- Consumes: `public.matches` (Task 3), `public.match_participants` (Task 4), `public.users(matches_completed_count)` (Task 2), `public.notifications` (Task 6).
- Produces: function `public.transition_match_statuses() returns void`, scheduled every minute via `pg_cron`; column `public.matches.reminder_sent_at`.

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/015_transition_match_statuses.test.sql
begin;
select plan(5);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','creator@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','player@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');

insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players, status)
values ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111',5,'Campo Palermo','Via Roma 1',38.1157,13.3615, (current_date - 1), '20:00','21:30',10,'open');

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
insert into public.match_participants (id, match_id, user_id, status)
values ('55555555-5555-5555-5555-555555555555','44444444-4444-4444-4444-444444444444','22222222-2222-2222-2222-222222222222','requested');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'approved' where id = '55555555-5555-5555-5555-555555555555';
update public.match_participants set status = 'active' where id = '55555555-5555-5555-5555-555555555555';

-- transition_match_statuses() is a system-only function (invoked by pg_cron, which
-- runs as a superuser) and is deliberately never granted to `authenticated` -- an
-- ordinary signed-in user should not be able to force match completions/reminders
-- on demand. Simulate the cron caller by clearing authentication first.
select tests.clear_authentication();
select public.transition_match_statuses();

select is(
  (select status from public.matches where id = '44444444-4444-4444-4444-444444444444'),
  'completed',
  'a match whose end time has passed transitions to completed'
);

select is(
  (select status from public.match_participants where id = '55555555-5555-5555-5555-555555555555'),
  'completed',
  'an active participant is marked completed when the match completes'
);

select is(
  (select matches_completed_count from public.user_public_profiles where id = '22222222-2222-2222-2222-222222222222'),
  1,
  'the participant''s completed match counter is incremented'
);

insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players, status)
values ('66666666-6666-6666-6666-666666666666','11111111-1111-1111-1111-111111111111',5,'Campo Imminente','Via Roma 2',38.1157,13.3615, current_date, to_char(now() + interval '30 minutes', 'HH24:MI')::time, to_char(now() + interval '90 minutes', 'HH24:MI')::time, 10,'open');

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
insert into public.match_participants (id, match_id, user_id, status)
values ('66666666-6666-6666-6666-666666666666','66666666-6666-6666-6666-666666666666','22222222-2222-2222-2222-222222222222','requested');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'approved' where id = '66666666-6666-6666-6666-666666666666';

select tests.clear_authentication();
select public.transition_match_statuses();

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select is(
  (select type from public.notifications where user_id = '22222222-2222-2222-2222-222222222222' order by created_at desc limit 1),
  'match_reminder',
  'a reminder notification is sent when a match starts within the next hour'
);

select tests.clear_authentication();

select ok(
  exists(select 1 from cron.job where jobname = 'transition-match-statuses'),
  'the cron job is registered to run the transition function periodically'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: FAIL — `function public.transition_match_statuses() does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260830101500_transition_match_statuses_and_cron.sql
alter table public.matches add column reminder_sent_at timestamptz;

create or replace function public.transition_match_statuses()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match record;
  v_participant record;
begin
  for v_match in
    select id, field_name from public.matches
    where status in ('open','full')
      and reminder_sent_at is null
      and (match_date + start_time)::timestamptz <= now() + interval '1 hour'
      and (match_date + start_time)::timestamptz > now()
  loop
    for v_participant in
      select user_id from public.match_participants
      where match_id = v_match.id and status in ('approved','active')
    loop
      insert into public.notifications (user_id, type, payload)
      values (
        v_participant.user_id,
        'match_reminder',
        jsonb_build_object('message', 'La tua partita a ' || v_match.field_name || ' inizia tra meno di un''ora', 'match_id', v_match.id)
      );
    end loop;

    update public.matches set reminder_sent_at = now() where id = v_match.id;
  end loop;

  update public.matches
  set status = 'started'
  where status in ('open','full')
    and (match_date + start_time)::timestamptz <= now();

  for v_match in
    select id from public.matches
    where status = 'started'
      and (match_date + end_time)::timestamptz <= now()
  loop
    for v_participant in
      select user_id from public.match_participants
      where match_id = v_match.id and status in ('approved','active')
    loop
      update public.match_participants
      set status = 'completed'
      where match_id = v_match.id and user_id = v_participant.user_id;

      update public.users
      set matches_completed_count = matches_completed_count + 1
      where id = v_participant.user_id;
    end loop;

    update public.matches set status = 'completed' where id = v_match.id;
  end loop;
end;
$$;

-- Supabase's default ACL (see Task 14) grants EXECUTE on every new public-schema
-- function to authenticated/anon by default. This function is system-only -- it
-- should run only via the pg_cron job below (which executes as a superuser and
-- bypasses grants entirely) -- so revoke both roles' default access explicitly;
-- an ordinary signed-in user must never be able to force match completions or
-- reminders on demand by calling this directly.
revoke execute on function public.transition_match_statuses() from public, authenticated, anon;

select cron.schedule(
  'transition-match-statuses',
  '* * * * *',
  $$ select public.transition_match_statuses(); $$
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase test db`
Expected: `015_transition_match_statuses.test.sql .. ok`, all 5 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260830101500_transition_match_statuses_and_cron.sql supabase/tests/015_transition_match_statuses.test.sql
git commit -m "feat: schedule automatic match status transitions, completion counters, and reminders"
```

---

### Task 17: Deliver push notifications via `pg_net`

**Files:**
- Create: `supabase/migrations/20260830101600_send_push_notifications.sql`
- Create: `supabase/tests/016_send_push_notifications.test.sql`

**Interfaces:**
- Consumes: `public.notifications` (Task 6, fires on every insert regardless of source), `public.user_push_tokens` (Task 6).
- Produces: trigger `trg_send_push_notification` (internal only). This is the final task in the plan — every notification-producing trigger from Tasks 7, 8, 9, 11, 12, 15, and 16 now results in an actual push delivery attempt.

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/016_send_push_notifications.test.sql
begin;
select plan(3);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','player@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

-- Deliberately not calling tests.authenticate_as here: this test exercises the
-- push-delivery trigger itself, not RLS. In production, notifications are only
-- ever inserted by other SECURITY DEFINER functions (Tasks 7/8/9/11/12/15/16),
-- never directly by an authenticated client (notifications has no insert grant
-- for `authenticated`), so the fixture inserts below run as the test's default
-- superuser role, matching how these rows are actually created.

select lives_ok(
  $$ insert into public.notifications (user_id, type, payload) values ('11111111-1111-1111-1111-111111111111', 'match_reminder', '{"message":"La tua partita inizia tra 1 ora"}'::jsonb) $$,
  'inserting a notification with no registered push token does not raise an error'
);

insert into public.user_push_tokens (user_id, push_token) values ('11111111-1111-1111-1111-111111111111', 'ExponentPushToken[test-token]');

select lives_ok(
  $$ insert into public.notifications (user_id, type, payload) values ('11111111-1111-1111-1111-111111111111', 'match_reminder', '{"message":"La tua partita inizia tra 1 ora"}'::jsonb) $$,
  'inserting a notification with a registered push token does not raise an error'
);

select ok(
  (select count(*) from net.http_request_queue) >= 1,
  'a push notification HTTP request is queued via pg_net'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: FAIL — third assertion fails, `net.http_request_queue` has 0 rows since nothing calls `net.http_post` yet.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260830101600_send_push_notifications.sql
create or replace function public.send_push_notification_for_new_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tokens text[];
begin
  select array_agg(push_token) into v_tokens
  from public.user_push_tokens
  where user_id = new.user_id;

  if v_tokens is null or array_length(v_tokens, 1) = 0 then
    return new;
  end if;

  perform net.http_post(
    url := 'https://exp.host/--/api/v2/push/send',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'to', v_tokens,
      'title', 'App Calcio',
      'body', coalesce(new.payload->>'message', 'Hai una nuova notifica'),
      'data', new.payload
    )
  );

  return new;
end;
$$;

create trigger trg_send_push_notification
  after insert on public.notifications
  for each row execute function public.send_push_notification_for_new_notification();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase test db`
Expected: `016_send_push_notifications.test.sql .. ok`, all 3 assertions pass.

- [ ] **Step 5: Run the full suite one last time**

Run: `supabase test db`
Expected: all 17 test files pass (`000_extensions.test.sql` through `016_send_push_notifications.test.sql`), 0 failures.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260830101600_send_push_notifications.sql supabase/tests/016_send_push_notifications.test.sql
git commit -m "feat: deliver push notifications to Expo via pg_net on every notification insert"
```

---

### Task 18: Post-final-review hardening

The final whole-branch review (after all 17 tasks) found 2 Critical and several Important issues that only show up when looking at the whole schema together. This task fixes the ones that are cheap now and expensive after real data exists; see "Deferred to a follow-up" at the end for what's deliberately parked.

**Files:**
- Create: `supabase/migrations/20260830101700_final_review_hardening.sql`
- Create: `supabase/tests/017_final_review_hardening.test.sql`
- Modify: `supabase/tests/015_transition_match_statuses.test.sql` (fix a timezone-interpretation mismatch this task's own fix introduces into the existing reminder-window fixture)

**Findings fixed here:**

1. **[CRITICAL] `user_public_profiles` readable by unauthenticated `anon`, RLS fully bypassed.** Supabase's bootstrap grants `ALL` on every `public`-schema table/view to `anon`/`authenticated`/`service_role` by default — the same class of gap Task 14 found for functions, but nobody re-checked it for tables/views. The base `users` table is protected (RLS has no policy for `anon`, so it's correctly denied), but the view runs as its owner (`security_invoker = false`, by design, so it can show other users their non-phone fields despite the base table's owner-only policy) — which means it never re-checks `anon`'s standing at all. Fix: revoke `anon`'s (and `public`'s) access to the view outright; it should only ever be read by `authenticated`, which already has its own explicit grant.

2. **[CRITICAL] Match times are interpreted as UTC while users enter Italian local time.** `matches` stores a naive `date` + `time` with no timezone. `transition_match_statuses()` casts `(match_date + start_time)::timestamptz`, which resolves via the session's `TimeZone` — UTC on both local Supabase and hosted Supabase. A 20:00 kickoff entered by a Palermo user is read back as 20:00 UTC = 22:00 CEST, so every reminder fires an hour late, every match stays `open` for two extra hours after kickoff, and completion (and `matches_completed_count`) lands two hours late. Since the MVP is Italy-only, fix by interpreting stored times as `Europe/Rome` explicitly (`at time zone 'Europe/Rome'` instead of the bare `::timestamptz` cast) rather than adding a timezone column — the smallest correct fix for a single-market MVP. This also fixes a latent bug the review flagged: `matches_played_count` was never incremented anywhere (dead, always-zero column) — wire it up in the same completion loop as `matches_completed_count`, since for MVP purposes "completed" and "played" are the same event.

3. **[Important] Every server-derived column on `users` was client-writable via UPDATE.** `protect_users_row()` only guarded `unique_user_id`; `phone`, `created_at`, and all three `matches_*_count` columns could be rewritten directly by their own owner — and the counts are published to every other user through `user_public_profiles`, so this is a reputation-forgery vector, and `phone` drift/squatting risk. Extend the same trigger to pin all of them, the same pattern already used for `match_participants` (Task 4), `friendships` (Task 9), and `match_invitations` (Task 12).

4. **[Important] Blocking doesn't cover friend requests or match invitations.** The spec requires a blocked user to be unable to message the blocker; `private_messages`/`private_conversations` enforce this, but `friendships` and `match_invitations` have no block check at all, so a blocked user can still push a friend request or a match invitation (each generating an in-app notification and a push) at the person who blocked them — exactly the scenario App Store review will test. Add the same block-aware `not exists` check already used in `private_conversations_insert_participant_no_block` to both insert policies.

5. **[Important] A creator could delete a `completed` match, destroying its participants' history and any reports filed against it.** `matches_delete_creator_only` had no status restriction. Restrict deletion to matches that haven't started yet (`draft`/`open`/`full`/`cancelled`) — a creator can still cancel or remove a match before it happens, but can no longer erase what already happened.

6. **[Important] No way to unfriend, withdraw a pending friend request, or re-request after a rejection.** `friendships` had no DELETE grant at all, and `enforce_friendship_transition()` treats any non-`pending` status as terminal. All three gaps share one fix: let either party delete a friendship row in any state. Deleting an `accepted` row unfriends; deleting a `pending` row (as the requester) withdraws it; deleting a `rejected` row frees the unique pair index for a fresh request.

7. **[Important] `match_messages`/`private_messages` still use `now()` for `created_at`.** Same class of bug already fixed on `match_participant_events` (Task 5) and `notifications` (Task 6/8) — `now()` is frozen for the whole transaction, and these two columns are exactly the ones a chat client will paginate/order by. Switch both to `clock_timestamp()`.

8. **[Important] Missing indexes on FK/lookup columns used by RLS policies and obvious queries.** `match_participant_events.match_participant_id`, `match_participants.user_id`, `friendships.requester_id`/`receiver_id`, `match_invitations.invitee_id`, `matches.creator_id`, and the cron's own predicate (`matches(status, reminder_sent_at, match_date, start_time)`) have no supporting index — every RLS-filtered read and the once-a-minute cron sweep is a full scan.

9. **[Important, cheap defense-in-depth] `tests.authenticate_as`/`tests.clear_authentication` carry the same implicit-PUBLIC-grant-on-create gap Task 14 found for other functions.** They're only reachable today because `config.toml` doesn't expose the `tests` schema to PostgREST — but that's one config line away from changing. Revoke `public` (which also blocks `anon`) now; `authenticated` and `postgres` keep their access.

10. **[Important] Realtime is not configured for any table.** The spec's headline chat feature depends on Postgres Realtime, but nothing in this plan ever added `match_messages`, `private_messages`, or `notifications` to the `supabase_realtime` publication — subscriptions would silently receive zero events. Add all three.

**Deferred to a follow-up (not fixed here — see the final review's Minor list and Ledger Triage for full reasoning):** enforcing `max_players` / the `'full'` status (a product-completeness gap, not a security hole, and the fix touches Task 4's already-heavily-scrutinized state machine trigger — safer as its own reviewed change); `matches_abandoned_count` wiring (same reason — touches the same trigger); withdrawing a pending join request or revoking a sent invitation (new features, not bugs in what shipped); notification deletion and account deletion (spec features for a later plan, not part of this backend-foundation plan's scope); the `bare auth.uid()` → `(select auth.uid())` RLS performance rewrite across every policy (a mechanical, zero-risk-but-large perf pass better done as its own change); all Minor-severity findings (cascade edge cases, push-token hygiene, notification fan-out batching, etc.).

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/017_final_review_hardening.test.sql
begin;
select plan(8);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','mario@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','luca@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

select tests.clear_authentication();
set local role anon;

select throws_ok(
  $$ select count(*) from public.user_public_profiles $$,
  null,
  'anon can no longer read user_public_profiles at all'
);

reset role;
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');

select throws_ok(
  $$ update public.users set matches_completed_count = 9999 where id = '11111111-1111-1111-1111-111111111111' $$,
  'match statistics are server-managed and cannot be changed directly',
  'a user cannot forge their own match statistics'
);

select throws_ok(
  $$ update public.users set phone = '+390000009999' where id = '11111111-1111-1111-1111-111111111111' $$,
  'phone cannot be changed directly; contact support to update your phone number',
  'a user cannot change their own phone number directly'
);

insert into public.user_blocks (blocker_id, blocked_id) values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');

select throws_ok(
  $$ insert into public.friendships (requester_id, receiver_id) values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222') $$,
  null,
  'a user cannot send a friend request to someone they blocked'
);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select throws_ok(
  $$ insert into public.friendships (requester_id, receiver_id) values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111') $$,
  null,
  'a blocked user cannot send a friend request to the person who blocked them'
);

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
delete from public.user_blocks where blocker_id = '11111111-1111-1111-1111-111111111111' and blocked_id = '22222222-2222-2222-2222-222222222222';

insert into public.friendships (id, requester_id, receiver_id)
values ('99999999-9999-9999-9999-999999999999','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
update public.friendships set status = 'rejected' where id = '99999999-9999-9999-9999-999999999999';
delete from public.friendships where id = '99999999-9999-9999-9999-999999999999';

insert into public.friendships (id, requester_id, receiver_id)
values ('88888888-8888-8888-8888-888888888888','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.friendships where requester_id = '11111111-1111-1111-1111-111111111111' and receiver_id = '22222222-2222-2222-2222-222222222222'),
  1,
  'a fresh friend request succeeds after the previous rejected one was deleted'
);

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players, status)
values ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111',5,'Campo Palermo','Via Roma 1',38.1157,13.3615,'2026-09-05','20:00','21:30',10,'completed');

select throws_ok(
  $$ delete from public.matches where id = '44444444-4444-4444-4444-444444444444' $$,
  null,
  'a creator cannot delete a match that has already completed'
);

select ok(
  exists(
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename in ('match_messages','private_messages','notifications')
  ),
  'match_messages, private_messages, and notifications are added to the realtime publication'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: FAIL — `anon` can still read `user_public_profiles`, the stat/phone updates don't raise, and the realtime/delete checks fail, since none of this migration exists yet.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260830101700_final_review_hardening.sql

-- 1. CRITICAL: stop anon from reading the public-profile view via Supabase's
-- default table/view grants, which the earlier tasks never revoked (only
-- function-level default grants were caught and fixed, in Task 14).
revoke all on public.user_public_profiles from anon;
revoke all on public.user_public_profiles from public;

-- 2. CRITICAL: interpret match_date/start_time/end_time as Europe/Rome local
-- time, not the session's UTC default -- this is a single-market (Italy) MVP,
-- so a fixed zone is the smallest correct fix. Also wires up
-- matches_played_count, which nothing was ever incrementing.
create or replace function public.transition_match_statuses()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match record;
  v_participant record;
begin
  for v_match in
    select id, field_name from public.matches
    where status in ('open','full')
      and reminder_sent_at is null
      and (match_date + start_time) at time zone 'Europe/Rome' <= now() + interval '1 hour'
      and (match_date + start_time) at time zone 'Europe/Rome' > now()
  loop
    for v_participant in
      select user_id from public.match_participants
      where match_id = v_match.id and status in ('approved','active')
    loop
      insert into public.notifications (user_id, type, payload)
      values (
        v_participant.user_id,
        'match_reminder',
        jsonb_build_object('message', 'La tua partita a ' || v_match.field_name || ' inizia tra meno di un''ora', 'match_id', v_match.id)
      );
    end loop;

    update public.matches set reminder_sent_at = now() where id = v_match.id;
  end loop;

  update public.matches
  set status = 'started'
  where status in ('open','full')
    and (match_date + start_time) at time zone 'Europe/Rome' <= now();

  for v_match in
    select id from public.matches
    where status = 'started'
      and (match_date + end_time) at time zone 'Europe/Rome' <= now()
  loop
    for v_participant in
      select user_id from public.match_participants
      where match_id = v_match.id and status in ('approved','active')
    loop
      update public.match_participants
      set status = 'completed'
      where match_id = v_match.id and user_id = v_participant.user_id;

      update public.users
      set matches_completed_count = matches_completed_count + 1,
          matches_played_count = matches_played_count + 1
      where id = v_participant.user_id;
    end loop;

    update public.matches set status = 'completed' where id = v_match.id;
  end loop;
end;
$$;

-- 3. Pin every server-derived column on users, not just unique_user_id.
create or replace function public.protect_users_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.unique_user_id is distinct from old.unique_user_id then
    raise exception 'unique_user_id is immutable';
  end if;
  if new.phone is distinct from old.phone then
    raise exception 'phone cannot be changed directly; contact support to update your phone number';
  end if;
  if new.matches_played_count is distinct from old.matches_played_count
    or new.matches_completed_count is distinct from old.matches_completed_count
    or new.matches_abandoned_count is distinct from old.matches_abandoned_count
  then
    raise exception 'match statistics are server-managed and cannot be changed directly';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'created_at cannot be changed';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- 4. Block-aware friendships and match_invitations inserts.
alter policy "friendships_insert_as_requester" on public.friendships
  with check (
    auth.uid() = requester_id
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = requester_id and b.blocked_id = receiver_id)
         or (b.blocker_id = receiver_id and b.blocked_id = requester_id)
    )
  );

alter policy "match_invitations_insert_as_inviter" on public.match_invitations
  with check (
    auth.uid() = inviter_id
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = inviter_id and b.blocked_id = invitee_id)
         or (b.blocker_id = invitee_id and b.blocked_id = inviter_id)
    )
  );

-- 5. A creator can no longer delete a match that has already started or completed.
alter policy "matches_delete_creator_only" on public.matches
  using (auth.uid() = creator_id and status not in ('started','completed'));

-- 6. Let either party delete a friendship in any state: unfriend (accepted),
-- withdraw (pending), or clear a rejected row to allow a fresh request.
grant delete on public.friendships to authenticated;

create policy "friendships_delete_participant" on public.friendships
  for delete to authenticated using (auth.uid() = requester_id or auth.uid() = receiver_id);

-- 7. clock_timestamp(), not now(), for the two chat tables' created_at --
-- same fix already applied to match_participant_events and notifications.
alter table public.match_messages alter column created_at set default clock_timestamp();
alter table public.private_messages alter column created_at set default clock_timestamp();

-- 8. Indexes for RLS-filtered reads and the cron sweep.
create index match_participant_events_match_participant_id_idx on public.match_participant_events (match_participant_id);
create index match_participants_user_id_idx on public.match_participants (user_id);
create index friendships_requester_id_idx on public.friendships (requester_id);
create index friendships_receiver_id_idx on public.friendships (receiver_id);
create index match_invitations_invitee_id_idx on public.match_invitations (invitee_id);
create index matches_creator_id_idx on public.matches (creator_id);
create index matches_cron_sweep_idx on public.matches (status, reminder_sent_at, match_date, start_time);

-- 9. Same implicit-PUBLIC-grant-on-create gap Task 14 found, applied to the
-- test-only helpers -- defense in depth in case the `tests` schema is ever
-- exposed to PostgREST.
revoke execute on function tests.authenticate_as(uuid) from public;
revoke execute on function tests.clear_authentication() from public;

-- 10. Wire the chat/notification tables into Realtime.
alter publication supabase_realtime add table public.match_messages, public.private_messages, public.notifications;
```

Also fix the pre-existing `015_transition_match_statuses.test.sql`: its second fixture builds `start_time`/`end_time` from `to_char(now() + interval, 'HH24:MI')`, which is `now()` read in the session's UTC frame. Now that `transition_match_statuses()` interprets stored times as `Europe/Rome`, that fixture would be read back shifted by the UTC/CEST offset and the "starts within the next hour" assertion could flake. Fix by building the fixture in Rome's frame too:

```sql
-- in supabase/tests/015_transition_match_statuses.test.sql, replace the second
-- insert into public.matches (the "Campo Imminente" one) with:
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players, status)
values (
  '66666666-6666-6666-6666-666666666666','11111111-1111-1111-1111-111111111111',5,'Campo Imminente','Via Roma 2',38.1157,13.3615,
  current_date,
  to_char((now() + interval '30 minutes') at time zone 'Europe/Rome', 'HH24:MI')::time,
  to_char((now() + interval '90 minutes') at time zone 'Europe/Rome', 'HH24:MI')::time,
  10,'open'
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase test db`
Expected: `017_final_review_hardening.test.sql .. ok`, all 8 assertions pass; `015_transition_match_statuses.test.sql` still passes with the corrected fixture; full suite (18 files) green.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260830101700_final_review_hardening.sql supabase/tests/017_final_review_hardening.test.sql supabase/tests/015_transition_match_statuses.test.sql
git commit -m "fix: close post-final-review Critical/Important findings (anon profile leak, match timezone, forgeable stats, block-aware requests, unfriend, realtime)"
```

---

## What this plan does not cover (by design)

- Mobile app (React Native/Expo screens, navigation, Supabase client wiring) — a separate plan, since it depends on this backend existing and tested first.
- Configuring a real SMS provider (Twilio or similar) for OTP delivery — this requires the user to create an account with that provider themselves; Claude cannot do this on their behalf.
- Google Maps Platform API key provisioning — also requires the user to create a Google Cloud account and enable billing themselves.
- Formations, admin review UI, waitlist, advanced statistics — explicitly out of MVP scope per the spec's section 11.

## Self-review notes

- **Spec coverage:** every MVP database table from spec section 4 has a task (Tasks 2–13); every backend rule from spec section 5 has a task (Tasks 4, 9); the geolocation search from spec section 2/8 is Task 14; the notification pipeline from spec section 7 is Tasks 6, 7, 8, 9, 11, 12, 15, 16, 17; the App Store compliance note from spec section 8 is Task 13.
- **Placeholder scan:** no TBD/TODO markers; every step has runnable SQL and an exact command to run it.
- **Type consistency:** `match_participants.status`, `matches.status`, and `notifications.type` enums are defined once (Tasks 4, 3, 6 respectively) and referenced identically by value in every later task's SQL and tests — checked against each occurrence while writing this plan.
