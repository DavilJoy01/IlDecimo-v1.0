# Squadre partita Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a match's creator manually assign approved participants into two fixed teams ("Squadra A"/"Squadra B", capped at `match_type` players each) from the match detail screen, plus a "Dividi casualmente" button that redistributes everyone from scratch.

**Architecture:** One new nullable `team` column on `match_participants`, an extended version of the existing `enforce_participant_state_machine` trigger (adding a same-status branch for team-only updates, since the current trigger's `else` branch rejects any update that doesn't change `status`), and a new non-`security definer` RPC (`shuffle_match_teams`) for the random button — a single round-trip that avoids the transient over/under-capacity states a sequence of per-participant client calls would risk. The mobile layer adds two new API functions and extends the existing roster hook and match detail screen.

**Tech Stack:** Supabase Postgres (PL/pgSQL trigger extension, a plain SQL-permission RPC, pgTAP), React Native (Expo Router), Jest + `@testing-library/react-native`.

**Spec:** [docs/superpowers/specs/2026-09-10-squadre-partita-design.md](../specs/2026-09-10-squadre-partita-design.md)

## Global Constraints

- **Team assignment is creator-only, manual by default**, plus the shuffle button — never automatic on its own. Two fixed teams, labels `'A'`/`'B'` exactly (never localized/renamed at the DB level — the mobile layer maps these to "Squadra A"/"Squadra B" display strings).
- **Cap per team = `matches.match_type`** (5, 7, or 8) — enforced inside the trigger via a live count, not a static check constraint (it depends on sibling rows).
- **Leaving a match always clears `team` back to `null`** — enforced in the trigger's existing `status = 'left'` branch, not left to the client.
- **A single `UPDATE` can never change both `status` and `team` in the same call** — if a client attempts it, the trigger silently keeps `team` unchanged (not an error) — this is a deliberate simplification, not a bug, and Task 1's pgTAP test asserts this exact behavior.
- **`shuffle_match_teams` is deliberately NOT `security definer`** — it runs as the calling creator, so every row it touches still passes through `enforce_participant_state_machine` with the real `auth.uid()`, and the function only adds an early, clearer "are you the creator?" check before touching any row.
- No new RLS policies anywhere in this plan — `participants_update_self_or_creator` (already on `main`) already lets the creator update any row of their own match; the trigger is the only place that restricts *which* column changes are legal.
- Two existing test files must be extended, not recreated from scratch: `mobile/src/api/participants.test.ts` and `mobile/src/hooks/useMatchRoster.test.ts` — both already exist with several passing tests for other functions in the same files; read them before editing, and never remove or restructure their existing tests.
- `mobile/src/api/participants.ts`'s existing `jest.mock('./supabase', () => ({ supabase: { from: jest.fn() } }))` must gain `rpc: jest.fn()` (needed for `shuffleTeams`), without breaking any existing test that only used `.from`.

---

### Task 1: `team` column, extended trigger, and `shuffle_match_teams` RPC

**Files:**
- Create: `supabase/migrations/20260910000000_add_match_participant_teams.sql`
- Create: `supabase/tests/025_match_participant_teams.test.sql`

**Interfaces:**
- Produces: `match_participants.team` (`text`, nullable, `check (team in ('A','B'))`); `public.shuffle_match_teams(p_match_id uuid) returns void`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260910000000_add_match_participant_teams.sql

alter table public.match_participants
  add column team text check (team in ('A', 'B'));

create or replace function public.enforce_participant_state_machine()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator_id uuid;
  v_match_type integer;
  v_team_count integer;
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
    new.team := null;
    return new;
  end if;

  if new.match_id is distinct from old.match_id then
    raise exception 'match_id cannot be changed';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id cannot be changed';
  end if;

  select creator_id into v_creator_id from public.matches where id = old.match_id;

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
    new.team := old.team;

  elsif new.status in ('approved','rejected') and old.status = 'requested' then
    if auth.uid() is distinct from v_creator_id then
      raise exception 'only the match creator can approve or reject a request';
    end if;
    if new.status = 'approved' then
      new.approved_at := now();
    end if;
    new.team := old.team;

  elsif new.status = 'active' and old.status = 'approved' then
    if auth.uid() is distinct from v_creator_id then
      raise exception 'only the match creator can activate a participant';
    end if;
    new.team := old.team;

  elsif new.status = 'left' and old.status in ('approved','active') then
    if auth.uid() is distinct from old.user_id then
      raise exception 'only the participant themselves can leave the match';
    end if;
    new.leave_count := old.leave_count + 1;
    new.left_at := now();
    new.team := null;

  elsif new.status = 'completed' and old.status in ('approved','active') then
    if auth.uid() is not null and auth.uid() is distinct from v_creator_id then
      raise exception 'only the match creator or the system can mark a participation completed';
    end if;
    new.team := old.team;

  elsif new.status = old.status then
    if new.team is distinct from old.team then
      if auth.uid() is distinct from v_creator_id then
        raise exception 'only the match creator can assign a team';
      end if;
      if old.status not in ('approved', 'active') then
        raise exception 'only an approved or active participant can be assigned a team';
      end if;
      if new.team is not null then
        select match_type into v_match_type from public.matches where id = old.match_id;
        select count(*) into v_team_count
        from public.match_participants
        where match_id = old.match_id and team = new.team and id <> old.id;
        if v_team_count >= v_match_type then
          raise exception 'team % is already full', new.team;
        end if;
      end if;
    end if;

  else
    raise exception 'invalid participation status transition from % to %', old.status, new.status;
  end if;

  return new;
end;
$$;

create or replace function public.shuffle_match_teams(p_match_id uuid)
returns void
language plpgsql
as $$
declare
  v_creator_id uuid;
  v_match_type integer;
begin
  select creator_id, match_type into v_creator_id, v_match_type
  from public.matches where id = p_match_id;

  if v_creator_id is null then
    raise exception 'match not found';
  end if;
  if auth.uid() is distinct from v_creator_id then
    raise exception 'only the match creator can shuffle teams';
  end if;

  update public.match_participants
  set team = null
  where match_id = p_match_id and status in ('approved', 'active') and team is not null;

  with shuffled as (
    select id, row_number() over (order by random()) as rn
    from public.match_participants
    where match_id = p_match_id and status in ('approved', 'active')
  )
  update public.match_participants mp
  set team = case
    when shuffled.rn <= v_match_type then 'A'
    when shuffled.rn <= v_match_type * 2 then 'B'
    else null
  end
  from shuffled
  where mp.id = shuffled.id;
end;
$$;

revoke all on function public.shuffle_match_teams(uuid) from public;
grant execute on function public.shuffle_match_teams(uuid) to authenticated;
```

- [ ] **Step 2: Write the pgTAP test**

```sql
-- supabase/tests/025_match_participant_teams.test.sql
begin;
select plan(16);

-- CREATOR: creates both matches used below.
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','creator@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Creator','Test','1990-01-01',180,'right','player');

-- OUTSIDER: not the creator, used for the "not the creator" negative tests.
insert into auth.users (id, email) values ('99999999-9999-9999-9999-999999999999','outsider@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('99999999-9999-9999-9999-999999999999','+390000000099','Outsider','Test','1990-01-01',180,'right','player');

-- Match M: match_type=5, 6 approved participants (P1..P6) -- enough to fill
-- team A (5) and prove the 6th is rejected there, but succeeds on team B.
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',5,'Campo M','Via M 1',38.11,13.36,'2026-02-01','10:00','11:00',12);

-- P1..P6
insert into auth.users (id, email) values
  ('20000000-0000-0000-0000-000000000001','p1@example.com'),
  ('20000000-0000-0000-0000-000000000002','p2@example.com'),
  ('20000000-0000-0000-0000-000000000003','p3@example.com'),
  ('20000000-0000-0000-0000-000000000004','p4@example.com'),
  ('20000000-0000-0000-0000-000000000005','p5@example.com'),
  ('20000000-0000-0000-0000-000000000006','p6@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role) values
  ('20000000-0000-0000-0000-000000000001','+390000001001','P','One','1990-01-01',175,'right','player'),
  ('20000000-0000-0000-0000-000000000002','+390000001002','P','Two','1990-01-01',175,'right','player'),
  ('20000000-0000-0000-0000-000000000003','+390000001003','P','Three','1990-01-01',175,'right','player'),
  ('20000000-0000-0000-0000-000000000004','+390000001004','P','Four','1990-01-01',175,'right','player'),
  ('20000000-0000-0000-0000-000000000005','+390000001005','P','Five','1990-01-01',175,'right','player'),
  ('20000000-0000-0000-0000-000000000006','+390000001006','P','Six','1990-01-01',175,'right','player');

-- Insert each as 'requested' (as themselves), then approve as CREATOR.
select tests.authenticate_as('20000000-0000-0000-0000-000000000001');
insert into public.match_participants (id, match_id, user_id, status) values ('30000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','requested');
select tests.authenticate_as('20000000-0000-0000-0000-000000000002');
insert into public.match_participants (id, match_id, user_id, status) values ('30000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','requested');
select tests.authenticate_as('20000000-0000-0000-0000-000000000003');
insert into public.match_participants (id, match_id, user_id, status) values ('30000000-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','requested');
select tests.authenticate_as('20000000-0000-0000-0000-000000000004');
insert into public.match_participants (id, match_id, user_id, status) values ('30000000-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','requested');
select tests.authenticate_as('20000000-0000-0000-0000-000000000005');
insert into public.match_participants (id, match_id, user_id, status) values ('30000000-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000005','requested');
select tests.authenticate_as('20000000-0000-0000-0000-000000000006');
insert into public.match_participants (id, match_id, user_id, status) values ('30000000-0000-0000-0000-000000000006','aaaaaaaa-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000006','requested');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'approved' where match_id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- 1. Creator can assign an approved participant to team A.
update public.match_participants set team = 'A' where id = '30000000-0000-0000-0000-000000000001';
select is(
  (select team from public.match_participants where id = '30000000-0000-0000-0000-000000000001'),
  'A',
  'creator can assign an approved participant to team A'
);

-- 2. Fails if the caller is not the creator.
select tests.authenticate_as('99999999-9999-9999-9999-999999999999');
select throws_ok(
  $$update public.match_participants set team = 'B' where id = '30000000-0000-0000-0000-000000000002'$$,
  'P0001',
  'only the match creator can assign a team',
  'a non-creator cannot assign a team'
);

-- 3. Fails if the participant is not approved/active (still requested).
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into auth.users (id, email) values ('20000000-0000-0000-0000-000000000007','p7@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('20000000-0000-0000-0000-000000000007','+390000001007','P','Seven','1990-01-01',175,'right','player');
select tests.authenticate_as('20000000-0000-0000-0000-000000000007');
insert into public.match_participants (id, match_id, user_id, status) values ('30000000-0000-0000-0000-000000000007','aaaaaaaa-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000007','requested');
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
select throws_ok(
  $$update public.match_participants set team = 'A' where id = '30000000-0000-0000-0000-000000000007'$$,
  'P0001',
  'only an approved or active participant can be assigned a team',
  'cannot assign a team to a still-requested participant'
);

-- Fill team A to its match_type=5 cap: P1 is already in A, add P2..P4 (4 more, total 5).
update public.match_participants set team = 'A' where id = '30000000-0000-0000-0000-000000000002';
update public.match_participants set team = 'A' where id = '30000000-0000-0000-0000-000000000003';
update public.match_participants set team = 'A' where id = '30000000-0000-0000-0000-000000000004';
update public.match_participants set team = 'A' where id = '30000000-0000-0000-0000-000000000005';

-- 4. The 6th player fails to join team A (already full at match_type=5).
select throws_ok(
  $$update public.match_participants set team = 'A' where id = '30000000-0000-0000-0000-000000000006'$$,
  'P0001',
  'team A is already full',
  'a 6th player cannot join a full team A'
);

-- 5. The same 6th player succeeds on team B instead (per-team cap, not aggregate).
update public.match_participants set team = 'B' where id = '30000000-0000-0000-0000-000000000006';
select is(
  (select team from public.match_participants where id = '30000000-0000-0000-0000-000000000006'),
  'B',
  'the 6th player succeeds joining team B instead (cap is per-team)'
);

-- 6. team clears to null automatically when status becomes 'left'.
select tests.authenticate_as('20000000-0000-0000-0000-000000000001');
update public.match_participants set status = 'left' where id = '30000000-0000-0000-0000-000000000001';
select is(
  (select team from public.match_participants where id = '30000000-0000-0000-0000-000000000001'),
  null,
  'team clears to null automatically when a participant leaves'
);

-- 7. A team-only update (status unchanged) now works -- this is the bug this
-- plan's own trigger change fixes (the old trigger's `else` branch rejected
-- any update where status didn't change).
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set team = 'B' where id = '30000000-0000-0000-0000-000000000003';
select is(
  (select team from public.match_participants where id = '30000000-0000-0000-0000-000000000003'),
  'B',
  'a team-only update (status unchanged) succeeds'
);

-- 8. Changing status AND team in the same call silently keeps team unchanged.
-- P7 must go through a VALID transition chain first (requested -> approved ->
-- left), since 'left' is only reachable from 'approved'/'active', not directly
-- from 'requested' -- then the re-request (left -> requested) is the one
-- transition whose branch already sets `new.team := old.team` explicitly, so
-- it's the natural place to prove a simultaneous team='A' attempt is ignored.
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'approved' where id = '30000000-0000-0000-0000-000000000007';
select tests.authenticate_as('20000000-0000-0000-0000-000000000007');
update public.match_participants set status = 'left' where id = '30000000-0000-0000-0000-000000000007';
-- Re-request (left -> requested) must be done by the participant themselves;
-- attempt to also set team='A' in the same call.
update public.match_participants set status = 'requested', team = 'A' where id = '30000000-0000-0000-0000-000000000007';
select is(
  (select team from public.match_participants where id = '30000000-0000-0000-0000-000000000007'),
  null,
  'changing status and team together silently keeps team unchanged (null here, from the left transition)'
);

-- 9. Removing an existing assignment (team: 'A' -> null) works.
update public.match_participants set team = null where id = '30000000-0000-0000-0000-000000000004';
select is(
  (select team from public.match_participants where id = '30000000-0000-0000-0000-000000000004'),
  null,
  'creator can remove an existing team assignment'
);

-- Match M2: match_type=5, 6 approved participants (Q1..Q6) + 1 requested + 1
-- rejected, used for shuffle_match_teams tests.
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',5,'Campo M2','Via M2 1',38.11,13.36,'2026-02-02','10:00','11:00',12);

insert into auth.users (id, email) values
  ('40000000-0000-0000-0000-000000000001','q1@example.com'),
  ('40000000-0000-0000-0000-000000000002','q2@example.com'),
  ('40000000-0000-0000-0000-000000000003','q3@example.com'),
  ('40000000-0000-0000-0000-000000000004','q4@example.com'),
  ('40000000-0000-0000-0000-000000000005','q5@example.com'),
  ('40000000-0000-0000-0000-000000000006','q6@example.com'),
  ('40000000-0000-0000-0000-000000000007','q7@example.com'),
  ('40000000-0000-0000-0000-000000000008','q8@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role) values
  ('40000000-0000-0000-0000-000000000001','+390000002001','Q','One','1990-01-01',175,'right','player'),
  ('40000000-0000-0000-0000-000000000002','+390000002002','Q','Two','1990-01-01',175,'right','player'),
  ('40000000-0000-0000-0000-000000000003','+390000002003','Q','Three','1990-01-01',175,'right','player'),
  ('40000000-0000-0000-0000-000000000004','+390000002004','Q','Four','1990-01-01',175,'right','player'),
  ('40000000-0000-0000-0000-000000000005','+390000002005','Q','Five','1990-01-01',175,'right','player'),
  ('40000000-0000-0000-0000-000000000006','+390000002006','Q','Six','1990-01-01',175,'right','player'),
  ('40000000-0000-0000-0000-000000000007','+390000002007','Q','Seven','1990-01-01',175,'right','player'),
  ('40000000-0000-0000-0000-000000000008','+390000002008','Q','Eight','1990-01-01',175,'right','player');

select tests.authenticate_as('40000000-0000-0000-0000-000000000001');
insert into public.match_participants (id, match_id, user_id, status) values ('50000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','requested');
select tests.authenticate_as('40000000-0000-0000-0000-000000000002');
insert into public.match_participants (id, match_id, user_id, status) values ('50000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','requested');
select tests.authenticate_as('40000000-0000-0000-0000-000000000003');
insert into public.match_participants (id, match_id, user_id, status) values ('50000000-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000003','requested');
select tests.authenticate_as('40000000-0000-0000-0000-000000000004');
insert into public.match_participants (id, match_id, user_id, status) values ('50000000-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000004','requested');
select tests.authenticate_as('40000000-0000-0000-0000-000000000005');
insert into public.match_participants (id, match_id, user_id, status) values ('50000000-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000005','requested');
select tests.authenticate_as('40000000-0000-0000-0000-000000000006');
insert into public.match_participants (id, match_id, user_id, status) values ('50000000-0000-0000-0000-000000000006','aaaaaaaa-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000006','requested');
select tests.authenticate_as('40000000-0000-0000-0000-000000000007');
insert into public.match_participants (id, match_id, user_id, status) values ('50000000-0000-0000-0000-000000000007','aaaaaaaa-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000007','requested');
select tests.authenticate_as('40000000-0000-0000-0000-000000000008');
insert into public.match_participants (id, match_id, user_id, status) values ('50000000-0000-0000-0000-000000000008','aaaaaaaa-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000008','requested');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'approved' where id in (
  '50000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000003',
  '50000000-0000-0000-0000-000000000004','50000000-0000-0000-0000-000000000005','50000000-0000-0000-0000-000000000006'
);
update public.match_participants set status = 'rejected' where id = '50000000-0000-0000-0000-000000000008';
-- 50000000-...07 stays 'requested'.

-- Pre-existing manual assignment before shuffling, to prove shuffle
-- redistributes from scratch rather than respecting it.
update public.match_participants set team = 'A' where id = '50000000-0000-0000-0000-000000000001';
update public.match_participants set team = 'A' where id = '50000000-0000-0000-0000-000000000002';

-- 10. shuffle_match_teams fails if the caller is not the creator.
select tests.authenticate_as('99999999-9999-9999-9999-999999999999');
select throws_ok(
  $$select public.shuffle_match_teams('aaaaaaaa-0000-0000-0000-000000000002')$$,
  'P0001',
  'only the match creator can shuffle teams',
  'shuffle_match_teams fails when called by a non-creator'
);

-- 11. shuffle_match_teams as the real creator succeeds and respects the cap.
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
select lives_ok(
  $$select public.shuffle_match_teams('aaaaaaaa-0000-0000-0000-000000000002')$$,
  'shuffle_match_teams runs successfully for the creator'
);

select ok(
  (select count(*) from public.match_participants where match_id = 'aaaaaaaa-0000-0000-0000-000000000002' and team = 'A') <= 5,
  'after shuffling, team A never exceeds match_type (5)'
);
select ok(
  (select count(*) from public.match_participants where match_id = 'aaaaaaaa-0000-0000-0000-000000000002' and team = 'B') <= 5,
  'after shuffling, team B never exceeds match_type (5)'
);

-- 12. All 6 approved participants end up on a team (6 <= 5*2, none left over).
select is(
  (select count(*)::int from public.match_participants where match_id = 'aaaaaaaa-0000-0000-0000-000000000002' and status = 'approved' and team is not null),
  6,
  'all 6 approved participants are assigned to a team after shuffling (6 fits within 2x5)'
);

-- 13. The requested and rejected participants were never touched by the shuffle.
select is(
  (select team from public.match_participants where id = '50000000-0000-0000-0000-000000000007'),
  null,
  'the still-requested participant is untouched by shuffle_match_teams'
);
select is(
  (select team from public.match_participants where id = '50000000-0000-0000-0000-000000000008'),
  null,
  'the rejected participant is untouched by shuffle_match_teams'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Apply the migration and run the pgTAP test**

Run: `cd supabase && export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"; npx supabase db reset`, then `npx supabase test db`
Expected: the full pgTAP suite passes, including all 16 new assertions in `025_match_participant_teams.test.sql`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260910000000_add_match_participant_teams.sql supabase/tests/025_match_participant_teams.test.sql
git commit -m "$(cat <<'EOF'
feat: add match_participants.team column, trigger support, and shuffle RPC

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `assignTeam`, `shuffleTeams`, and `team` in the data layer

**Files:**
- Modify: `mobile/src/api/participants.ts`
- Modify: `mobile/src/api/participants.test.ts`

**Interfaces:**
- Consumes: `supabase` client (already imported in this file).
- Produces:
  ```ts
  export interface ParticipantProfile {
    // ... existing fields unchanged ...
    team: 'A' | 'B' | null;
  }
  export async function assignTeam(participantId: string, team: 'A' | 'B' | null): Promise<void>
  export async function shuffleTeams(matchId: string): Promise<void>
  ```

- [ ] **Step 1: Update the `jest.mock` factory and existing `fetchMatchParticipantProfiles` tests**

In `mobile/src/api/participants.test.ts`, change:
```ts
jest.mock('./supabase', () => ({ supabase: { from: jest.fn() } }));
```
to:
```ts
jest.mock('./supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));
```

The existing `fetchMatchParticipantProfiles` tests select `'id, user_id, status'` from `match_participants` and assert on `ParticipantProfile` objects without a `team` field — both need updating for the new column. Replace the whole `describe('fetchMatchParticipantProfiles', ...)` block with:

```ts
  describe('fetchMatchParticipantProfiles', () => {
    it('joins match_participants rows with their public profiles', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'match_participants') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: [
                  { id: 'p1', user_id: 'u1', status: 'requested', team: null },
                  { id: 'p2', user_id: 'u2', status: 'approved', team: 'A' },
                ],
                error: null,
              }),
            }),
          };
        }
        if (table === 'user_public_profiles') {
          return {
            select: jest.fn().mockReturnValue({
              in: jest.fn().mockResolvedValue({
                data: [
                  { id: 'u1', first_name: 'Mario', last_name: 'Rossi', profile_image_url: null, unique_user_id: 'FC-1', player_role: 'player', preferred_foot: 'right' },
                  { id: 'u2', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null, unique_user_id: 'FC-2', player_role: 'goalkeeper', preferred_foot: 'left' },
                ],
                error: null,
              }),
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      });

      const result = await fetchMatchParticipantProfiles('m1');

      expect(result).toEqual([
        { participant_id: 'p1', user_id: 'u1', status: 'requested', team: null, first_name: 'Mario', last_name: 'Rossi', profile_image_url: null, unique_user_id: 'FC-1', player_role: 'player', preferred_foot: 'right' },
        { participant_id: 'p2', user_id: 'u2', status: 'approved', team: 'A', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null, unique_user_id: 'FC-2', player_role: 'goalkeeper', preferred_foot: 'left' },
      ]);
    });

    it('returns an empty array without querying profiles when there are no participants', async () => {
      const participantsEq = jest.fn().mockResolvedValue({ data: [], error: null });
      const fromMock = jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ eq: participantsEq }) });
      (supabase.from as jest.Mock).mockImplementation(fromMock);

      const result = await fetchMatchParticipantProfiles('m1');

      expect(result).toEqual([]);
      expect(fromMock).toHaveBeenCalledTimes(1);
      expect(fromMock).toHaveBeenCalledWith('match_participants');
    });

    it('throws the Supabase error message when the participants query fails', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: null, error: { message: 'participants failed' } }) }),
      });

      await expect(fetchMatchParticipantProfiles('m1')).rejects.toThrow('participants failed');
    });

    it('throws the Supabase error message when the profiles query fails', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'match_participants') {
          return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: [{ id: 'p1', user_id: 'u1', status: 'requested', team: null }], error: null }) }) };
        }
        return { select: jest.fn().mockReturnValue({ in: jest.fn().mockResolvedValue({ data: null, error: { message: 'profiles failed' } }) }) };
      });

      await expect(fetchMatchParticipantProfiles('m1')).rejects.toThrow('profiles failed');
    });
  });
```

- [ ] **Step 2: Write the failing tests for `assignTeam` and `shuffleTeams`**

Append to `mobile/src/api/participants.test.ts`, as new `describe` blocks alongside the existing ones (add `assignTeam, shuffleTeams` to the import list at the top of the file too):

```ts
  describe('assignTeam', () => {
    it('updates the participation row with the given team', async () => {
      const eq = jest.fn().mockResolvedValue({ error: null });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await assignTeam('p1', 'A');

      expect(supabase.from).toHaveBeenCalledWith('match_participants');
      expect(update).toHaveBeenCalledWith({ team: 'A' });
      expect(eq).toHaveBeenCalledWith('id', 'p1');
    });

    it('updates with team: null to remove an assignment', async () => {
      const eq = jest.fn().mockResolvedValue({ error: null });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await assignTeam('p1', null);

      expect(update).toHaveBeenCalledWith({ team: null });
    });

    it('translates the "team X is already full" trigger message into Italian', async () => {
      const eq = jest.fn().mockResolvedValue({ error: { message: 'team A is already full' } });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await expect(assignTeam('p1', 'A')).rejects.toThrow('La squadra è già al completo.');
    });

    it('throws the raw message for an unrelated error', async () => {
      const eq = jest.fn().mockResolvedValue({ error: { message: 'network error' } });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await expect(assignTeam('p1', 'A')).rejects.toThrow('network error');
    });
  });

  describe('shuffleTeams', () => {
    it('calls the shuffle_match_teams RPC with the match id', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });

      await shuffleTeams('m1');

      expect(supabase.rpc).toHaveBeenCalledWith('shuffle_match_teams', { p_match_id: 'm1' });
    });

    it('throws the Supabase error message on failure', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ error: { message: 'only the match creator can shuffle teams' } });

      await expect(shuffleTeams('m1')).rejects.toThrow('only the match creator can shuffle teams');
    });
  });
```

- [ ] **Step 3: Run tests to verify the new ones fail**

Run: `cd mobile && npx jest src/api/participants.test.ts`
Expected: FAIL — `assignTeam`/`shuffleTeams` are not exported yet, and the updated `fetchMatchParticipantProfiles` tests fail since `team` isn't selected/returned yet.

- [ ] **Step 4: Write the implementation**

In `mobile/src/api/participants.ts`, update the `ParticipantProfile` interface:
```ts
export interface ParticipantProfile {
  participant_id: string;
  user_id: string;
  status: ParticipantStatus;
  team: 'A' | 'B' | null;
  first_name: string;
  last_name: string;
  profile_image_url: string | null;
  unique_user_id: string;
  player_role: 'player' | 'goalkeeper' | 'both';
  preferred_foot: 'left' | 'right' | 'both';
}
```

In `fetchMatchParticipantProfiles`, change the `match_participants` select and the constructed result:
```ts
  const { data: participants, error: participantsError } = await supabase
    .from('match_participants')
    .select('id, user_id, status, team')
    .eq('match_id', matchId);
```
and, inside the loop building `result`:
```ts
    result.push({
      participant_id: p.id,
      user_id: p.user_id,
      status: p.status as ParticipantStatus,
      team: p.team as 'A' | 'B' | null,
      first_name: profile.first_name,
      last_name: profile.last_name,
      profile_image_url: profile.profile_image_url,
      unique_user_id: profile.unique_user_id,
      player_role: profile.player_role,
      preferred_foot: profile.preferred_foot,
    });
```

Add at the end of the file:
```ts
const TEAM_FULL_PATTERN = /^team [AB] is already full$/;

function translateTeamAssignmentError(message: string): string {
  if (TEAM_FULL_PATTERN.test(message)) {
    return 'La squadra è già al completo.';
  }
  return message;
}

export async function assignTeam(participantId: string, team: 'A' | 'B' | null): Promise<void> {
  const { error } = await supabase.from('match_participants').update({ team }).eq('id', participantId);
  if (error) throw new Error(translateTeamAssignmentError(error.message));
}

export async function shuffleTeams(matchId: string): Promise<void> {
  const { error } = await supabase.rpc('shuffle_match_teams', { p_match_id: matchId });
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd mobile && npx jest src/api/participants.test.ts`
Expected: PASS, every test in the file (this task's new ones plus every pre-existing test).

- [ ] **Step 6: Commit**

```bash
cd mobile
git add src/api/participants.ts src/api/participants.test.ts
git commit -m "$(cat <<'EOF'
feat: add assignTeam and shuffleTeams to the participants data layer

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `useMatchRoster` team grouping and actions

**Files:**
- Modify: `mobile/src/hooks/useMatchRoster.ts`
- Modify: `mobile/src/hooks/useMatchRoster.test.ts`

**Interfaces:**
- Consumes: `assignTeam`, `shuffleTeams` from `@/api/participants` (Task 2).
- Produces: `useMatchRoster` returns additionally `{ unassignedParticipants: ParticipantProfile[]; teamAParticipants: ParticipantProfile[]; teamBParticipants: ParticipantProfile[]; assignParticipantTeam: (participantId: string, team: 'A' | 'B' | null) => Promise<boolean>; shuffle: () => Promise<boolean> }`.

- [ ] **Step 1: Update the existing mock fixtures and add `team` to them**

In `mobile/src/hooks/useMatchRoster.test.ts`, the three existing fixture objects (`requested`, `approved`, `active`) are missing `preferred_foot` and now also need `team`. Replace them with:
```ts
const requested = { participant_id: 'p1', user_id: 'u1', status: 'requested' as const, team: null, first_name: 'Mario', last_name: 'Rossi', profile_image_url: null, unique_user_id: 'FC-1', player_role: 'player' as const, preferred_foot: 'right' as const };
const approved = { participant_id: 'p2', user_id: 'u2', status: 'approved' as const, team: null, first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null, unique_user_id: 'FC-2', player_role: 'goalkeeper' as const, preferred_foot: 'left' as const };
const active = { participant_id: 'p3', user_id: 'u3', status: 'active' as const, team: 'A' as const, first_name: 'Gino', last_name: 'Verdi', profile_image_url: null, unique_user_id: 'FC-3', player_role: 'both' as const, preferred_foot: 'both' as const };
```
And update `jest.mock('@/api/participants', ...)` to also mock the two new functions:
```ts
jest.mock('@/api/participants', () => ({
  fetchMatchParticipantProfiles: jest.fn(),
  approveParticipant: jest.fn(),
  rejectParticipant: jest.fn(),
  assignTeam: jest.fn(),
  shuffleTeams: jest.fn(),
}));
```
Add `assignTeam, shuffleTeams` to the `import { ... } from '@/api/participants';` line at the top.

- [ ] **Step 2: Write the failing tests for grouping and the two new actions**

Append to `mobile/src/hooks/useMatchRoster.test.ts`:

```ts
  it('groups approvedParticipants into unassigned/teamA/teamB by their team field', async () => {
    (fetchMatchParticipantProfiles as jest.Mock).mockResolvedValue([requested, approved, active]);

    const { result } = await renderHook(() => useMatchRoster('m1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.unassignedParticipants).toEqual([approved]);
    expect(result.current.teamAParticipants).toEqual([active]);
    expect(result.current.teamBParticipants).toEqual([]);
  });

  it('assignParticipantTeam calls assignTeam and refreshes', async () => {
    (fetchMatchParticipantProfiles as jest.Mock)
      .mockResolvedValueOnce([approved])
      .mockResolvedValueOnce([{ ...approved, team: 'A' }]);
    (assignTeam as jest.Mock).mockResolvedValue(undefined);

    const { result } = await renderHook(() => useMatchRoster('m1'));
    await waitFor(() => expect(result.current.unassignedParticipants).toEqual([approved]));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.assignParticipantTeam('p2', 'A');
    });

    expect(assignTeam).toHaveBeenCalledWith('p2', 'A');
    expect(success).toBe(true);
    expect(result.current.teamAParticipants).toEqual([{ ...approved, team: 'A' }]);
  });

  it('assignParticipantTeam sets an error and returns false on failure', async () => {
    (fetchMatchParticipantProfiles as jest.Mock).mockResolvedValue([approved]);
    (assignTeam as jest.Mock).mockRejectedValue(new Error('La squadra è già al completo.'));

    const { result } = await renderHook(() => useMatchRoster('m1'));
    await waitFor(() => expect(result.current.unassignedParticipants).toEqual([approved]));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.assignParticipantTeam('p2', 'A');
    });

    expect(success).toBe(false);
    expect(result.current.error).toBe('La squadra è già al completo.');
  });

  it('shuffle calls shuffleTeams with the match id and refreshes', async () => {
    (fetchMatchParticipantProfiles as jest.Mock)
      .mockResolvedValueOnce([approved, active])
      .mockResolvedValueOnce([{ ...approved, team: 'B' }, { ...active, team: 'A' }]);
    (shuffleTeams as jest.Mock).mockResolvedValue(undefined);

    const { result } = await renderHook(() => useMatchRoster('m1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.shuffle();
    });

    expect(shuffleTeams).toHaveBeenCalledWith('m1');
    expect(success).toBe(true);
    expect(result.current.teamAParticipants).toEqual([{ ...active, team: 'A' }]);
    expect(result.current.teamBParticipants).toEqual([{ ...approved, team: 'B' }]);
  });

  it('shuffle sets an error and returns false on failure', async () => {
    (fetchMatchParticipantProfiles as jest.Mock).mockResolvedValue([approved]);
    (shuffleTeams as jest.Mock).mockRejectedValue(new Error('only the match creator can shuffle teams'));

    const { result } = await renderHook(() => useMatchRoster('m1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.shuffle();
    });

    expect(success).toBe(false);
    expect(result.current.error).toBe('only the match creator can shuffle teams');
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd mobile && npx jest src/hooks/useMatchRoster.test.ts`
Expected: FAIL — `unassignedParticipants`/`teamAParticipants`/`teamBParticipants`/`assignParticipantTeam`/`shuffle` don't exist on the hook's return value yet.

- [ ] **Step 4: Write the implementation**

In `mobile/src/hooks/useMatchRoster.ts`, update the import line:
```ts
import {
  fetchMatchParticipantProfiles,
  approveParticipant,
  rejectParticipant,
  assignTeam,
  shuffleTeams,
  type ParticipantProfile,
} from '@/api/participants';
```

After the existing `const approvedParticipants = ...` line, add:
```ts
  const unassignedParticipants = approvedParticipants.filter((p) => !p.team);
  const teamAParticipants = approvedParticipants.filter((p) => p.team === 'A');
  const teamBParticipants = approvedParticipants.filter((p) => p.team === 'B');
```

After the existing `reject` function, add:
```ts
  async function assignParticipantTeam(participantId: string, team: 'A' | 'B' | null): Promise<boolean> {
    setActionLoading(true);
    setError(null);
    try {
      await assignTeam(participantId, team);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile assegnare la squadra.');
      return false;
    } finally {
      setActionLoading(false);
    }
  }

  async function shuffle(): Promise<boolean> {
    setActionLoading(true);
    setError(null);
    try {
      await shuffleTeams(matchId);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile dividere le squadre.');
      return false;
    } finally {
      setActionLoading(false);
    }
  }
```

Update the final `return` statement:
```ts
  return {
    pendingRequests,
    approvedParticipants,
    unassignedParticipants,
    teamAParticipants,
    teamBParticipants,
    loading,
    error,
    actionLoading,
    approve,
    reject,
    assignParticipantTeam,
    shuffle,
    refresh: load,
  };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd mobile && npx jest src/hooks/useMatchRoster.test.ts`
Expected: PASS, all tests in the file (this task's new ones plus every pre-existing test).

- [ ] **Step 6: Run the full test suite and typecheck**

Run: `cd mobile && npm run typecheck && npm test`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
cd mobile
git add src/hooks/useMatchRoster.ts src/hooks/useMatchRoster.test.ts
git commit -m "$(cat <<'EOF'
feat: group roster by team and add assignParticipantTeam/shuffle to useMatchRoster

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Team sections and shuffle button on the match detail screen

**Files:**
- Modify: `mobile/app/(tabs)/home/match/[id]/index.tsx`

**Interfaces:**
- Consumes: `unassignedParticipants`, `teamAParticipants`, `teamBParticipants`, `assignParticipantTeam`, `shuffle` from `useMatchRoster` (Task 3).

No automated test for this screen — matches this codebase's established no-screen-tests convention (confirmed: no test file exists for this screen today). Verified by typecheck and Task 5's manual walkthrough.

- [ ] **Step 1: Replace the "Partecipanti" section with three team sub-sections plus the shuffle button**

The screen currently has this block (around line 200):
```tsx
      {roster.approvedParticipants.length > 0 && (isCreator || myParticipation.participation?.status === 'approved' || myParticipation.participation?.status === 'active') && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Partecipanti</Text>
          {roster.approvedParticipants.map((profile) => (
            <ParticipantRow key={profile.participant_id} profile={profile} />
          ))}
        </View>
      )}
```
Replace it with:
```tsx
      {roster.approvedParticipants.length > 0 && (isCreator || myParticipation.participation?.status === 'approved' || myParticipation.participation?.status === 'active') && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Partecipanti</Text>

          {isCreator && (
            <Pressable style={withPressed(styles.shuffleButton)} disabled={roster.actionLoading} onPress={confirmShuffle}>
              <Text style={styles.shuffleButtonText}>🔀 Dividi casualmente</Text>
            </Pressable>
          )}

          {roster.teamAParticipants.length > 0 && (
            <View style={styles.teamGroup}>
              <Text style={styles.teamGroupTitle}>Squadra A</Text>
              {roster.teamAParticipants.map((profile) => (
                <ParticipantRow key={profile.participant_id} profile={profile}>
                  {isCreator && (
                    <View style={styles.teamChips}>
                      <Pressable
                        style={withPressed(styles.teamChipActive)}
                        disabled={roster.actionLoading}
                        onPress={() => roster.assignParticipantTeam(profile.participant_id, null)}
                      >
                        <Text style={styles.teamChipTextActive}>A</Text>
                      </Pressable>
                      <Pressable
                        style={withPressed(styles.teamChip)}
                        disabled={roster.actionLoading || roster.teamBParticipants.length >= match.match_type}
                        onPress={() => roster.assignParticipantTeam(profile.participant_id, 'B')}
                      >
                        <Text style={styles.teamChipText}>B</Text>
                      </Pressable>
                    </View>
                  )}
                </ParticipantRow>
              ))}
            </View>
          )}

          {roster.teamBParticipants.length > 0 && (
            <View style={styles.teamGroup}>
              <Text style={styles.teamGroupTitle}>Squadra B</Text>
              {roster.teamBParticipants.map((profile) => (
                <ParticipantRow key={profile.participant_id} profile={profile}>
                  {isCreator && (
                    <View style={styles.teamChips}>
                      <Pressable
                        style={withPressed(styles.teamChip)}
                        disabled={roster.actionLoading || roster.teamAParticipants.length >= match.match_type}
                        onPress={() => roster.assignParticipantTeam(profile.participant_id, 'A')}
                      >
                        <Text style={styles.teamChipText}>A</Text>
                      </Pressable>
                      <Pressable
                        style={withPressed(styles.teamChipActive)}
                        disabled={roster.actionLoading}
                        onPress={() => roster.assignParticipantTeam(profile.participant_id, null)}
                      >
                        <Text style={styles.teamChipTextActive}>B</Text>
                      </Pressable>
                    </View>
                  )}
                </ParticipantRow>
              ))}
            </View>
          )}

          <View style={styles.teamGroup}>
            <Text style={styles.teamGroupTitle}>Non assegnati</Text>
            {roster.unassignedParticipants.length === 0 ? (
              <Text style={styles.teamGroupEmpty}>Nessuno</Text>
            ) : (
              roster.unassignedParticipants.map((profile) => (
                <ParticipantRow key={profile.participant_id} profile={profile}>
                  {isCreator && (
                    <View style={styles.teamChips}>
                      <Pressable
                        style={withPressed(styles.teamChip)}
                        disabled={roster.actionLoading || roster.teamAParticipants.length >= match.match_type}
                        onPress={() => roster.assignParticipantTeam(profile.participant_id, 'A')}
                      >
                        <Text style={styles.teamChipText}>A</Text>
                      </Pressable>
                      <Pressable
                        style={withPressed(styles.teamChip)}
                        disabled={roster.actionLoading || roster.teamBParticipants.length >= match.match_type}
                        onPress={() => roster.assignParticipantTeam(profile.participant_id, 'B')}
                      >
                        <Text style={styles.teamChipText}>B</Text>
                      </Pressable>
                    </View>
                  )}
                </ParticipantRow>
              ))
            )}
          </View>
        </View>
      )}
```

- [ ] **Step 2: Add the `confirmShuffle` function**

Right after the existing `confirmLeave` function, add:
```tsx
  function confirmShuffle() {
    Alert.alert(
      'Dividi casualmente',
      'Questo rimescolerà casualmente tutte le squadre, sovrascrivendo eventuali assegnazioni già fatte. Continuare?',
      [
        { text: 'Annulla', style: 'cancel' },
        { text: 'Dividi', onPress: () => roster.shuffle() },
      ]
    );
  }
```

- [ ] **Step 3: Add the new styles**

In the `StyleSheet.create` call at the bottom of the file, add these entries right after `sectionTitle`:
```tsx
  shuffleButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: spacing.spaceXs, paddingHorizontal: spacing.spaceSm, alignSelf: 'flex-start', marginBottom: spacing.spaceXs },
  shuffleButtonText: { color: colors.onPrimary, ...typography.label },
  teamGroup: { marginTop: spacing.spaceSm, gap: 4 },
  teamGroupTitle: { ...typography.label, fontSize: 14, color: colors.muted },
  teamGroupEmpty: { color: colors.muted, ...typography.body },
  teamChips: { flexDirection: 'row', gap: spacing.spaceXs },
  teamChip: { borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusControl, paddingVertical: 4, paddingHorizontal: spacing.spaceSm },
  teamChipText: { color: colors.ink, ...typography.label, fontSize: 13 },
  teamChipActive: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: 4, paddingHorizontal: spacing.spaceSm },
  teamChipTextActive: { color: colors.onPrimary, ...typography.label, fontSize: 13 },
```

- [ ] **Step 4: Run typecheck**

Run: `cd mobile && npm run typecheck`
Expected: clean.

- [ ] **Step 5: Run the full test suite**

Run: `cd mobile && npm test`
Expected: PASS, full suite green (no existing test touches this screen directly).

- [ ] **Step 6: Commit**

```bash
cd mobile
git add "app/(tabs)/home/match/[id]/index.tsx"
git commit -m "$(cat <<'EOF'
feat: add team sections and shuffle button to the match detail screen

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Manual verification

**Files:** none (manual walkthrough, no code changes)

- [ ] **Step 1: Run the full automated suite one more time**

Run: `cd mobile && npm run typecheck && npm test` and `cd supabase && npx supabase test db`
Expected: typecheck clean; full Jest suite green (prior total + this plan's new tests: 6 from Task 2 (4 assignTeam + 2 shuffleTeams, the fetchMatchParticipantProfiles rewrite doesn't add new test count) + 5 from Task 3 = 11 new tests); full pgTAP suite green, including the 16 new assertions in `025_match_participant_teams.test.sql`.

- [ ] **Step 2: Live walkthrough in the iOS Simulator**

Using two existing test users (A = creator, B = an approved participant):
1. As A, create a match (`match_type=5`), have B request to join and approve them, plus create 4-5 more throwaway approved participants directly via SQL (following this plan's own pgTAP data-setup pattern, adapted to real user ids) so there's enough people to see the grouping clearly.
2. Open the match detail screen as A. Confirm the "Partecipanti" section now shows "Non assegnati" with everyone listed, each row with "A"/"B" chips.
3. Tap "A" on one participant's row — confirm they move to a new "Squadra A" group, and their chip UI updates (the "A" chip now looks active, tappable again to remove).
4. Tap "B" on another participant — confirm "Squadra B" appears.
5. Fill "Squadra A" up to `match_type` (5) participants; confirm the "A" chip becomes visually disabled on every remaining unassigned/Squadra-B row.
6. Tap "🔀 Dividi casualmente"; confirm the confirmation alert appears; confirm; confirm the whole roster re-shuffles (previous manual assignments are gone, replaced by a fresh random split respecting the 5-per-team cap).
7. As B (an approved participant, not the creator), open the same match detail screen: confirm the same three sections render correctly in read-only mode (no chips, no shuffle button).
8. As B, leave the match (if currently assigned to a team), then re-request and get re-approved by A: confirm B shows up back in "Non assegnati" (team was cleared on leave, per Global Constraints), not still on their old team.

- [ ] **Step 3: Clean up test data**

Delete any matches/throwaway participants created directly via SQL for this walkthrough, per this project's established convention of not leaving fake matches cluttering Home/Le mie partite for the test users used.

- [ ] **Step 4: Update the SDD ledger**

Record the walkthrough's outcome (pass/fail, any bugs found and fixed) in `.superpowers/sdd/2026-09-10-squadre-partita/progress.md`, following the same style as every prior plan's final manual-verification entry.
