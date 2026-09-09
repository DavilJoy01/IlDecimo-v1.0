# Storico pubblico partite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Storico partite" section to another user's profile screen (`people/user/[id].tsx`), listing their past completed matches (created or participated), and close a pre-existing privacy gap where blocked users could still read each other's profiles.

**Architecture:** Two new `security definer` RPCs (`get_user_profile`, `get_user_match_history`), reusing the already-existing `public.users_have_mutual_block` helper — no new blocking-check function is created. `useUserProfile` switches from a direct `user_public_profiles` query to the new `get_user_profile` RPC. A new `useUserMatchHistory` hook does cursor-based pagination. The screen gains a new section with infinite scroll inside its existing `ScrollView`.

**Tech Stack:** Supabase Postgres (`security definer` functions, pgTAP), React Native (Expo Router), Jest + `@testing-library/react-native`.

**Spec:** [docs/superpowers/specs/2026-09-09-storico-pubblico-design.md](../specs/2026-09-09-storico-pubblico-design.md)

## Global Constraints

- **Do NOT create a new blocking-check helper.** `public.users_have_mutual_block(p_user_a uuid, p_user_b uuid)` already exists (`supabase/migrations/20260830101700_final_review_hardening.sql`) and does exactly what this plan needs — both new RPCs call it directly.
- `get_user_profile` is declared `returns setof public.user_public_profiles` (a real SETOF, not the single-row-with-every-column-NULL pattern `search_user_by_code` uses) — a blocked/nonexistent target produces zero rows, which PostgREST serializes as an empty array. The mobile layer's `data?.[0] ?? null` handles this directly; no null-check-on-id trick needed.
- Match-history roles: `role='creator'` only for matches the target created with `status='completed'`; `role='participant'` only for `match_participants` rows with `status in ('completed','left')` whose match also has `status='completed'`. A created-but-cancelled match is excluded entirely (not shown with any status label) — this was an explicit user decision during brainstorming, not a default.
- Cursor pagination uses a 3-column tuple comparison `(match_date, start_time, match_id) < (before_date, before_time, before_id)` — never plain `offset`, which would skip/duplicate rows if a new match completed between page loads (not a concern for a single viewing session, but tuple comparison costs nothing extra and is the standard-correct approach).
- Follow this codebase's established error-translation pattern where relevant, but note neither new RPC needs one: a blocked/nonexistent target is a **silent empty result**, not a thrown error — this mirrors `search_user_by_code`'s "never reveal a block" principle, already established in the `persone` plan.
- Hook tests must follow `mobile/src/hooks/useFriends.test.ts`'s exact convention: `useSessionStore.setState({ session: ..., profile: ..., status: 'signed-in' })` against the real Zustand store, `jest.mock('@/api/<module>', () => ({ <named exports>: jest.fn() }))`, `await renderHook(...)`, every mutating call wrapped in `await act(async () => {...})`.
- No screen-level automated tests for `people/user/[id].tsx` — matches this codebase's established convention (no test file exists for it today). Verified by typecheck and this plan's own manual walkthrough.
- Design-system tokens (`colors`, `typography`, `spacing` from `@/theme`) are already used throughout this screen — the new history section must use them too, no raw hex/inline font values.

---

### Task 1: `get_user_profile` and `get_user_match_history` RPCs

**Files:**
- Create: `supabase/migrations/20260909000000_create_user_profile_and_history_rpcs.sql`
- Create: `supabase/tests/023_get_user_profile_and_history.test.sql`

**Interfaces:**
- Consumes: `public.users_have_mutual_block(uuid, uuid)` (pre-existing, no changes).
- Produces: `public.get_user_profile(target_id uuid) returns setof public.user_public_profiles`; `public.get_user_match_history(target_id uuid, before_date date default null, before_time time default null, before_id uuid default null, page_size int default 20) returns table (match_id uuid, role text, outcome text, match_type integer, field_name text, address text, match_date date, start_time time)`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260909000000_create_user_profile_and_history_rpcs.sql

-- Reuses the existing public.users_have_mutual_block (defined in
-- 20260830101700_final_review_hardening.sql, already used by
-- search_user_by_code) -- do not redefine it here.

create or replace function public.get_user_profile(target_id uuid)
returns setof public.user_public_profiles
language sql
stable
security definer
set search_path = ''
as $$
  select p.*
  from public.user_public_profiles p
  where p.id = target_id
    and not public.users_have_mutual_block(auth.uid(), target_id);
$$;

revoke all on function public.get_user_profile(uuid) from public;
grant execute on function public.get_user_profile(uuid) to authenticated;

create or replace function public.get_user_match_history(
  target_id uuid,
  before_date date default null,
  before_time time default null,
  before_id uuid default null,
  page_size int default 20
)
returns table (
  match_id uuid,
  role text,
  outcome text,
  match_type integer,
  field_name text,
  address text,
  match_date date,
  start_time time
)
language sql
stable
security definer
set search_path = ''
as $$
  with history as (
    select
      m.id as match_id,
      'creator'::text as role,
      m.status as outcome,
      m.match_type,
      m.field_name,
      m.address,
      m.match_date,
      m.start_time
    from public.matches m
    where m.creator_id = target_id
      and m.status = 'completed'

    union all

    select
      m.id as match_id,
      'participant'::text as role,
      mp.status as outcome,
      m.match_type,
      m.field_name,
      m.address,
      m.match_date,
      m.start_time
    from public.match_participants mp
    join public.matches m on m.id = mp.match_id
    where mp.user_id = target_id
      and mp.status in ('completed', 'left')
      and m.status = 'completed'
  )
  select *
  from history h
  where not public.users_have_mutual_block(auth.uid(), target_id)
    and (
      before_date is null
      or (h.match_date, h.start_time, h.match_id) < (before_date, before_time, before_id)
    )
  order by h.match_date desc, h.start_time desc, h.match_id desc
  limit page_size;
$$;

revoke all on function public.get_user_match_history(uuid, date, time, uuid, int) from public;
grant execute on function public.get_user_match_history(uuid, date, time, uuid, int) to authenticated;
```

- [ ] **Step 2: Write the pgTAP test**

```sql
-- supabase/tests/023_get_user_profile_and_history.test.sql
begin;
select plan(16);

-- TARGET: the person whose profile/history we look at.
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','target@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

-- VIEWER: calls the RPCs.
insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','viewer@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

-- BLOCKER: used for the block tests.
insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333','blocker@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('33333333-3333-3333-3333-333333333333','+390000000003','Gino','Verdi','1992-01-01',170,'both','player');

-- CREATOR: creates the matches TARGET participates in (never TARGET itself,
-- since a match's creator never has their own match_participants row).
insert into auth.users (id, email) values ('44444444-4444-4444-4444-444444444444','creator@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('44444444-4444-4444-4444-444444444444','+390000000004','Sara','Neri','1993-01-01',165,'right','player');

-- m1: TARGET created it, completed -- should appear, role=creator.
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',5,'Campo A','Via A 1',38.11,13.36,'2026-01-10','10:00','11:00',10);
update public.matches set status = 'completed' where id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- m2: TARGET created it, cancelled -- must be excluded entirely.
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',5,'Campo B','Via B 1',38.11,13.36,'2026-01-11','10:00','11:00',10);
update public.matches set status = 'cancelled' where id = 'aaaaaaaa-0000-0000-0000-000000000002';

-- m3: CREATOR's match, TARGET participated and completed it -- should appear.
select tests.authenticate_as('44444444-4444-4444-4444-444444444444');
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('aaaaaaaa-0000-0000-0000-000000000003','44444444-4444-4444-4444-444444444444',5,'Campo C','Via C 1',38.11,13.36,'2026-01-05','10:00','11:00',10);
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.match_participants (id, match_id, user_id, status)
values ('bbbbbbbb-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','requested');
select tests.authenticate_as('44444444-4444-4444-4444-444444444444');
update public.match_participants set status = 'approved' where id = 'bbbbbbbb-0000-0000-0000-000000000003';
update public.match_participants set status = 'completed' where id = 'bbbbbbbb-0000-0000-0000-000000000003';
update public.matches set status = 'completed' where id = 'aaaaaaaa-0000-0000-0000-000000000003';

-- m4: CREATOR's match, TARGET left before completion -- should appear.
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('aaaaaaaa-0000-0000-0000-000000000004','44444444-4444-4444-4444-444444444444',5,'Campo D','Via D 1',38.11,13.36,'2026-01-01','10:00','11:00',10);
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.match_participants (id, match_id, user_id, status)
values ('bbbbbbbb-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','requested');
select tests.authenticate_as('44444444-4444-4444-4444-444444444444');
update public.match_participants set status = 'approved' where id = 'bbbbbbbb-0000-0000-0000-000000000004';
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'left' where id = 'bbbbbbbb-0000-0000-0000-000000000004';
select tests.authenticate_as('44444444-4444-4444-4444-444444444444');
update public.matches set status = 'completed' where id = 'aaaaaaaa-0000-0000-0000-000000000004';

-- m5: CREATOR's match, TARGET only requested (never approved) -- excluded.
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('aaaaaaaa-0000-0000-0000-000000000005','44444444-4444-4444-4444-444444444444',5,'Campo E','Via E 1',38.11,13.36,'2026-01-06','10:00','11:00',10);
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.match_participants (id, match_id, user_id, status)
values ('bbbbbbbb-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111','requested');
select tests.authenticate_as('44444444-4444-4444-4444-444444444444');
update public.matches set status = 'completed' where id = 'aaaaaaaa-0000-0000-0000-000000000005';

-- m6: CREATOR's match, TARGET is 'active' but the match itself never
-- completed (still 'open') -- excluded (outcome not in completed/left AND
-- match not completed either -- covers the filter from both sides).
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('aaaaaaaa-0000-0000-0000-000000000006','44444444-4444-4444-4444-444444444444',5,'Campo F','Via F 1',38.11,13.36,'2026-01-07','10:00','11:00',10);
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.match_participants (id, match_id, user_id, status)
values ('bbbbbbbb-0000-0000-0000-000000000006','aaaaaaaa-0000-0000-0000-000000000006','11111111-1111-1111-1111-111111111111','requested');
select tests.authenticate_as('44444444-4444-4444-4444-444444444444');
update public.match_participants set status = 'approved' where id = 'bbbbbbbb-0000-0000-0000-000000000006';
update public.match_participants set status = 'active' where id = 'bbbbbbbb-0000-0000-0000-000000000006';

-- All read calls below are made as VIEWER (auth.uid() must not be TARGET,
-- to also implicitly confirm the RPCs work for a third party, not just self).
select tests.authenticate_as('22222222-2222-2222-2222-222222222222');

select is(
  (select id from public.get_user_profile('11111111-1111-1111-1111-111111111111')),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'get_user_profile returns the target row when there is no block'
);

select is(
  (select count(*)::int from public.get_user_match_history('11111111-1111-1111-1111-111111111111', null, null, null, 20)),
  3,
  'get_user_match_history returns exactly the 3 valid history entries (m1, m3, m4), excluding m2/m5/m6'
);

select is(
  (select role from public.get_user_match_history('11111111-1111-1111-1111-111111111111', null, null, null, 20) where match_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'creator',
  'm1 (created and completed) has role=creator'
);
select is(
  (select outcome from public.get_user_match_history('11111111-1111-1111-1111-111111111111', null, null, null, 20) where match_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'completed',
  'm1 (created and completed) has outcome=completed'
);

select is(
  (select role from public.get_user_match_history('11111111-1111-1111-1111-111111111111', null, null, null, 20) where match_id = 'aaaaaaaa-0000-0000-0000-000000000003'),
  'participant',
  'm3 (participated, completed) has role=participant'
);
select is(
  (select outcome from public.get_user_match_history('11111111-1111-1111-1111-111111111111', null, null, null, 20) where match_id = 'aaaaaaaa-0000-0000-0000-000000000003'),
  'completed',
  'm3 (participated, completed) has outcome=completed'
);

select is(
  (select role from public.get_user_match_history('11111111-1111-1111-1111-111111111111', null, null, null, 20) where match_id = 'aaaaaaaa-0000-0000-0000-000000000004'),
  'participant',
  'm4 (participated, left) has role=participant'
);
select is(
  (select outcome from public.get_user_match_history('11111111-1111-1111-1111-111111111111', null, null, null, 20) where match_id = 'aaaaaaaa-0000-0000-0000-000000000004'),
  'left',
  'm4 (participated, left) has outcome=left'
);

select is(
  (select count(*)::int from public.get_user_match_history('11111111-1111-1111-1111-111111111111', null, null, null, 20) where match_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  0,
  'm2 (created but cancelled) never appears'
);

select is(
  (select count(*)::int from public.get_user_match_history('11111111-1111-1111-1111-111111111111', null, null, null, 20) where match_id = 'aaaaaaaa-0000-0000-0000-000000000005'),
  0,
  'm5 (only requested, never approved) never appears'
);

select is(
  (select count(*)::int from public.get_user_match_history('11111111-1111-1111-1111-111111111111', null, null, null, 20) where match_id = 'aaaaaaaa-0000-0000-0000-000000000006'),
  0,
  'm6 (active in a match that never completed) never appears'
);

-- Pagination: page_size=2, ordered by match_date desc -- expect m1 (01-10)
-- then m3 (01-05) on the first page.
select is(
  (select array_agg(match_id order by match_date desc) from (select * from public.get_user_match_history('11111111-1111-1111-1111-111111111111', null, null, null, 2)) t),
  array['aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'aaaaaaaa-0000-0000-0000-000000000003'::uuid],
  'first page (page_size=2) returns m1 then m3, most recent first'
);

-- Second page, cursored on m3's own (match_date, start_time, match_id) --
-- expect only m4 (01-01), the sole remaining entry, no repeats/gaps.
select is(
  (select array_agg(match_id) from (select * from public.get_user_match_history('11111111-1111-1111-1111-111111111111', '2026-01-05'::date, '10:00'::time, 'aaaaaaaa-0000-0000-0000-000000000003'::uuid, 2)) t),
  array['aaaaaaaa-0000-0000-0000-000000000004'::uuid],
  'second page (cursored after m3) returns only m4, no duplicates or gaps'
);

-- Block tests: TARGET blocks BLOCKER. Confirms both directions and both RPCs.
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.user_blocks (blocker_id, blocked_id) values ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333');

select tests.authenticate_as('33333333-3333-3333-3333-333333333333');
select is(
  (select count(*)::int from public.get_user_profile('11111111-1111-1111-1111-111111111111')),
  0,
  'get_user_profile returns nothing when the caller was blocked by the target'
);

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
select is(
  (select count(*)::int from public.get_user_profile('33333333-3333-3333-3333-333333333333')),
  0,
  'get_user_profile returns nothing in the reverse direction (calling on someone you blocked)'
);

select tests.authenticate_as('33333333-3333-3333-3333-333333333333');
select is(
  (select count(*)::int from public.get_user_match_history('11111111-1111-1111-1111-111111111111', null, null, null, 20)),
  0,
  'get_user_match_history returns nothing when blocked'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Apply the migration and run the pgTAP test**

Run: `cd supabase && npx supabase db reset` (replays every migration from scratch), then `npx supabase test db`
Expected: the full pgTAP suite passes, including all 16 new assertions in `023_get_user_profile_and_history.test.sql`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260909000000_create_user_profile_and_history_rpcs.sql supabase/tests/023_get_user_profile_and_history.test.sql
git commit -m "$(cat <<'EOF'
feat: add get_user_profile and get_user_match_history RPCs

Both reuse the existing users_have_mutual_block helper to close a
pre-existing gap where blocked users could still read each other's
profiles.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `fetchUserProfile` and `fetchUserMatchHistory` in the data layer

**Files:**
- Modify: `mobile/src/api/users.ts`
- Test: `mobile/src/api/users.test.ts`

**Interfaces:**
- Consumes: `supabase` client (already imported in this file).
- Produces:
  ```ts
  export interface MatchHistoryEntry {
    match_id: string;
    role: 'creator' | 'participant';
    outcome: 'completed' | 'left';
    match_type: 5 | 7 | 8;
    field_name: string;
    address: string;
    match_date: string;
    start_time: string;
  }
  export async function fetchUserProfile(targetId: string): Promise<Record<string, unknown> | null>
  export async function fetchUserMatchHistory(targetId: string, cursor: { date: string; time: string; id: string } | null, pageSize?: number): Promise<MatchHistoryEntry[]>
  ```
  (`fetchUserProfile`'s return type is intentionally a loose object, not `TargetProfile` — that type is defined in `mobile/src/hooks/useUserProfile.ts`, which already casts the query result with `as TargetProfile`; this task does not change that cast or move the type, only what fetches the data.)

- [ ] **Step 1: Write the failing tests**

Append to `mobile/src/api/users.test.ts` (the file already exists from the `modifica-profilo` plan — add these as new `describe` blocks alongside the existing ones, keeping the existing `jest.mock('./supabase', ...)` factory but extending it to include `rpc`):

```ts
// Change the existing jest.mock('./supabase', ...) call at the top of the
// file from:
//   jest.mock('./supabase', () => ({ supabase: { from: jest.fn() } }));
// to:
//   jest.mock('./supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));
// (adds `rpc` alongside the existing `from` mock -- every existing test in
// this file that only used `.from` is unaffected.)

describe('fetchUserProfile', () => {
  it('calls the get_user_profile RPC and returns the first row', async () => {
    const row = { id: 'u2', unique_user_id: 'FC-100002', first_name: 'Luca' };
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: [row], error: null });

    const result = await fetchUserProfile('u2');

    expect(supabase.rpc).toHaveBeenCalledWith('get_user_profile', { target_id: 'u2' });
    expect(result).toEqual(row);
  });

  it('returns null when the RPC returns an empty array (blocked or nonexistent)', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: [], error: null });

    const result = await fetchUserProfile('u2');

    expect(result).toBeNull();
  });

  it('throws on an RPC error', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: { message: 'network error' } });

    await expect(fetchUserProfile('u2')).rejects.toThrow('network error');
  });
});

describe('fetchUserMatchHistory', () => {
  it('calls get_user_match_history with null cursor fields on the first page', async () => {
    const rows = [{ match_id: 'm1', role: 'creator', outcome: 'completed', match_type: 5, field_name: 'Campo A', address: 'Via A', match_date: '2026-01-10', start_time: '10:00' }];
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: rows, error: null });

    const result = await fetchUserMatchHistory('u2', null);

    expect(supabase.rpc).toHaveBeenCalledWith('get_user_match_history', {
      target_id: 'u2',
      before_date: null,
      before_time: null,
      before_id: null,
      page_size: 20,
    });
    expect(result).toEqual(rows);
  });

  it('passes the cursor fields and a custom page size on a later page', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: [], error: null });

    await fetchUserMatchHistory('u2', { date: '2026-01-05', time: '10:00', id: 'm3' }, 10);

    expect(supabase.rpc).toHaveBeenCalledWith('get_user_match_history', {
      target_id: 'u2',
      before_date: '2026-01-05',
      before_time: '10:00',
      before_id: 'm3',
      page_size: 10,
    });
  });

  it('throws on an RPC error', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: { message: 'network error' } });

    await expect(fetchUserMatchHistory('u2', null)).rejects.toThrow('network error');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile && npx jest src/api/users.test.ts`
Expected: FAIL — `fetchUserProfile`/`fetchUserMatchHistory` are not exported yet, and `supabase.rpc` doesn't exist on the mock yet (fix the mock in the same edit as Step 1's comment describes, before running this).

- [ ] **Step 3: Write the implementation**

Add to `mobile/src/api/users.ts`:

```ts
export interface MatchHistoryEntry {
  match_id: string;
  role: 'creator' | 'participant';
  outcome: 'completed' | 'left';
  match_type: 5 | 7 | 8;
  field_name: string;
  address: string;
  match_date: string;
  start_time: string;
}

export async function fetchUserProfile(targetId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.rpc('get_user_profile', { target_id: targetId });
  if (error) throw new Error(error.message);
  return (data?.[0] as Record<string, unknown>) ?? null;
}

export async function fetchUserMatchHistory(
  targetId: string,
  cursor: { date: string; time: string; id: string } | null,
  pageSize = 20
): Promise<MatchHistoryEntry[]> {
  const { data, error } = await supabase.rpc('get_user_match_history', {
    target_id: targetId,
    before_date: cursor?.date ?? null,
    before_time: cursor?.time ?? null,
    before_id: cursor?.id ?? null,
    page_size: pageSize,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as MatchHistoryEntry[];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile && npx jest src/api/users.test.ts`
Expected: PASS, every test in the file (this plan's new ones plus every pre-existing test in it).

- [ ] **Step 5: Commit**

```bash
cd mobile
git add src/api/users.ts src/api/users.test.ts
git commit -m "$(cat <<'EOF'
feat: add fetchUserProfile and fetchUserMatchHistory to the data layer

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Switch `useUserProfile` to `fetchUserProfile`

**Files:**
- Modify: `mobile/src/hooks/useUserProfile.ts`
- Modify: `mobile/src/hooks/useUserProfile.test.ts`

**Interfaces:**
- Consumes: `fetchUserProfile` from `@/api/users` (Task 2).

- [ ] **Step 1: Update the test's mocking**

In `mobile/src/hooks/useUserProfile.test.ts`, replace:
```ts
import { supabase } from '@/api/supabase';
```
with:
```ts
import { fetchUserProfile } from '@/api/users';
```
Replace:
```ts
jest.mock('@/api/supabase', () => ({ supabase: { from: jest.fn() } }));
```
with:
```ts
jest.mock('@/api/users', () => ({ fetchUserProfile: jest.fn() }));
```
Replace the `mockProfileFetch` helper:
```ts
function mockProfileFetch() {
  (supabase.from as jest.Mock).mockReturnValue({
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({ data: targetProfile, error: null }),
      }),
    }),
  });
}
```
with:
```ts
function mockProfileFetch() {
  (fetchUserProfile as jest.Mock).mockResolvedValue(targetProfile);
}
```
No other test in the file references `supabase` directly (confirmed by reading the full file in this plan's own research) — every one of the 6 existing tests calls `mockProfileFetch()` and nothing else touches the old mock shape.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/hooks/useUserProfile.test.ts`
Expected: FAIL — `useUserProfile.ts` still calls `supabase.from(...)` directly, which the new mock no longer provides.

- [ ] **Step 3: Update the implementation**

In `mobile/src/hooks/useUserProfile.ts`, replace the import:
```ts
import { supabase } from '@/api/supabase';
```
with:
```ts
import { fetchUserProfile } from '@/api/users';
```
Replace the body of `load`'s try block:
```ts
    try {
      const { data: profileRow, error: profileError } = await supabase
        .from('user_public_profiles')
        .select('*')
        .eq('id', targetUserId)
        .single();
      if (profileError) throw new Error(profileError.message);
      setProfile(profileRow as TargetProfile);
      await refreshStatus();
    } catch (err) {
```
with:
```ts
    try {
      const profileRow = await fetchUserProfile(targetUserId);
      setProfile((profileRow as TargetProfile) ?? null);
      await refreshStatus();
    } catch (err) {
```
`profileRow` being `null` (blocked or nonexistent) now flows into `setProfile(null)` directly instead of `.single()` throwing a `PGRST116`-style error first — this is the exact same "Utente non trovato" outcome the screen already renders for `!profile`, just reached one step more directly. No screen change needed for this.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/hooks/useUserProfile.test.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `cd mobile && npm run typecheck && npm test`
Expected: both clean — no other file references the old direct-query shape this hook used.

- [ ] **Step 6: Commit**

```bash
cd mobile
git add src/hooks/useUserProfile.ts src/hooks/useUserProfile.test.ts
git commit -m "$(cat <<'EOF'
refactor: useUserProfile reads via get_user_profile RPC, closing the block gap

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `useUserMatchHistory` hook

**Files:**
- Create: `mobile/src/hooks/useUserMatchHistory.ts`
- Test: `mobile/src/hooks/useUserMatchHistory.test.ts`

**Interfaces:**
- Consumes: `fetchUserMatchHistory`, `type MatchHistoryEntry` from `@/api/users` (Task 2).
- Produces: `export function useUserMatchHistory(targetId: string)` returning `{ matches: MatchHistoryEntry[]; loading: boolean; loadingMore: boolean; error: string | null; hasMore: boolean; loadMore: () => Promise<void>; retry: () => Promise<void> }`

- [ ] **Step 1: Write the failing test**

```ts
// mobile/src/hooks/useUserMatchHistory.test.ts
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { useUserMatchHistory } from './useUserMatchHistory';
import { fetchUserMatchHistory } from '@/api/users';

jest.mock('@/api/users', () => ({ fetchUserMatchHistory: jest.fn() }));

const entry = (id: string, date: string) => ({
  match_id: id,
  role: 'creator' as const,
  outcome: 'completed' as const,
  match_type: 5 as const,
  field_name: 'Campo',
  address: 'Via Roma 1',
  match_date: date,
  start_time: '10:00',
});

describe('useUserMatchHistory', () => {
  beforeEach(() => jest.clearAllMocks());

  it('loads the first page on mount', async () => {
    const page = [entry('m1', '2026-01-10'), entry('m2', '2026-01-05')];
    (fetchUserMatchHistory as jest.Mock).mockResolvedValue(page);

    const { result } = await renderHook(() => useUserMatchHistory('u2'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchUserMatchHistory).toHaveBeenCalledWith('u2', null, 20);
    expect(result.current.matches).toEqual(page);
    expect(result.current.hasMore).toBe(false); // page shorter than PAGE_SIZE=20
    expect(result.current.error).toBeNull();
  });

  it('hasMore is true when the first page is exactly full', async () => {
    const fullPage = Array.from({ length: 20 }, (_, i) => entry(`m${i}`, '2026-01-10'));
    (fetchUserMatchHistory as jest.Mock).mockResolvedValue(fullPage);

    const { result } = await renderHook(() => useUserMatchHistory('u2'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasMore).toBe(true);
  });

  it('loadMore appends the next page using the last entry as cursor', async () => {
    const firstPage = Array.from({ length: 20 }, (_, i) => entry(`m${i}`, '2026-01-10'));
    const secondPage = [entry('m20', '2026-01-01')];
    (fetchUserMatchHistory as jest.Mock)
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage);

    const { result } = await renderHook(() => useUserMatchHistory('u2'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.loadMore();
    });

    const last = firstPage[firstPage.length - 1];
    expect(fetchUserMatchHistory).toHaveBeenCalledWith('u2', { date: last.match_date, time: last.start_time, id: last.match_id }, 20);
    expect(result.current.matches).toEqual([...firstPage, ...secondPage]);
    expect(result.current.hasMore).toBe(false);
  });

  it('sets an error and leaves already-loaded matches untouched when loadMore fails', async () => {
    const firstPage = Array.from({ length: 20 }, (_, i) => entry(`m${i}`, '2026-01-10'));
    (fetchUserMatchHistory as jest.Mock)
      .mockResolvedValueOnce(firstPage)
      .mockRejectedValueOnce(new Error('network error'));

    const { result } = await renderHook(() => useUserMatchHistory('u2'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.error).toBe('network error');
    expect(result.current.matches).toEqual(firstPage);
  });

  it('retry reloads the first page and clears a prior error', async () => {
    (fetchUserMatchHistory as jest.Mock).mockRejectedValueOnce(new Error('network error'));
    const { result } = await renderHook(() => useUserMatchHistory('u2'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('network error');

    (fetchUserMatchHistory as jest.Mock).mockResolvedValueOnce([entry('m1', '2026-01-10')]);
    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.matches).toEqual([entry('m1', '2026-01-10')]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/hooks/useUserMatchHistory.test.ts`
Expected: FAIL with "Cannot find module './useUserMatchHistory'"

- [ ] **Step 3: Write the implementation**

```ts
// mobile/src/hooks/useUserMatchHistory.ts
import { useCallback, useEffect, useState } from 'react';
import { fetchUserMatchHistory, type MatchHistoryEntry } from '@/api/users';

const PAGE_SIZE = 20;

export function useUserMatchHistory(targetId: string) {
  const [matches, setMatches] = useState<MatchHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchUserMatchHistory(targetId, null, PAGE_SIZE);
      setMatches(page);
      setHasMore(page.length === PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile caricare lo storico.');
    } finally {
      setLoading(false);
    }
  }, [targetId]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || matches.length === 0) return;
    setLoadingMore(true);
    setError(null);
    try {
      const last = matches[matches.length - 1];
      const page = await fetchUserMatchHistory(
        targetId,
        { date: last.match_date, time: last.start_time, id: last.match_id },
        PAGE_SIZE
      );
      setMatches((prev) => [...prev, ...page]);
      setHasMore(page.length === PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile caricare altre partite.');
    } finally {
      setLoadingMore(false);
    }
  }, [targetId, matches, loadingMore, hasMore]);

  useEffect(() => {
    load();
  }, [load]);

  return { matches, loading, loadingMore, error, hasMore, loadMore, retry: load };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/hooks/useUserMatchHistory.test.ts`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
cd mobile
git add src/hooks/useUserMatchHistory.ts src/hooks/useUserMatchHistory.test.ts
git commit -m "$(cat <<'EOF'
feat: add useUserMatchHistory hook with cursor pagination

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: "Storico partite" section on the user profile screen

**Files:**
- Modify: `mobile/app/(tabs)/people/user/[id].tsx`

**Interfaces:**
- Consumes: `useUserMatchHistory` (Task 4); `colors`, `typography`, `spacing` from `@/theme` (already imported in this file).

No automated test for this screen — matches this codebase's established no-screen-tests convention (confirmed: no test file exists for this screen today). Verified by typecheck and Task 6's manual walkthrough.

- [ ] **Step 1: Add the import and hook call**

In `mobile/app/(tabs)/people/user/[id].tsx`, change the existing `react-native` import line:
```tsx
import { View, Text, Pressable, TextInput, ActivityIndicator, StyleSheet, Alert, ScrollView, Image } from 'react-native';
```
to also pull in the scroll-event types used by Step 2 below:
```tsx
import { View, Text, Pressable, TextInput, ActivityIndicator, StyleSheet, Alert, ScrollView, Image, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
```
Add to the imports:
```tsx
import { useUserMatchHistory } from '@/hooks/useUserMatchHistory';
```
Add alongside the existing `useUserProfile(id)` call:
```tsx
  const { matches: historyMatches, loading: historyLoading, loadingMore: historyLoadingMore, error: historyError, hasMore: historyHasMore, loadMore: loadMoreHistory, retry: retryHistory } =
    useUserMatchHistory(id);
```

- [ ] **Step 2: Add a scroll handler for infinite scroll**

The screen's whole body is one `ScrollView` (see its `return` statement) — the history section lives inside it, not in a separate list, so infinite scroll is driven by the outer `ScrollView`'s own `onScroll`, not a nested `FlatList` (nesting a virtualized list inside a plain `ScrollView` is a well-known React Native anti-pattern). Add this function above the `return`:

```tsx
  function handleScroll({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
    const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
    if (distanceFromBottom < 200) loadMoreHistory();
  }
```

- [ ] **Step 3: Wire the scroll handler onto the existing `ScrollView`**

The screen's `return` currently starts:
```tsx
  return (
    <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + 24 }]}>
```
Change to:
```tsx
  return (
    <ScrollView
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 24 }]}
      onScroll={handleScroll}
      scrollEventThrottle={200}
    >
```

- [ ] **Step 4: Add the history section**

The screen's `ScrollView` currently ends with the moderation block, right before its closing tag:
```tsx
          <Pressable disabled={actionLoading} onPress={confirmBlock}>
            <Text style={styles.blockLink}>Blocca</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}
```
Add the new section right after that closing `)}` and before `</ScrollView>`:
```tsx
          <Pressable disabled={actionLoading} onPress={confirmBlock}>
            <Text style={styles.blockLink}>Blocca</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.historySection}>
        <Text style={styles.historyTitle}>Storico partite</Text>
        {historyLoading ? (
          <ActivityIndicator size="small" />
        ) : historyError && historyMatches.length === 0 ? (
          <View style={styles.historyErrorRow}>
            <Text style={styles.error}>{historyError}</Text>
            <Pressable style={withPressed(styles.retryButton)} onPress={retryHistory}>
              <Text style={styles.retryButtonText}>Riprova</Text>
            </Pressable>
          </View>
        ) : historyMatches.length === 0 ? (
          <Text style={styles.historyEmpty}>Nessuna partita nello storico.</Text>
        ) : (
          <>
            {historyMatches.map((entry) => (
              <View key={entry.match_id} style={styles.historyRow}>
                <View style={styles.historyRowHeader}>
                  <Text style={styles.historyDate}>
                    {new Date(`${entry.match_date}T${entry.start_time}`).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                    {' · '}
                    {entry.start_time.slice(0, 5)}
                  </Text>
                  <View style={styles.historyTypeBadge}>
                    <Text style={styles.historyTypeBadgeText}>{entry.match_type}</Text>
                  </View>
                </View>
                <Text style={styles.historyField}>{entry.field_name} — {entry.address}</Text>
                <Text style={styles.historyRole}>
                  {entry.role === 'creator'
                    ? 'Partita creata'
                    : entry.outcome === 'left'
                      ? 'Partecipante (uscito prima della fine)'
                      : 'Partecipante'}
                </Text>
              </View>
            ))}
            {historyLoadingMore && <ActivityIndicator size="small" style={styles.historyLoadingMore} />}
            {historyError && historyMatches.length > 0 && (
              <View style={styles.historyErrorRow}>
                <Text style={styles.error}>{historyError}</Text>
                <Pressable style={withPressed(styles.retryButton)} onPress={loadMoreHistory}>
                  <Text style={styles.retryButtonText}>Riprova</Text>
                </Pressable>
              </View>
            )}
            {!historyHasMore && <Text style={styles.historyEnd}>Fine dello storico.</Text>}
          </>
        )}
      </View>
    </ScrollView>
  );
}
```

- [ ] **Step 5: Add the new styles**

In the `StyleSheet.create` call at the bottom of the file, add these entries alongside the existing ones (right after `reportInput`):
```tsx
  historySection: { width: '100%', marginTop: spacing.spaceLg, gap: spacing.spaceSm },
  historyTitle: { ...typography.label, fontSize: 18, marginBottom: spacing.spaceXs },
  historyEmpty: { color: colors.muted, ...typography.body },
  historyRow: { borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusCard, padding: spacing.spaceSm, gap: 4 },
  historyRowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  historyDate: { color: colors.ink, ...typography.body },
  historyTypeBadge: { backgroundColor: colors.primaryTint, borderRadius: spacing.radiusPill, paddingHorizontal: spacing.spaceSm, paddingVertical: 2 },
  historyTypeBadgeText: { color: colors.primary, ...typography.caption },
  historyField: { color: colors.muted, ...typography.meta },
  historyRole: { color: colors.ink, ...typography.caption },
  historyLoadingMore: { marginTop: spacing.spaceSm },
  historyErrorRow: { alignItems: 'center', gap: spacing.spaceXs },
  retryButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: 8, paddingHorizontal: spacing.spaceMd },
  retryButtonText: { color: colors.onPrimary, ...typography.label, fontSize: 14 },
  historyEnd: { color: colors.muted, textAlign: 'center', ...typography.caption, marginTop: spacing.spaceXs },
```

- [ ] **Step 6: Run typecheck**

Run: `cd mobile && npm run typecheck`
Expected: clean.

- [ ] **Step 7: Run the full test suite**

Run: `cd mobile && npm test`
Expected: PASS, full suite green (no existing test touches this screen directly).

- [ ] **Step 8: Commit**

```bash
cd mobile
git add "app/(tabs)/people/user/[id].tsx"
git commit -m "$(cat <<'EOF'
feat: add Storico partite section to the user profile screen

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Manual verification

**Files:** none (manual walkthrough, no code changes)

- [ ] **Step 1: Run the full automated suite one more time**

Run: `cd mobile && npm run typecheck && npm test` and `cd supabase && npx supabase test db`
Expected: typecheck clean; full Jest suite green (prior total + this plan's new tests: 6 from Task 2 + 5 from Task 4 = 11 new tests, Task 3 modifies but doesn't add to `useUserProfile.test.ts`'s existing 5); full pgTAP suite green, including the 16 new assertions in `023_get_user_profile_and_history.test.sql`.

- [ ] **Step 2: Live walkthrough in the iOS Simulator**

Using two existing test users (call them A and B, neither blocked by the other):
1. As A, create a match, have it transition to `completed` (or set it directly via SQL for speed: `update matches set status='completed' where id=...`), then open B's profile from Persone and confirm "Storico partite" shows nothing yet for B (B has no history).
2. Set up one match B created-and-completed and one match B participated-in-and-completed directly via SQL (following this plan's own pgTAP data-setup pattern, adapted to real user ids), then reload B's profile and confirm both entries appear with the correct role label ("Partita creata" / "Partecipante"), correct date/time/type/field.
3. Set up one match B participated in and then left (`status='left'`) before completion; confirm it shows "Partecipante (uscito prima della fine)".
4. Confirm a match B created but that was cancelled does NOT appear anywhere in the list.
5. If reachable within the walkthrough's time budget, seed 21+ valid history entries for B via SQL and confirm scrolling to the bottom of the list triggers a second page load (a spinner briefly appears, more rows load) — otherwise, trust Task 4's automated pagination tests and Task 1's pgTAP cursor tests as sufficient coverage for this specific mechanic, since seeding 21 real matches live is disproportionate effort for a mechanic already covered at both the DB and hook level.
6. As A, block B, then try to open B's profile again: confirm the screen shows "Utente non trovato" (the existing not-found state), not a broken/blank screen — this is the new behavior from Task 3's RPC switch, previously blocking never affected the ability to view a profile at all.
7. Unblock B and confirm the profile (including history) becomes visible again.

- [ ] **Step 3: Clean up test data**

Any matches created directly via SQL for this walkthrough should be deleted afterward (`delete from matches where id in (...)`) to avoid polluting future sessions' match lists — unlike a profile-photo revision (harmless orphan) or a friendship (easily re-created), leftover fake matches would visibly clutter Home/Le mie partite for whichever test users were used.

- [ ] **Step 4: Update the SDD ledger**

Record the walkthrough's outcome (pass/fail, any bugs found and fixed) in `.superpowers/sdd/2026-09-09-storico-pubblico/progress.md`, following the same style as every prior plan's final manual-verification entry.
