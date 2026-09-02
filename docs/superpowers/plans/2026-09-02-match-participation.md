# Match Participation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated user request to join an open match, let the match's creator
approve or reject requests, show everyone in a match who else is in it, let a participant leave
(and re-request up to twice), and surface all of this through a real "Le mie partite" screen and
an in-app "Notifiche" list.

**Architecture:** Pure mobile work — the backend (`match_participants` state machine + RLS,
`notifications` + its auto-insert trigger, the `user_public_profiles` view) already supports
everything this plan needs, no new migrations. Adds two new API files
(`src/api/participants.ts`, `src/api/notifications.ts`), one small addition to the existing
`src/api/matches.ts`, four new hooks, one new shared presentational component
(`ParticipantRow`), one new screen (`notifications.tsx`), one screen extension
(`match/[id].tsx`), one screen rewrite (`my-matches/index.tsx` — today a placeholder), and a
small wiring change to the existing Home screen (a notifications bell with an unread badge).

**Tech Stack:** React Native + Expo Router (already in place — see
`docs/superpowers/plans/2026-08-31-mobile-app-foundation.md` and
`docs/superpowers/plans/2026-08-31-match-creation.md` for the foundation this builds on).

**Spec:** [docs/superpowers/specs/2026-09-02-match-participation-design.md](../specs/2026-09-02-match-participation-design.md)
(parent spec: [docs/superpowers/specs/2026-08-30-app-calcio-mvp-design.md](../specs/2026-08-30-app-calcio-mvp-design.md))

## Global Constraints

- `@testing-library/react-native@14.0.1`'s `renderHook` is `async` and returns a
  `Promise<RenderHookResult>` — every `renderHook(...)` call in this plan's tests is already
  written `await`ed; keep doing that for any test you add.
- `mobile/src/api/supabase.ts` imports `react-native-url-polyfill/auto`, an ESM package Jest's
  `transformIgnorePatterns` doesn't cover. Any test touching a module that imports `supabase.ts`
  (directly or transitively) must mock it via the factory form
  `jest.mock('./supabase', () => ({ supabase: { ... } }))` (or `@/api/supabase` depending on the
  importing file's relative path) — never import the real module unmocked in a test.
- `useSessionStore` (Zustand, `mobile/src/stores/sessionStore.ts`) does NOT import
  `supabase.ts` and is safe to import un-mocked in tests — set it up per-test with
  `useSessionStore.setState({ session: ..., profile: ..., status: ... })`.
- Postgres `time` columns (`matches.start_time`, `matches.end_time`) come back from Supabase as
  `"HH:MM:SS"` strings. Always `.slice(0, 5)` when displaying one (matches the convention
  `MatchCard.tsx`/`match/[id].tsx` already established).
- **`public.user_public_profiles`** (a view, not a table — see
  `supabase/migrations/20260830100100_create_users_table.sql`) is readable by **any**
  authenticated user for **any** other user (`grant select ... to authenticated`, no RLS beyond
  that — confirmed by `supabase/tests/001_users.test.sql`). It exposes exactly:
  `id, unique_user_id, first_name, last_name, birth_date, height_cm, preferred_foot,
  player_role, profile_image_url, matches_played_count, matches_completed_count,
  matches_abandoned_count`. It **never** exposes `phone` — the column does not exist on the
  view, selecting it is a query error, not a permissions error. Never query the base `users`
  table for another user's data; always go through this view.
- `public.match_participants` has a real foreign key `match_id references public.matches(id)`,
  so a single Supabase JS `.select('status, matches(*)')` embedded query works for it (PostgREST
  can auto-detect the relationship). `user_public_profiles` is a **view** with no FK PostgREST
  can discover from `match_participants.user_id`, so fetching participant profiles is
  necessarily **two separate queries** (fetch `match_participants` rows, then fetch
  `user_public_profiles` filtered by the resulting `user_id`s) merged client-side — never assume
  a single embedded select works for profiles.
- `match_participants.id` (the participation row's own id) and `match_participants.user_id`
  (the person) are different things used for different calls: `approveParticipant`,
  `rejectParticipant`, `leaveMatch`, and `reRequestToJoin` all take the **participation row id**
  (`participantId`), never the `user_id`. `requestToJoin` is the only mutation that takes
  `matchId` + `userId` directly, because no participation row exists yet to have an id.
  Confusing the two is a real bug class in this plan — every task below names its parameter
  precisely to avoid it.
- The `match_participants` state machine (trigger `enforce_participant_state_machine`,
  `supabase/migrations/20260830100300_create_match_participants_table.sql`) does **not** model
  a self-cancel of a pending request, nor a re-request after a `rejected` outcome. Any attempt
  hits `raise exception 'invalid participation status transition from % to %'`, surfaced to the
  UI as a raw Postgres error string — this is expected, not a bug to work around (see spec
  section 7). Only `left → requested` re-entry is modeled, and only up to `leave_count < 2`.
- Screens stay presentational; business logic (fetching, mutation, navigation-on-success) lives
  in hooks under `src/hooks/`, matching every existing screen in this codebase.
- No screen-level (component) tests exist anywhere in this codebase today (confirmed during
  match-creation's own final review). This plan follows that same precedent: `ParticipantRow`,
  `notifications.tsx`, `my-matches/index.tsx`, and `match/[id].tsx`'s new sections have no
  dedicated test files; their logic is covered by testing the hooks and API functions they call,
  plus manual end-to-end verification in the final task.
- Supabase JS chainable mocks in this codebase follow a specific nesting style — see
  `mobile/src/api/users.test.ts` for the canonical example (`{ select: jest.fn().mockReturnValue({
  eq: jest.fn().mockReturnValue({ single }) }) }`). Match that style exactly for any new test so
  mock shapes stay consistent project-wide. Where a function makes **two** separate `supabase.from(...)`
  calls (only `fetchMatchParticipantProfiles` in this plan), mock `supabase.from` with
  `mockImplementation((table) => ...)` switching on the table name, not a single
  `mockReturnValue`.
- Use the Node version pinned by `mobile/.nvmrc` (`24.13.0`) for any `npm`/`npx expo` command.

---

### Task 1: `src/api/participants.ts` — participation data layer

**Files:**
- Create: `mobile/src/api/participants.ts`
- Create: `mobile/src/api/participants.test.ts`

**Interfaces:**
- Consumes: `supabase` (`src/api/supabase.ts`), `Match` type (`src/api/matches.ts`, already
  exists).
- Produces: `ParticipantStatus`, `MyParticipation`, `ParticipantProfile`, `MyMatchParticipation`
  types; `requestToJoin`, `reRequestToJoin`, `leaveMatch`, `approveParticipant`,
  `rejectParticipant`, `fetchMyParticipation`, `fetchMatchParticipantProfiles`,
  `fetchMyParticipatingMatches` functions — all from `src/api/participants.ts`, consumed by
  Task 3 (`useMyParticipation`), Task 4 (`useMatchRoster`), and Task 6 (`useMyMatches`).

- [ ] **Step 1: Write the failing tests**

Create `mobile/src/api/participants.test.ts`:

```ts
// mobile/src/api/participants.test.ts
import { supabase } from './supabase';
import {
  requestToJoin,
  reRequestToJoin,
  leaveMatch,
  approveParticipant,
  rejectParticipant,
  fetchMyParticipation,
  fetchMatchParticipantProfiles,
  fetchMyParticipatingMatches,
} from './participants';

jest.mock('./supabase', () => ({ supabase: { from: jest.fn() } }));

describe('participants api', () => {
  afterEach(() => jest.clearAllMocks());

  describe('requestToJoin', () => {
    it('inserts a requested row for the given match and user', async () => {
      const insert = jest.fn().mockResolvedValue({ error: null });
      (supabase.from as jest.Mock).mockReturnValue({ insert });

      await requestToJoin('m1', 'u1');

      expect(supabase.from).toHaveBeenCalledWith('match_participants');
      expect(insert).toHaveBeenCalledWith([{ match_id: 'm1', user_id: 'u1', status: 'requested' }]);
    });

    it('throws the Supabase error message on failure', async () => {
      const insert = jest.fn().mockResolvedValue({ error: { message: 'insert failed' } });
      (supabase.from as jest.Mock).mockReturnValue({ insert });

      await expect(requestToJoin('m1', 'u1')).rejects.toThrow('insert failed');
    });
  });

  describe('reRequestToJoin', () => {
    it('updates the participation row back to requested', async () => {
      const eq = jest.fn().mockResolvedValue({ error: null });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await reRequestToJoin('p1');

      expect(supabase.from).toHaveBeenCalledWith('match_participants');
      expect(update).toHaveBeenCalledWith({ status: 'requested' });
      expect(eq).toHaveBeenCalledWith('id', 'p1');
    });

    it('throws the Supabase error message on failure (e.g. leave_count >= 2)', async () => {
      const eq = jest.fn().mockResolvedValue({ error: { message: 'maximum number of re-entries (2) reached for this match' } });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await expect(reRequestToJoin('p1')).rejects.toThrow('maximum number of re-entries (2) reached for this match');
    });
  });

  describe('leaveMatch', () => {
    it('updates the participation row to left', async () => {
      const eq = jest.fn().mockResolvedValue({ error: null });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await leaveMatch('p1');

      expect(update).toHaveBeenCalledWith({ status: 'left' });
      expect(eq).toHaveBeenCalledWith('id', 'p1');
    });

    it('throws the Supabase error message on failure', async () => {
      const eq = jest.fn().mockResolvedValue({ error: { message: 'leave failed' } });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await expect(leaveMatch('p1')).rejects.toThrow('leave failed');
    });
  });

  describe('approveParticipant', () => {
    it('updates the participation row to approved', async () => {
      const eq = jest.fn().mockResolvedValue({ error: null });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await approveParticipant('p1');

      expect(update).toHaveBeenCalledWith({ status: 'approved' });
      expect(eq).toHaveBeenCalledWith('id', 'p1');
    });

    it('throws the Supabase error message on failure', async () => {
      const eq = jest.fn().mockResolvedValue({ error: { message: 'approve failed' } });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await expect(approveParticipant('p1')).rejects.toThrow('approve failed');
    });
  });

  describe('rejectParticipant', () => {
    it('updates the participation row to rejected', async () => {
      const eq = jest.fn().mockResolvedValue({ error: null });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await rejectParticipant('p1');

      expect(update).toHaveBeenCalledWith({ status: 'rejected' });
      expect(eq).toHaveBeenCalledWith('id', 'p1');
    });

    it('throws the Supabase error message on failure', async () => {
      const eq = jest.fn().mockResolvedValue({ error: { message: 'reject failed' } });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await expect(rejectParticipant('p1')).rejects.toThrow('reject failed');
    });
  });

  describe('fetchMyParticipation', () => {
    it('selects the current user\'s own row for a match', async () => {
      const single = jest.fn().mockResolvedValue({
        data: { id: 'p1', status: 'approved', leave_count: 0 },
        error: null,
      });
      const eq2 = jest.fn().mockReturnValue({ single });
      const eq1 = jest.fn().mockReturnValue({ eq: eq2 });
      const select = jest.fn().mockReturnValue({ eq: eq1 });
      (supabase.from as jest.Mock).mockReturnValue({ select });

      const result = await fetchMyParticipation('m1', 'u1');

      expect(supabase.from).toHaveBeenCalledWith('match_participants');
      expect(select).toHaveBeenCalledWith('id, status, leave_count');
      expect(eq1).toHaveBeenCalledWith('match_id', 'm1');
      expect(eq2).toHaveBeenCalledWith('user_id', 'u1');
      expect(result).toEqual({ id: 'p1', status: 'approved', leave_count: 0 });
    });

    it('returns null when the user has never interacted with this match', async () => {
      const single = jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'no rows' } });
      const eq2 = jest.fn().mockReturnValue({ single });
      const eq1 = jest.fn().mockReturnValue({ eq: eq2 });
      const select = jest.fn().mockReturnValue({ eq: eq1 });
      (supabase.from as jest.Mock).mockReturnValue({ select });

      const result = await fetchMyParticipation('m1', 'u1');

      expect(result).toBeNull();
    });

    it('throws on a real error', async () => {
      const single = jest.fn().mockResolvedValue({ data: null, error: { code: '500', message: 'boom' } });
      const eq2 = jest.fn().mockReturnValue({ single });
      const eq1 = jest.fn().mockReturnValue({ eq: eq2 });
      const select = jest.fn().mockReturnValue({ eq: eq1 });
      (supabase.from as jest.Mock).mockReturnValue({ select });

      await expect(fetchMyParticipation('m1', 'u1')).rejects.toThrow('boom');
    });
  });

  describe('fetchMatchParticipantProfiles', () => {
    it('joins match_participants rows with their public profiles', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'match_participants') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: [
                  { id: 'p1', user_id: 'u1', status: 'requested' },
                  { id: 'p2', user_id: 'u2', status: 'approved' },
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
                  { id: 'u1', first_name: 'Mario', last_name: 'Rossi', profile_image_url: null, unique_user_id: 'FC-1', player_role: 'player' },
                  { id: 'u2', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null, unique_user_id: 'FC-2', player_role: 'goalkeeper' },
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
        { participant_id: 'p1', user_id: 'u1', status: 'requested', first_name: 'Mario', last_name: 'Rossi', profile_image_url: null, unique_user_id: 'FC-1', player_role: 'player' },
        { participant_id: 'p2', user_id: 'u2', status: 'approved', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null, unique_user_id: 'FC-2', player_role: 'goalkeeper' },
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
          return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: [{ id: 'p1', user_id: 'u1', status: 'requested' }], error: null }) }) };
        }
        return { select: jest.fn().mockReturnValue({ in: jest.fn().mockResolvedValue({ data: null, error: { message: 'profiles failed' } }) }) };
      });

      await expect(fetchMatchParticipantProfiles('m1')).rejects.toThrow('profiles failed');
    });
  });

  describe('fetchMyParticipatingMatches', () => {
    it('returns matches with their participation status via the embedded join', async () => {
      const inFn = jest.fn().mockResolvedValue({
        data: [{ status: 'approved', matches: { id: 'm1', field_name: 'Campo Test' } }],
        error: null,
      });
      const eq = jest.fn().mockReturnValue({ in: inFn });
      const select = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ select });

      const result = await fetchMyParticipatingMatches('u1');

      expect(supabase.from).toHaveBeenCalledWith('match_participants');
      expect(select).toHaveBeenCalledWith('status, matches(*)');
      expect(eq).toHaveBeenCalledWith('user_id', 'u1');
      expect(inFn).toHaveBeenCalledWith('status', ['requested', 'approved', 'active']);
      expect(result).toEqual([{ match: { id: 'm1', field_name: 'Campo Test' }, status: 'approved' }]);
    });

    it('throws the Supabase error message on failure', async () => {
      const inFn = jest.fn().mockResolvedValue({ data: null, error: { message: 'query failed' } });
      const eq = jest.fn().mockReturnValue({ in: inFn });
      const select = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ select });

      await expect(fetchMyParticipatingMatches('u1')).rejects.toThrow('query failed');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile && npm test -- participants.test.ts`
Expected: FAIL — `./participants` does not exist yet.

- [ ] **Step 3: Implement `src/api/participants.ts`**

```ts
// mobile/src/api/participants.ts
import { supabase } from './supabase';
import type { Match } from './matches';

export type ParticipantStatus = 'requested' | 'approved' | 'rejected' | 'active' | 'left' | 'completed';

export interface MyParticipation {
  id: string;
  status: ParticipantStatus;
  leave_count: number;
}

export interface ParticipantProfile {
  participant_id: string;
  user_id: string;
  status: ParticipantStatus;
  first_name: string;
  last_name: string;
  profile_image_url: string | null;
  unique_user_id: string;
  player_role: 'player' | 'goalkeeper' | 'both';
}

export interface MyMatchParticipation {
  match: Match;
  status: ParticipantStatus;
}

export async function requestToJoin(matchId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('match_participants')
    .insert([{ match_id: matchId, user_id: userId, status: 'requested' }]);
  if (error) throw new Error(error.message);
}

export async function reRequestToJoin(participantId: string): Promise<void> {
  const { error } = await supabase.from('match_participants').update({ status: 'requested' }).eq('id', participantId);
  if (error) throw new Error(error.message);
}

export async function leaveMatch(participantId: string): Promise<void> {
  const { error } = await supabase.from('match_participants').update({ status: 'left' }).eq('id', participantId);
  if (error) throw new Error(error.message);
}

export async function approveParticipant(participantId: string): Promise<void> {
  const { error } = await supabase.from('match_participants').update({ status: 'approved' }).eq('id', participantId);
  if (error) throw new Error(error.message);
}

export async function rejectParticipant(participantId: string): Promise<void> {
  const { error } = await supabase.from('match_participants').update({ status: 'rejected' }).eq('id', participantId);
  if (error) throw new Error(error.message);
}

export async function fetchMyParticipation(matchId: string, userId: string): Promise<MyParticipation | null> {
  const { data, error } = await supabase
    .from('match_participants')
    .select('id, status, leave_count')
    .eq('match_id', matchId)
    .eq('user_id', userId)
    .single();
  // PGRST116 = "no rows returned" -- expected when this user has never
  // interacted with this match, not a real error.
  if (error && error.code !== 'PGRST116') throw new Error(error.message);
  return (data as MyParticipation) ?? null;
}

// user_public_profiles is a VIEW with no PostgREST-discoverable FK from
// match_participants.user_id, so this is two queries + a client-side merge,
// not a single embedded select (see this plan's Global Constraints).
export async function fetchMatchParticipantProfiles(matchId: string): Promise<ParticipantProfile[]> {
  const { data: participants, error: participantsError } = await supabase
    .from('match_participants')
    .select('id, user_id, status')
    .eq('match_id', matchId);
  if (participantsError) throw new Error(participantsError.message);
  if (!participants || participants.length === 0) return [];

  const userIds = participants.map((p) => p.user_id);
  const { data: profiles, error: profilesError } = await supabase
    .from('user_public_profiles')
    .select('id, first_name, last_name, profile_image_url, unique_user_id, player_role')
    .in('id', userIds);
  if (profilesError) throw new Error(profilesError.message);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const result: ParticipantProfile[] = [];
  for (const p of participants) {
    const profile = profileById.get(p.user_id);
    if (!profile) continue;
    result.push({
      participant_id: p.id,
      user_id: p.user_id,
      status: p.status as ParticipantStatus,
      first_name: profile.first_name,
      last_name: profile.last_name,
      profile_image_url: profile.profile_image_url,
      unique_user_id: profile.unique_user_id,
      player_role: profile.player_role,
    });
  }
  return result;
}

// match_participants.match_id really does have a FK to matches(id), so this
// one CAN be a single embedded select -- unlike fetchMatchParticipantProfiles
// above, which cannot (see this plan's Global Constraints).
export async function fetchMyParticipatingMatches(userId: string): Promise<MyMatchParticipation[]> {
  const { data, error } = await supabase
    .from('match_participants')
    .select('status, matches(*)')
    .eq('user_id', userId)
    .in('status', ['requested', 'approved', 'active']);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ match: row.matches as unknown as Match, status: row.status as ParticipantStatus }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile && npm test -- participants.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Run full suite and typecheck**

Run: `cd mobile && npm test && npm run typecheck`
Expected: all passing, no type errors.

- [ ] **Step 6: Commit**

```bash
cd "/Users/giovanni/Desktop/app calcio"
git add mobile/src/api/participants.ts mobile/src/api/participants.test.ts
git commit -m "feat: add participation data layer (request/approve/reject/leave, profiles)"
```

---

### Task 2: `src/api/notifications.ts` — notifications data layer

**Files:**
- Create: `mobile/src/api/notifications.ts`
- Create: `mobile/src/api/notifications.test.ts`

**Interfaces:**
- Consumes: `supabase` (`src/api/supabase.ts`).
- Produces: `AppNotification` type; `fetchNotifications(): Promise<AppNotification[]>`,
  `markNotificationRead(id: string): Promise<void>` — consumed by Task 5 (`useNotifications`).

- [ ] **Step 1: Write the failing tests**

```ts
// mobile/src/api/notifications.test.ts
import { supabase } from './supabase';
import { fetchNotifications, markNotificationRead } from './notifications';

jest.mock('./supabase', () => ({ supabase: { from: jest.fn() } }));

describe('notifications api', () => {
  afterEach(() => jest.clearAllMocks());

  describe('fetchNotifications', () => {
    it('selects all notifications ordered by newest first', async () => {
      const order = jest.fn().mockResolvedValue({
        data: [
          { id: 'n1', type: 'join_request_received', payload: { message: 'ciao' }, read_at: null, created_at: '2026-09-02T10:00:00Z' },
        ],
        error: null,
      });
      const select = jest.fn().mockReturnValue({ order });
      (supabase.from as jest.Mock).mockReturnValue({ select });

      const result = await fetchNotifications();

      expect(supabase.from).toHaveBeenCalledWith('notifications');
      expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('n1');
    });

    it('throws the Supabase error message on failure', async () => {
      const order = jest.fn().mockResolvedValue({ data: null, error: { message: 'fetch failed' } });
      const select = jest.fn().mockReturnValue({ order });
      (supabase.from as jest.Mock).mockReturnValue({ select });

      await expect(fetchNotifications()).rejects.toThrow('fetch failed');
    });
  });

  describe('markNotificationRead', () => {
    it('sets read_at on the given notification', async () => {
      const eq = jest.fn().mockResolvedValue({ error: null });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await markNotificationRead('n1');

      expect(supabase.from).toHaveBeenCalledWith('notifications');
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ read_at: expect.any(String) }));
      expect(eq).toHaveBeenCalledWith('id', 'n1');
    });

    it('throws the Supabase error message on failure', async () => {
      const eq = jest.fn().mockResolvedValue({ error: { message: 'update failed' } });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await expect(markNotificationRead('n1')).rejects.toThrow('update failed');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- notifications.test.ts`
Expected: FAIL — `./notifications` does not exist yet.

- [ ] **Step 3: Implement the module**

```ts
// mobile/src/api/notifications.ts
import { supabase } from './supabase';

export interface AppNotification {
  id: string;
  type: string;
  payload: { message: string; match_id?: string; [key: string]: unknown };
  read_at: string | null;
  created_at: string;
}

// No user_id filter needed here: RLS policy `notifications_select_own`
// already restricts every row to the caller's own notifications.
export async function fetchNotifications(): Promise<AppNotification[]> {
  const { data, error } = await supabase.from('notifications').select().order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as AppNotification[];
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- notifications.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Run full suite and typecheck**

Run: `cd mobile && npm test && npm run typecheck`
Expected: all passing, no type errors.

- [ ] **Step 6: Commit**

```bash
cd "/Users/giovanni/Desktop/app calcio"
git add mobile/src/api/notifications.ts mobile/src/api/notifications.test.ts
git commit -m "feat: add notifications data layer"
```

---

### Task 3: `useMyParticipation` hook

**Files:**
- Create: `mobile/src/hooks/useMyParticipation.ts`
- Create: `mobile/src/hooks/useMyParticipation.test.ts`

**Interfaces:**
- Consumes: `fetchMyParticipation`, `requestToJoin`, `reRequestToJoin`, `leaveMatch`,
  `MyParticipation` (Task 1's `src/api/participants.ts`), `useSessionStore` (existing).
- Produces: `useMyParticipation(matchId: string): { participation: MyParticipation | null;
  loading: boolean; error: string | null; actionLoading: boolean; requestJoin: () =>
  Promise<boolean>; requestAgain: () => Promise<boolean>; leave: () => Promise<boolean>;
  refresh: () => Promise<void> }` — consumed by Task 7 (`match/[id].tsx`).

- [ ] **Step 1: Write the failing test**

```ts
// mobile/src/hooks/useMyParticipation.test.ts
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useMyParticipation } from './useMyParticipation';
import { fetchMyParticipation, requestToJoin, reRequestToJoin, leaveMatch } from '@/api/participants';
import { useSessionStore } from '@/stores/sessionStore';

jest.mock('@/api/participants', () => ({
  fetchMyParticipation: jest.fn(),
  requestToJoin: jest.fn(),
  reRequestToJoin: jest.fn(),
  leaveMatch: jest.fn(),
}));

describe('useMyParticipation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSessionStore.setState({ session: { user: { id: 'u1' } } as never, profile: null, status: 'signed-in' });
  });

  it('fetches the current user\'s participation for the match on mount', async () => {
    (fetchMyParticipation as jest.Mock).mockResolvedValue({ id: 'p1', status: 'approved', leave_count: 0 });

    const { result } = await renderHook(() => useMyParticipation('m1'));

    await waitFor(() => expect(result.current.participation).toEqual({ id: 'p1', status: 'approved', leave_count: 0 }));
    expect(fetchMyParticipation).toHaveBeenCalledWith('m1', 'u1');
    expect(result.current.loading).toBe(false);
  });

  it('does not fetch and reports an error when there is no session', async () => {
    useSessionStore.setState({ session: null, profile: null, status: 'signed-out' });

    const { result } = await renderHook(() => useMyParticipation('m1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMyParticipation).not.toHaveBeenCalled();

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.requestJoin();
    });
    expect(success).toBe(false);
    expect(result.current.error).toBeTruthy();
  });

  it('requestJoin calls requestToJoin and refreshes the participation', async () => {
    (fetchMyParticipation as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'p1', status: 'requested', leave_count: 0 });
    (requestToJoin as jest.Mock).mockResolvedValue(undefined);

    const { result } = await renderHook(() => useMyParticipation('m1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.requestJoin();
    });

    expect(requestToJoin).toHaveBeenCalledWith('m1', 'u1');
    expect(success).toBe(true);
    expect(result.current.participation).toEqual({ id: 'p1', status: 'requested', leave_count: 0 });
  });

  it('requestJoin sets an error and returns false on failure', async () => {
    (fetchMyParticipation as jest.Mock).mockResolvedValue(null);
    (requestToJoin as jest.Mock).mockRejectedValue(new Error('insert failed'));

    const { result } = await renderHook(() => useMyParticipation('m1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.requestJoin();
    });

    expect(success).toBe(false);
    expect(result.current.error).toBe('insert failed');
  });

  it('requestAgain calls reRequestToJoin with the participation row id', async () => {
    (fetchMyParticipation as jest.Mock)
      .mockResolvedValueOnce({ id: 'p1', status: 'left', leave_count: 1 })
      .mockResolvedValueOnce({ id: 'p1', status: 'requested', leave_count: 1 });
    (reRequestToJoin as jest.Mock).mockResolvedValue(undefined);

    const { result } = await renderHook(() => useMyParticipation('m1'));
    await waitFor(() => expect(result.current.participation?.status).toBe('left'));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.requestAgain();
    });

    expect(reRequestToJoin).toHaveBeenCalledWith('p1');
    expect(success).toBe(true);
    expect(result.current.participation?.status).toBe('requested');
  });

  it('requestAgain sets an error and returns false when the backend rejects it (leave_count limit)', async () => {
    (fetchMyParticipation as jest.Mock).mockResolvedValue({ id: 'p1', status: 'left', leave_count: 2 });
    (reRequestToJoin as jest.Mock).mockRejectedValue(new Error('maximum number of re-entries (2) reached for this match'));

    const { result } = await renderHook(() => useMyParticipation('m1'));
    await waitFor(() => expect(result.current.participation?.status).toBe('left'));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.requestAgain();
    });

    expect(success).toBe(false);
    expect(result.current.error).toBe('maximum number of re-entries (2) reached for this match');
  });

  it('leave calls leaveMatch with the participation row id and refreshes', async () => {
    (fetchMyParticipation as jest.Mock)
      .mockResolvedValueOnce({ id: 'p1', status: 'approved', leave_count: 0 })
      .mockResolvedValueOnce({ id: 'p1', status: 'left', leave_count: 1 });
    (leaveMatch as jest.Mock).mockResolvedValue(undefined);

    const { result } = await renderHook(() => useMyParticipation('m1'));
    await waitFor(() => expect(result.current.participation?.status).toBe('approved'));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.leave();
    });

    expect(leaveMatch).toHaveBeenCalledWith('p1');
    expect(success).toBe(true);
    expect(result.current.participation?.status).toBe('left');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- useMyParticipation.test.ts`
Expected: FAIL — `./useMyParticipation` does not exist yet.

- [ ] **Step 3: Implement the hook**

```ts
// mobile/src/hooks/useMyParticipation.ts
import { useCallback, useEffect, useState } from 'react';
import {
  fetchMyParticipation,
  requestToJoin,
  reRequestToJoin,
  leaveMatch,
  type MyParticipation,
} from '@/api/participants';
import { useSessionStore } from '@/stores/sessionStore';

export function useMyParticipation(matchId: string) {
  const userId = useSessionStore((s) => s.session?.user.id);
  const [participation, setParticipation] = useState<MyParticipation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetchMyParticipation(matchId, userId);
      setParticipation(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile caricare la partecipazione.');
    } finally {
      setLoading(false);
    }
  }, [matchId, userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function requestJoin(): Promise<boolean> {
    if (!userId) {
      setError('Devi essere autenticato per partecipare.');
      return false;
    }
    setActionLoading(true);
    setError(null);
    try {
      await requestToJoin(matchId, userId);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile inviare la richiesta.');
      return false;
    } finally {
      setActionLoading(false);
    }
  }

  async function requestAgain(): Promise<boolean> {
    if (!participation) return false;
    setActionLoading(true);
    setError(null);
    try {
      await reRequestToJoin(participation.id);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile inviare la richiesta.');
      return false;
    } finally {
      setActionLoading(false);
    }
  }

  async function leave(): Promise<boolean> {
    if (!participation) return false;
    setActionLoading(true);
    setError(null);
    try {
      await leaveMatch(participation.id);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile abbandonare la partita.');
      return false;
    } finally {
      setActionLoading(false);
    }
  }

  return { participation, loading, error, actionLoading, requestJoin, requestAgain, leave, refresh: load };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- useMyParticipation.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Run full suite and typecheck, then commit**

```bash
cd "/Users/giovanni/Desktop/app calcio/mobile" && npm test && npm run typecheck
cd "/Users/giovanni/Desktop/app calcio"
git add mobile/src/hooks/useMyParticipation.ts mobile/src/hooks/useMyParticipation.test.ts
git commit -m "feat: add useMyParticipation hook"
```

---

### Task 4: `useMatchRoster` hook

**Files:**
- Create: `mobile/src/hooks/useMatchRoster.ts`
- Create: `mobile/src/hooks/useMatchRoster.test.ts`

**Interfaces:**
- Consumes: `fetchMatchParticipantProfiles`, `approveParticipant`, `rejectParticipant`,
  `ParticipantProfile` (Task 1's `src/api/participants.ts`).
- Produces: `useMatchRoster(matchId: string): { pendingRequests: ParticipantProfile[];
  approvedParticipants: ParticipantProfile[]; loading: boolean; error: string | null;
  actionLoading: boolean; approve: (participantId: string) => Promise<boolean>; reject:
  (participantId: string) => Promise<boolean>; refresh: () => Promise<void> }` — consumed by
  Task 7 (`match/[id].tsx`, both the creator's requests/roster and the participant's roster).

- [ ] **Step 1: Write the failing test**

```ts
// mobile/src/hooks/useMatchRoster.test.ts
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useMatchRoster } from './useMatchRoster';
import { fetchMatchParticipantProfiles, approveParticipant, rejectParticipant } from '@/api/participants';

jest.mock('@/api/participants', () => ({
  fetchMatchParticipantProfiles: jest.fn(),
  approveParticipant: jest.fn(),
  rejectParticipant: jest.fn(),
}));

const requested = { participant_id: 'p1', user_id: 'u1', status: 'requested' as const, first_name: 'Mario', last_name: 'Rossi', profile_image_url: null, unique_user_id: 'FC-1', player_role: 'player' as const };
const approved = { participant_id: 'p2', user_id: 'u2', status: 'approved' as const, first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null, unique_user_id: 'FC-2', player_role: 'goalkeeper' as const };
const active = { participant_id: 'p3', user_id: 'u3', status: 'active' as const, first_name: 'Gino', last_name: 'Verdi', profile_image_url: null, unique_user_id: 'FC-3', player_role: 'both' as const };

describe('useMatchRoster', () => {
  afterEach(() => jest.clearAllMocks());

  it('splits profiles into pendingRequests and approvedParticipants', async () => {
    (fetchMatchParticipantProfiles as jest.Mock).mockResolvedValue([requested, approved, active]);

    const { result } = await renderHook(() => useMatchRoster('m1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.pendingRequests).toEqual([requested]);
    expect(result.current.approvedParticipants).toEqual([approved, active]);
    expect(fetchMatchParticipantProfiles).toHaveBeenCalledWith('m1');
  });

  it('exposes an error when fetching fails', async () => {
    (fetchMatchParticipantProfiles as jest.Mock).mockRejectedValue(new Error('fetch failed'));

    const { result } = await renderHook(() => useMatchRoster('m1'));

    await waitFor(() => expect(result.current.error).toBe('fetch failed'));
    expect(result.current.pendingRequests).toEqual([]);
  });

  it('approve calls approveParticipant with the participant row id and refreshes', async () => {
    (fetchMatchParticipantProfiles as jest.Mock)
      .mockResolvedValueOnce([requested])
      .mockResolvedValueOnce([{ ...requested, status: 'approved' }]);
    (approveParticipant as jest.Mock).mockResolvedValue(undefined);

    const { result } = await renderHook(() => useMatchRoster('m1'));
    await waitFor(() => expect(result.current.pendingRequests).toEqual([requested]));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.approve('p1');
    });

    expect(approveParticipant).toHaveBeenCalledWith('p1');
    expect(success).toBe(true);
    expect(result.current.pendingRequests).toEqual([]);
  });

  it('reject sets an error and returns false on failure', async () => {
    (fetchMatchParticipantProfiles as jest.Mock).mockResolvedValue([requested]);
    (rejectParticipant as jest.Mock).mockRejectedValue(new Error('reject failed'));

    const { result } = await renderHook(() => useMatchRoster('m1'));
    await waitFor(() => expect(result.current.pendingRequests).toEqual([requested]));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.reject('p1');
    });

    expect(success).toBe(false);
    expect(result.current.error).toBe('reject failed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- useMatchRoster.test.ts`
Expected: FAIL — `./useMatchRoster` does not exist yet.

- [ ] **Step 3: Implement the hook**

```ts
// mobile/src/hooks/useMatchRoster.ts
import { useCallback, useEffect, useState } from 'react';
import {
  fetchMatchParticipantProfiles,
  approveParticipant,
  rejectParticipant,
  type ParticipantProfile,
} from '@/api/participants';

export function useMatchRoster(matchId: string) {
  const [profiles, setProfiles] = useState<ParticipantProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchMatchParticipantProfiles(matchId);
      setProfiles(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile caricare i partecipanti.');
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    load();
  }, [load]);

  async function approve(participantId: string): Promise<boolean> {
    setActionLoading(true);
    setError(null);
    try {
      await approveParticipant(participantId);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile approvare la richiesta.');
      return false;
    } finally {
      setActionLoading(false);
    }
  }

  async function reject(participantId: string): Promise<boolean> {
    setActionLoading(true);
    setError(null);
    try {
      await rejectParticipant(participantId);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile rifiutare la richiesta.');
      return false;
    } finally {
      setActionLoading(false);
    }
  }

  const pendingRequests = profiles.filter((p) => p.status === 'requested');
  const approvedParticipants = profiles.filter((p) => p.status === 'approved' || p.status === 'active');

  return { pendingRequests, approvedParticipants, loading, error, actionLoading, approve, reject, refresh: load };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- useMatchRoster.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Run full suite and typecheck, then commit**

```bash
cd "/Users/giovanni/Desktop/app calcio/mobile" && npm test && npm run typecheck
cd "/Users/giovanni/Desktop/app calcio"
git add mobile/src/hooks/useMatchRoster.ts mobile/src/hooks/useMatchRoster.test.ts
git commit -m "feat: add useMatchRoster hook"
```

---

### Task 5: `useNotifications` hook

**Files:**
- Create: `mobile/src/hooks/useNotifications.ts`
- Create: `mobile/src/hooks/useNotifications.test.ts`

**Interfaces:**
- Consumes: `fetchNotifications`, `markNotificationRead`, `AppNotification` (Task 2's
  `src/api/notifications.ts`).
- Produces: `useNotifications(): { notifications: AppNotification[]; unreadCount: number;
  loading: boolean; error: string | null; markRead: (id: string) => Promise<void>; refresh: () =>
  Promise<void> }` — consumed by Task 8 (Home's bell badge, and the `notifications.tsx` screen).

- [ ] **Step 1: Write the failing test**

```ts
// mobile/src/hooks/useNotifications.test.ts
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useNotifications } from './useNotifications';
import { fetchNotifications, markNotificationRead } from '@/api/notifications';

jest.mock('@/api/notifications', () => ({
  fetchNotifications: jest.fn(),
  markNotificationRead: jest.fn(),
}));

const unread = { id: 'n1', type: 'join_request_received', payload: { message: 'ciao' }, read_at: null, created_at: '2026-09-02T10:00:00Z' };
const read = { id: 'n2', type: 'join_request_approved', payload: { message: 'approvato' }, read_at: '2026-09-02T09:00:00Z', created_at: '2026-09-01T10:00:00Z' };

describe('useNotifications', () => {
  afterEach(() => jest.clearAllMocks());

  it('fetches notifications on mount and computes unreadCount', async () => {
    (fetchNotifications as jest.Mock).mockResolvedValue([unread, read]);

    const { result } = await renderHook(() => useNotifications());

    await waitFor(() => expect(result.current.notifications).toEqual([unread, read]));
    expect(result.current.unreadCount).toBe(1);
    expect(result.current.loading).toBe(false);
  });

  it('exposes an error when fetching fails', async () => {
    (fetchNotifications as jest.Mock).mockRejectedValue(new Error('fetch failed'));

    const { result } = await renderHook(() => useNotifications());

    await waitFor(() => expect(result.current.error).toBe('fetch failed'));
  });

  it('markRead calls the API and optimistically updates the local list', async () => {
    (fetchNotifications as jest.Mock).mockResolvedValue([unread]);
    (markNotificationRead as jest.Mock).mockResolvedValue(undefined);

    const { result } = await renderHook(() => useNotifications());
    await waitFor(() => expect(result.current.unreadCount).toBe(1));

    await act(async () => {
      await result.current.markRead('n1');
    });

    expect(markNotificationRead).toHaveBeenCalledWith('n1');
    expect(result.current.unreadCount).toBe(0);
    expect(result.current.notifications[0].read_at).not.toBeNull();
  });

  it('markRead leaves the notification unread (no crash) if the API call fails', async () => {
    (fetchNotifications as jest.Mock).mockResolvedValue([unread]);
    (markNotificationRead as jest.Mock).mockRejectedValue(new Error('update failed'));

    const { result } = await renderHook(() => useNotifications());
    await waitFor(() => expect(result.current.unreadCount).toBe(1));

    await act(async () => {
      await result.current.markRead('n1');
    });

    expect(result.current.unreadCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- useNotifications.test.ts`
Expected: FAIL — `./useNotifications` does not exist yet.

- [ ] **Step 3: Implement the hook**

```ts
// mobile/src/hooks/useNotifications.ts
import { useCallback, useEffect, useState } from 'react';
import { fetchNotifications, markNotificationRead, type AppNotification } from '@/api/notifications';

export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchNotifications();
      setNotifications(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile caricare le notifiche.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function markRead(id: string): Promise<void> {
    try {
      await markNotificationRead(id);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
    } catch {
      // Best-effort: a failed mark-as-read isn't worth surfacing as a user
      // facing error -- the notification just stays unread until the next
      // manual refresh, which is a harmless, self-correcting outcome.
    }
  }

  const unreadCount = notifications.filter((n) => n.read_at === null).length;

  return { notifications, unreadCount, loading, error, markRead, refresh: load };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- useNotifications.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Run full suite and typecheck, then commit**

```bash
cd "/Users/giovanni/Desktop/app calcio/mobile" && npm test && npm run typecheck
cd "/Users/giovanni/Desktop/app calcio"
git add mobile/src/hooks/useNotifications.ts mobile/src/hooks/useNotifications.test.ts
git commit -m "feat: add useNotifications hook"
```

---

### Task 6: `fetchMatchesByCreator` + `useMyMatches` hook

**Files:**
- Modify: `mobile/src/api/matches.ts`
- Modify: `mobile/src/api/matches.test.ts`
- Create: `mobile/src/hooks/useMyMatches.ts`
- Create: `mobile/src/hooks/useMyMatches.test.ts`

**Interfaces:**
- Consumes: `Match` (existing, `src/api/matches.ts`), `fetchMyParticipatingMatches`,
  `MyMatchParticipation` (Task 1's `src/api/participants.ts`), `useSessionStore` (existing).
- Produces: `fetchMatchesByCreator(creatorId: string): Promise<Match[]>` (added to
  `src/api/matches.ts`); `useMyMatches(): { created: Match[]; participating:
  MyMatchParticipation[]; loading: boolean; error: string | null; refresh: () => Promise<void> }`
  — consumed by Task 9 (`my-matches/index.tsx`).

- [ ] **Step 1: Write the failing test for `fetchMatchesByCreator`**

Append to `mobile/src/api/matches.test.ts` (inside the existing `describe('matches api', ...)`
block, alongside the other `describe`s):

```ts
  describe('fetchMatchesByCreator', () => {
    it('selects matches by creator_id, newest first', async () => {
      const order = jest.fn().mockResolvedValue({ data: [sampleMatch], error: null });
      const eq = jest.fn().mockReturnValue({ order });
      const select = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ select });

      const result = await fetchMatchesByCreator('u1');

      expect(supabase.from).toHaveBeenCalledWith('matches');
      expect(eq).toHaveBeenCalledWith('creator_id', 'u1');
      expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(result).toEqual([sampleMatch]);
    });

    it('throws the Supabase error message on failure', async () => {
      const order = jest.fn().mockResolvedValue({ data: null, error: { message: 'fetch failed' } });
      const eq = jest.fn().mockReturnValue({ order });
      const select = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ select });

      await expect(fetchMatchesByCreator('u1')).rejects.toThrow('fetch failed');
    });
  });
```

Also add `fetchMatchesByCreator` to the existing `import { ... } from './matches';` line at the
top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- matches.test.ts`
Expected: FAIL — `fetchMatchesByCreator` is not exported by `./matches` yet.

- [ ] **Step 3: Add `fetchMatchesByCreator` to `src/api/matches.ts`**

Append this function to the end of `mobile/src/api/matches.ts` (do not change anything else in
the file):

```ts

export async function fetchMatchesByCreator(creatorId: string): Promise<Match[]> {
  const { data, error } = await supabase
    .from('matches')
    .select()
    .eq('creator_id', creatorId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Match[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- matches.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Write the failing test for `useMyMatches`**

```ts
// mobile/src/hooks/useMyMatches.test.ts
import { renderHook, waitFor } from '@testing-library/react-native';
import { useMyMatches } from './useMyMatches';
import { fetchMatchesByCreator } from '@/api/matches';
import { fetchMyParticipatingMatches } from '@/api/participants';
import { useSessionStore } from '@/stores/sessionStore';

jest.mock('@/api/matches', () => ({ fetchMatchesByCreator: jest.fn() }));
jest.mock('@/api/participants', () => ({ fetchMyParticipatingMatches: jest.fn() }));

const createdMatch = { id: 'm1', field_name: 'Campo Creato' };
const participatingRow = { match: { id: 'm2', field_name: 'Campo Partecipo' }, status: 'approved' as const };

describe('useMyMatches', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSessionStore.setState({ session: { user: { id: 'u1' } } as never, profile: null, status: 'signed-in' });
  });

  it('fetches created and participating matches in parallel on mount', async () => {
    (fetchMatchesByCreator as jest.Mock).mockResolvedValue([createdMatch]);
    (fetchMyParticipatingMatches as jest.Mock).mockResolvedValue([participatingRow]);

    const { result } = await renderHook(() => useMyMatches());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMatchesByCreator).toHaveBeenCalledWith('u1');
    expect(fetchMyParticipatingMatches).toHaveBeenCalledWith('u1');
    expect(result.current.created).toEqual([createdMatch]);
    expect(result.current.participating).toEqual([participatingRow]);
  });

  it('exposes an error when either fetch fails', async () => {
    (fetchMatchesByCreator as jest.Mock).mockRejectedValue(new Error('boom'));
    (fetchMyParticipatingMatches as jest.Mock).mockResolvedValue([]);

    const { result } = await renderHook(() => useMyMatches());

    await waitFor(() => expect(result.current.error).toBe('boom'));
  });

  it('does not fetch when there is no session', async () => {
    useSessionStore.setState({ session: null, profile: null, status: 'signed-out' });

    const { result } = await renderHook(() => useMyMatches());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMatchesByCreator).not.toHaveBeenCalled();
    expect(fetchMyParticipatingMatches).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd mobile && npm test -- useMyMatches.test.ts`
Expected: FAIL — `./useMyMatches` does not exist yet.

- [ ] **Step 7: Implement the hook**

```ts
// mobile/src/hooks/useMyMatches.ts
import { useCallback, useEffect, useState } from 'react';
import { fetchMatchesByCreator, type Match } from '@/api/matches';
import { fetchMyParticipatingMatches, type MyMatchParticipation } from '@/api/participants';
import { useSessionStore } from '@/stores/sessionStore';

export function useMyMatches() {
  const userId = useSessionStore((s) => s.session?.user.id);
  const [created, setCreated] = useState<Match[]>([]);
  const [participating, setParticipating] = useState<MyMatchParticipation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [createdMatches, participatingMatches] = await Promise.all([
        fetchMatchesByCreator(userId),
        fetchMyParticipatingMatches(userId),
      ]);
      setCreated(createdMatches);
      setParticipating(participatingMatches);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile caricare le tue partite.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  return { created, participating, loading, error, refresh: load };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd mobile && npm test -- useMyMatches.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 9: Run full suite and typecheck, then commit**

```bash
cd "/Users/giovanni/Desktop/app calcio/mobile" && npm test && npm run typecheck
cd "/Users/giovanni/Desktop/app calcio"
git add mobile/src/api/matches.ts mobile/src/api/matches.test.ts mobile/src/hooks/useMyMatches.ts mobile/src/hooks/useMyMatches.test.ts
git commit -m "feat: add fetchMatchesByCreator and useMyMatches hook"
```

---

### Task 7: `ParticipantRow` component + match detail participation UI

**Files:**
- Create: `mobile/src/components/ParticipantRow.tsx`
- Modify: `mobile/app/(tabs)/home/match/[id].tsx`

**Interfaces:**
- Consumes: `ParticipantProfile` (Task 1), `useMyParticipation` (Task 3), `useMatchRoster`
  (Task 4), `useSessionStore` (existing).
- Produces: `ParticipantRow` component, consumed only within this task's own
  `match/[id].tsx` changes (no later task depends on it).
- No dedicated test file for either — see this plan's Global Constraints on the no-screen/
  no-presentational-component-tests precedent.

- [ ] **Step 1: Implement `ParticipantRow`**

```tsx
// mobile/src/components/ParticipantRow.tsx
import type { ReactNode } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import type { ParticipantProfile } from '@/api/participants';

const ROLE_LABELS: Record<ParticipantProfile['player_role'], string> = {
  player: 'Giocatore',
  goalkeeper: 'Portiere',
  both: 'Giocatore/Portiere',
};

interface ParticipantRowProps {
  profile: ParticipantProfile;
  children?: ReactNode;
}

export function ParticipantRow({ profile, children }: ParticipantRowProps) {
  return (
    <View style={styles.row}>
      {profile.profile_image_url ? (
        <Image source={{ uri: profile.profile_image_url }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarPlaceholder]}>
          <Text style={styles.avatarInitial}>{profile.first_name.charAt(0).toUpperCase()}</Text>
        </View>
      )}
      <View style={styles.info}>
        <Text style={styles.name}>
          {profile.first_name} {profile.last_name}
        </Text>
        <Text style={styles.role}>{ROLE_LABELS[profile.player_role]}</Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarPlaceholder: { backgroundColor: '#1a7f37', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: '#fff', fontWeight: '700' },
  info: { flex: 1 },
  name: { fontWeight: '600' },
  role: { color: '#666', fontSize: 13 },
});
```

- [ ] **Step 2: Typecheck**

Run: `cd mobile && npm run typecheck`
Expected: no type errors. (No jest run needed — no test file for this step.)

- [ ] **Step 3: Extend `match/[id].tsx` with participation UI**

Replace the full contents of `mobile/app/(tabs)/home/match/[id].tsx` with:

```tsx
// mobile/app/(tabs)/home/match/[id].tsx
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMatchDetail } from '@/hooks/useMatchDetail';
import { useMyParticipation } from '@/hooks/useMyParticipation';
import { useMatchRoster } from '@/hooks/useMatchRoster';
import { useSessionStore } from '@/stores/sessionStore';
import { MatchForm, type MatchFormValues } from '@/components/MatchForm';
import { ParticipantRow } from '@/components/ParticipantRow';

export default function MatchDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = useSessionStore((s) => s.session?.user.id);
  const { match, loading, error, update, remove } = useMatchDetail(id);
  const myParticipation = useMyParticipation(id);
  const roster = useMatchRoster(id);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isCreator = !!match && !!userId && match.creator_id === userId;

  async function handleSave(values: MatchFormValues) {
    setSaving(true);
    const success = await update({
      match_type: values.matchType,
      field_name: values.fieldName,
      address: values.address,
      match_date: values.matchDate,
      start_time: values.startTime,
      end_time: values.endTime,
      max_players: Number(values.maxPlayers),
      description: values.description || null,
    });
    setSaving(false);
    if (success) setEditing(false);
  }

  function confirmDelete() {
    Alert.alert('Cancella partita', 'Sei sicuro di voler cancellare questa partita?', [
      { text: 'Annulla', style: 'cancel' },
      {
        text: 'Cancella',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          const success = await remove();
          setDeleting(false);
          if (success) router.back();
        },
      },
    ]);
  }

  function confirmLeave() {
    Alert.alert('Abbandona partita', 'Sei sicuro di voler abbandonare questa partita?', [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Abbandona', style: 'destructive', onPress: () => myParticipation.leave() },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // Only the initial-fetch-never-succeeded case ("nothing to show at all")
  // routes here. A failed update/delete on an ALREADY-loaded match must NOT
  // hit this branch -- useMatchDetail's update()/remove() write failures into
  // the same `error` field the initial fetch uses, but `match` stays
  // populated across those failures. Gating on `!match` alone (not
  // `error || !match`) is what keeps a failed edit on the edit form and a
  // failed delete on the detail view, instead of both ejecting the user to
  // this generic screen.
  if (!match) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error ?? 'Partita non trovata.'}</Text>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>← Torna alla Home</Text>
        </Pressable>
      </View>
    );
  }

  if (editing) {
    return (
      <View style={{ flex: 1, paddingTop: insets.top }}>
        <MatchForm
          initialValues={{
            matchType: match.match_type,
            fieldName: match.field_name,
            address: match.address,
            matchDate: match.match_date,
            startTime: match.start_time.slice(0, 5),
            endTime: match.end_time.slice(0, 5),
            maxPlayers: String(match.max_players),
            description: match.description ?? '',
          }}
          onSubmit={handleSave}
          submitLabel="Salva modifiche"
          loading={saving}
          error={error}
        />
      </View>
    );
  }

  const isFull = match.max_players <= roster.approvedParticipants.length;
  const canRequest = match.status === 'open' && !isFull;

  return (
    <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + 24 }]}>
      <Pressable onPress={() => router.back()}>
        <Text style={styles.backLink}>← Torna alla Home</Text>
      </Pressable>
      <Text style={styles.title}>{match.field_name}</Text>
      <Text style={styles.meta}>⚽ Calcio a {match.match_type}</Text>
      <Text style={styles.meta}>📍 {match.address}</Text>
      <Text style={styles.meta}>
        {match.match_date} · {match.start_time.slice(0, 5)} → {match.end_time.slice(0, 5)}
      </Text>
      <Text style={styles.meta}>Massimo {match.max_players} giocatori</Text>
      {match.description && <Text style={styles.description}>{match.description}</Text>}
      {/* A failed delete (or any other mutation error while NOT editing)
          surfaces here, inline, on the same detail view -- it must never
          silently navigate away or swap in the generic not-found screen. */}
      {error && <Text style={styles.error}>{error}</Text>}

      {isCreator && (
        <View style={styles.actions}>
          <Pressable style={styles.editButton} onPress={() => setEditing(true)}>
            <Text style={styles.editButtonText}>Modifica</Text>
          </Pressable>
          <Pressable style={styles.deleteButton} onPress={confirmDelete} disabled={deleting}>
            {deleting ? <ActivityIndicator color="#fff" /> : <Text style={styles.deleteButtonText}>Cancella partita</Text>}
          </Pressable>
        </View>
      )}

      {isCreator && roster.pendingRequests.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Richieste in attesa</Text>
          {roster.error && <Text style={styles.error}>{roster.error}</Text>}
          {roster.pendingRequests.map((profile) => (
            <ParticipantRow key={profile.participant_id} profile={profile}>
              <View style={styles.requestActions}>
                <Pressable
                  style={styles.approveButton}
                  disabled={roster.actionLoading}
                  onPress={() => roster.approve(profile.participant_id)}
                >
                  <Text style={styles.approveButtonText}>Approva</Text>
                </Pressable>
                <Pressable
                  style={styles.rejectButton}
                  disabled={roster.actionLoading}
                  onPress={() => roster.reject(profile.participant_id)}
                >
                  <Text style={styles.rejectButtonText}>Rifiuta</Text>
                </Pressable>
              </View>
            </ParticipantRow>
          ))}
        </View>
      )}

      {roster.approvedParticipants.length > 0 && (isCreator || myParticipation.participation?.status === 'approved' || myParticipation.participation?.status === 'active') && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Partecipanti</Text>
          {roster.approvedParticipants.map((profile) => (
            <ParticipantRow key={profile.participant_id} profile={profile} />
          ))}
        </View>
      )}

      {!isCreator && (
        <View style={styles.section}>
          {myParticipation.error && <Text style={styles.error}>{myParticipation.error}</Text>}
          {!myParticipation.participation && canRequest && (
            <Pressable style={styles.requestButton} disabled={myParticipation.actionLoading} onPress={() => myParticipation.requestJoin()}>
              {myParticipation.actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.requestButtonText}>Richiedi di partecipare</Text>}
            </Pressable>
          )}
          {myParticipation.participation?.status === 'requested' && (
            <Text style={styles.statusText}>Richiesta in attesa di approvazione</Text>
          )}
          {(myParticipation.participation?.status === 'approved' || myParticipation.participation?.status === 'active') && (
            <View>
              <Text style={styles.statusTextSuccess}>Sei dentro ✅</Text>
              <Pressable style={styles.leaveButton} disabled={myParticipation.actionLoading} onPress={confirmLeave}>
                {myParticipation.actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.leaveButtonText}>Abbandona partita</Text>}
              </Pressable>
            </View>
          )}
          {myParticipation.participation?.status === 'rejected' && (
            <Text style={styles.statusText}>La tua richiesta è stata rifiutata</Text>
          )}
          {myParticipation.participation?.status === 'left' && (
            <View>
              <Text style={styles.statusText}>Hai lasciato questa partita</Text>
              {myParticipation.participation.leave_count < 2 && (
                <Pressable style={styles.requestButton} disabled={myParticipation.actionLoading} onPress={() => myParticipation.requestAgain()}>
                  {myParticipation.actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.requestButtonText}>Richiedi di nuovo</Text>}
                </Pressable>
              )}
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 24, paddingBottom: 24, gap: 8 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  backLink: { color: '#1a7f37', marginBottom: 8 },
  backButton: { backgroundColor: '#1a7f37', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 20, marginTop: 8 },
  backButtonText: { color: '#fff', fontWeight: '600' },
  title: { fontSize: 24, fontWeight: '700' },
  meta: { color: '#444', fontSize: 16 },
  description: { color: '#333', marginTop: 8 },
  error: { color: '#c0392b', textAlign: 'center' },
  actions: { marginTop: 24, gap: 12 },
  editButton: { backgroundColor: '#1a7f37', borderRadius: 8, padding: 14, alignItems: 'center' },
  editButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  deleteButton: { backgroundColor: '#c0392b', borderRadius: 8, padding: 14, alignItems: 'center' },
  deleteButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  section: { marginTop: 24, gap: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  requestActions: { flexDirection: 'row', gap: 8 },
  approveButton: { backgroundColor: '#1a7f37', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  approveButtonText: { color: '#fff', fontWeight: '600' },
  rejectButton: { backgroundColor: '#c0392b', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  rejectButtonText: { color: '#fff', fontWeight: '600' },
  requestButton: { backgroundColor: '#1a7f37', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
  requestButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  leaveButton: { backgroundColor: '#c0392b', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 12 },
  leaveButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  statusText: { color: '#444', fontSize: 15 },
  statusTextSuccess: { color: '#1a7f37', fontSize: 16, fontWeight: '600' },
});
```

Note on `isFull`/`canRequest`: `roster.approvedParticipants` is fetched for every viewer (not
just the creator) via `useMatchRoster`, so this count is available regardless of role — the
"Richiedi di partecipare" button correctly hides itself once the match is full even though the
detailed roster section under it stays gated to creator/approved-participant viewers only.

- [ ] **Step 4: Run full suite and typecheck**

Run: `cd mobile && npm test && npm run typecheck`
Expected: all passing, no type errors.

- [ ] **Step 5: Commit**

```bash
cd "/Users/giovanni/Desktop/app calcio"
git add mobile/src/components/ParticipantRow.tsx "mobile/app/(tabs)/home/match/[id].tsx"
git commit -m "feat: add participation UI to match detail screen"
```

---

### Task 8: Notifications screen + Home bell/badge wiring

**Files:**
- Modify: `mobile/app/(tabs)/home/_layout.tsx`
- Create: `mobile/app/(tabs)/home/notifications.tsx`
- Modify: `mobile/app/(tabs)/home/index.tsx`

**Interfaces:**
- Consumes: `useNotifications` (Task 5), `AppNotification` (Task 2).
- Produces: route `/(tabs)/home/notifications`, consumed only within this task's own Home
  wiring (no later task depends on it).

- [ ] **Step 1: Register the new route in the Home tab's Stack**

Replace the full contents of `mobile/app/(tabs)/home/_layout.tsx` with:

```tsx
// mobile/app/(tabs)/home/_layout.tsx
import { Stack } from 'expo-router';

export default function HomeLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="create-match" />
      <Stack.Screen name="match/[id]" />
      <Stack.Screen name="notifications" />
    </Stack>
  );
}
```

- [ ] **Step 2: Create the notifications screen**

```tsx
// mobile/app/(tabs)/home/notifications.tsx
import { View, Text, FlatList, ActivityIndicator, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useNotifications } from '@/hooks/useNotifications';
import type { AppNotification } from '@/api/notifications';

export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { notifications, loading, error, markRead, refresh } = useNotifications();

  function handlePress(notification: AppNotification) {
    if (!notification.read_at) markRead(notification.id);
    if (notification.payload.match_id) {
      router.push({ pathname: '/(tabs)/home/match/[id]', params: { id: notification.payload.match_id } });
    }
  }

  if (loading && notifications.length === 0) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <Pressable onPress={() => router.back()}>
        <Text style={styles.backLink}>← Torna alla Home</Text>
      </Pressable>
      <Text style={styles.header}>Notifiche</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable style={[styles.item, !item.read_at && styles.itemUnread]} onPress={() => handlePress(item)}>
            <Text style={styles.message}>{item.payload.message}</Text>
            <Text style={styles.date}>{new Date(item.created_at).toLocaleString('it-IT')}</Text>
          </Pressable>
        )}
        contentContainerStyle={styles.list}
        onRefresh={refresh}
        refreshing={loading}
        ListEmptyComponent={<Text style={styles.subtitle}>Nessuna notifica.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  backLink: { color: '#1a7f37', marginBottom: 8 },
  header: { fontSize: 22, fontWeight: '700', marginBottom: 12 },
  error: { color: '#c0392b', marginBottom: 8 },
  list: { paddingBottom: 24 },
  item: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  itemUnread: { backgroundColor: '#f0f8f2' },
  message: { fontSize: 15 },
  date: { color: '#888', fontSize: 12, marginTop: 4 },
  subtitle: { color: '#666', textAlign: 'center', marginTop: 24 },
});
```

- [ ] **Step 3: Wire a bell button with an unread badge into Home**

Replace the full contents of `mobile/app/(tabs)/home/index.tsx` with:

```tsx
// mobile/app/(tabs)/home/index.tsx
import { useCallback } from 'react';
import { View, Text, FlatList, ActivityIndicator, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useNearbyMatches } from '@/hooks/useNearbyMatches';
import { useNotifications } from '@/hooks/useNotifications';
import { MatchCard } from '@/components/MatchCard';

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { matches, loading, error, permissionDenied, refresh } = useNearbyMatches();
  const { unreadCount, refresh: refreshNotifications } = useNotifications();

  useFocusEffect(
    useCallback(() => {
      refresh();
      refreshNotifications();
    }, [refresh, refreshNotifications])
  );

  if (permissionDenied) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Attiva la posizione</Text>
        <Text style={styles.subtitle}>Per trovare le partite vicino a te abbiamo bisogno della tua posizione.</Text>
        <Pressable style={styles.button} onPress={refresh}>
          <Text style={styles.buttonText}>Riprova</Text>
        </Pressable>
      </View>
    );
  }

  if (loading && matches.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error}</Text>
        <Pressable style={styles.button} onPress={refresh}>
          <Text style={styles.buttonText}>Riprova</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>Partite vicino a te</Text>
        <View style={styles.headerActions}>
          <Pressable style={styles.bellButton} onPress={() => router.push('/(tabs)/home/notifications')}>
            <Text style={styles.bellIcon}>🔔</Text>
            {unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
              </View>
            )}
          </Pressable>
          <Pressable style={styles.createButton} onPress={() => router.push('/(tabs)/home/create-match')}>
            <Text style={styles.createButtonText}>+ Crea</Text>
          </Pressable>
        </View>
      </View>
      <FlatList
        data={matches}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push({ pathname: '/(tabs)/home/match/[id]', params: { id: item.id } })}>
            <MatchCard match={item} />
          </Pressable>
        )}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
        ListEmptyComponent={<Text style={styles.subtitle}>Nessuna partita trovata nella tua zona.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  header: { fontSize: 22, fontWeight: '700' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bellButton: { position: 'relative', padding: 4 },
  bellIcon: { fontSize: 22 },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: '#c0392b',
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  createButton: { backgroundColor: '#1a7f37', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
  createButtonText: { color: '#fff', fontWeight: '600' },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  subtitle: { color: '#666', textAlign: 'center' },
  error: { color: '#c0392b', textAlign: 'center' },
  button: { backgroundColor: '#1a7f37', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 20, marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '600' },
});
```

- [ ] **Step 4: Run full suite and typecheck**

Run: `cd mobile && npm test && npm run typecheck`
Expected: all passing, no type errors. (`useLocalSearchParams`/route typing for the new
`notifications` route resolves once `.expo/types/router.d.ts` regenerates on the next dev-server
run — same known, self-resolving quirk already documented in earlier plans, not a bug here.)

- [ ] **Step 5: Commit**

```bash
cd "/Users/giovanni/Desktop/app calcio"
git add "mobile/app/(tabs)/home/_layout.tsx" "mobile/app/(tabs)/home/notifications.tsx" "mobile/app/(tabs)/home/index.tsx"
git commit -m "feat: add notifications screen and Home bell/badge"
```

---

### Task 9: "Le mie partite" screen

**Files:**
- Modify: `mobile/app/(tabs)/my-matches/index.tsx`

**Interfaces:**
- Consumes: `useMyMatches` (Task 6), `Match` (existing `src/api/matches.ts`),
  `ParticipantStatus`/`MyMatchParticipation` (Task 1).
- Produces: nothing new consumed elsewhere; this is the final screen of this plan.

- [ ] **Step 1: Replace the full contents of `my-matches/index.tsx`**

```tsx
// mobile/app/(tabs)/my-matches/index.tsx
import { useCallback } from 'react';
import { View, Text, SectionList, ActivityIndicator, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useMyMatches } from '@/hooks/useMyMatches';
import type { Match } from '@/api/matches';
import type { ParticipantStatus } from '@/api/participants';

interface Row {
  match: Match;
  status?: ParticipantStatus;
}

const STATUS_LABELS: Record<ParticipantStatus, string> = {
  requested: 'In attesa di approvazione',
  approved: 'Approvato',
  active: 'Attivo',
  rejected: 'Rifiutato',
  left: 'Abbandonata',
  completed: 'Completata',
};

export default function MyMatchesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { created, participating, loading, error, refresh } = useMyMatches();

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  function goToMatch(id: string) {
    router.push({ pathname: '/(tabs)/home/match/[id]', params: { id } });
  }

  if (loading && created.length === 0 && participating.length === 0) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const sections = [
    { title: 'Create da te', data: created.map((match): Row => ({ match })) },
    { title: 'A cui partecipi', data: participating.map((p): Row => ({ match: p.match, status: p.status })) },
  ].filter((section) => section.data.length > 0);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <Text style={styles.header}>Le mie partite</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.match.id}
        renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => goToMatch(item.match.id)}>
            <Text style={styles.rowTitle}>{item.match.field_name}</Text>
            <Text style={styles.rowMeta}>
              {item.match.match_date} · {item.match.start_time.slice(0, 5)} → {item.match.end_time.slice(0, 5)}
            </Text>
            {item.status && <Text style={styles.rowStatus}>{STATUS_LABELS[item.status]}</Text>}
          </Pressable>
        )}
        contentContainerStyle={styles.list}
        onRefresh={refresh}
        refreshing={loading}
        ListEmptyComponent={<Text style={styles.subtitle}>Nessuna partita al momento.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { fontSize: 22, fontWeight: '700', marginBottom: 12 },
  error: { color: '#c0392b', marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowMeta: { color: '#666', fontSize: 13, marginTop: 2 },
  rowStatus: { color: '#1a7f37', fontSize: 13, fontWeight: '600', marginTop: 2 },
  list: { paddingBottom: 24 },
  subtitle: { color: '#666', textAlign: 'center', marginTop: 24 },
});
```

This replaces the file's previous `ScreenPlaceholder` content entirely. `ScreenPlaceholder`
itself (`src/components/ScreenPlaceholder.tsx`) is left in place — it's still used by the
`people`/`messages`/`profile` tab placeholders, only `my-matches` graduates off it here.

- [ ] **Step 2: Run full suite and typecheck**

Run: `cd mobile && npm test && npm run typecheck`
Expected: all passing, no type errors.

- [ ] **Step 3: Commit**

```bash
cd "/Users/giovanni/Desktop/app calcio"
git add "mobile/app/(tabs)/my-matches/index.tsx"
git commit -m "feat: build out Le mie partite screen (created + participating matches)"
```

---

### Task 10: End-to-end manual verification in the iOS Simulator

**Files:** none (verification only).

**Interfaces:** none — this task exercises every interface produced by Tasks 1-9 together,
against the real local Supabase backend, with two distinct test users.

- [ ] **Step 1: Confirm the backend is up**

Run: `cd "/Users/giovanni/Desktop/app calcio" && supabase status`
Expected: all services running. If not, `supabase start`.

- [ ] **Step 2: Prepare two test users**

This plan's flows need two distinct accounts to see both sides of a request (requester vs.
creator). Reuse the existing test-OTP dev config from earlier plans
(`+390000000001` already exists per mobile-app-foundation's own Task 9 verification). Create a
second one the same way (register-phone → OTP → password → profile, e.g. `+390000000002`), or
reuse any second account already created during match-creation's own Task 8 walkthrough if one
still exists.

- [ ] **Step 3: Boot the Expo dev server and open it in the iOS Simulator**

`cd mobile && npx expo run:ios` (or attach to an already-running Metro + reinstalled build, per
the same pattern documented in match-creation's own Task 8 and the project's
`project-ios-simulator-devclient-freeze` memory if working from a fresh checkout).

- [ ] **Step 4: User A creates a match**

Log in as User A (`+390000000001`). From Home, tap "+ Crea", fill in a fresh match (any future
date/time, tipo `5`, `max_players` left at the prefilled `10`). Submit.
Expected: lands on the new match's detail page, "Richieste in attesa" and "Partecipanti"
sections are absent (no participants yet).

- [ ] **Step 5: User B requests to join**

Log out, log in as User B (`+390000000002`). On Home, find User A's match (pull-to-refresh if
needed) and open its detail. Confirm no "Modifica"/"Cancella partita" buttons appear (User B is
not the creator). Tap "Richiedi di partecipare".
Expected: button disappears, replaced by "Richiesta in attesa di approvazione".

- [ ] **Step 6: User A sees and approves the request**

Log out, log in as User A. Tap the bell icon on Home — confirm the badge showed an unread count
and the notifications list shows "Hai ricevuto una nuova richiesta di partecipazione per...".
Tap that notification: confirm it navigates to the match detail and the badge count decreases.
On the match detail, confirm "Richieste in attesa" shows User B's name/photo-placeholder/role.
Tap "Approva".
Expected: the request disappears from "Richieste in attesa"; User B now appears under
"Partecipanti".

- [ ] **Step 7: User B sees the approval and the roster**

Log out, log in as User B. Confirm the notifications bell shows an unread badge; open Notifiche,
confirm "La tua richiesta per ... è stata approvata" is listed, tap it. On the match detail,
confirm it now shows "Sei dentro ✅", an "Abbandona partita" button, and a "Partecipanti" section
listing both User A... — actually confirm it lists **User B themselves** (the only approved
participant so far; User A is the creator, not a participant row, unless User A also has a
participation row, which they don't by default).

- [ ] **Step 8: User B leaves and re-requests**

Still as User B, tap "Abbandona partita", confirm in the native alert.
Expected: returns to "Hai lasciato questa partita" with a "Richiedi di nuovo" button visible.
Tap "Richiedi di nuovo".
Expected: returns to "Richiesta in attesa di approvazione" — confirm (as User A, after
switching back) the match detail's "Richieste in attesa" shows User B's new request again.

- [ ] **Step 9: Verify "Le mie partite" for both users**

As User A: open the "Le mie partite" tab, confirm the match appears under "Create da te".
As User B: open the same tab, confirm the match appears under "A cui partecipi" with the label
matching its current status ("In attesa di approvazione" per Step 8's re-request).

- [ ] **Step 10: Record the outcome**

If every check in Steps 4-9 passes, this task (and the plan) is complete. If anything fails,
treat it as a normal bug: fix the specific hook/screen/API function responsible, re-run the
affected Jest tests, and repeat this task's manual walkthrough from the failing step.

---

## What this plan does not cover (by design)

- Direct invitations to a specific person (`match_invitations`) — depends on the "amicizie"
  (friends) system, not yet built on mobile.
- Match-room chat (`match_messages`).
- Push notification registration/delivery (`expo-notifications`, `user_push_tokens`) — the
  backend trigger that sends pushes already exists; no mobile code registers a token yet. Needs
  a physical device to verify, so it stays its own plan.
- A navigable user-profile screen (`people/user/[id]`) — participant info in this plan is shown
  inline via `ParticipantRow`, never as a tappable link to a separate profile screen.
- Withdrawing a pending request, or re-requesting after a rejection — the backend's state
  machine does not model either transition (see this plan's Global Constraints).
