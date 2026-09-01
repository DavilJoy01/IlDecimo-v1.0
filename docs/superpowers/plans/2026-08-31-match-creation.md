# Match Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated user create a new match from the mobile app, see its detail, and
(as its creator) edit or cancel it.

**Architecture:** Pure mobile work — the backend (`matches` table, RLS, `nearby_open_matches`
RPC) already supports everything this plan needs, no new migrations. Adds a `src/api/matches.ts`
extension (create/read/update/delete), two hooks (`useMatchDetail`, `useCreateMatch`), one shared
presentational form component (`MatchForm`), a new `(tabs)/home/_layout.tsx` Stack so the Home tab
can host more than one screen, two new screens (`create-match.tsx`, `match/[id].tsx`), and two
small wiring changes to the existing Home screen.

**Tech Stack:** React Native + Expo Router (already in place — see
`docs/superpowers/plans/2026-08-31-mobile-app-foundation.md` for the foundation this builds on).

**Spec:** [docs/superpowers/specs/2026-08-31-match-creation-design.md](../specs/2026-08-31-match-creation-design.md)
(parent spec: [docs/superpowers/specs/2026-08-30-app-calcio-mvp-design.md](../specs/2026-08-30-app-calcio-mvp-design.md))

## Global Constraints

- `@testing-library/react-native@14.0.1`'s `renderHook` is `async` and returns a
  `Promise<RenderHookResult>` — verified against the installed package's own source in a prior
  session, not a style choice. Every `renderHook(...)` call in this plan's tests is already
  written `await`ed; keep doing that for any test you add.
- `mobile/src/api/supabase.ts` imports `react-native-url-polyfill/auto`, an ESM package Jest's
  `transformIgnorePatterns` doesn't cover. Any test touching a module that imports `supabase.ts`
  (directly or transitively) must mock it via the factory form
  `jest.mock('./supabase', () => ({ supabase: { ... } }))` (or `@/api/supabase` depending on the
  importing file's relative path) — never import the real module unmocked in a test. None of
  this plan's own new files import `supabase.ts` directly except `src/api/matches.ts` itself.
- `useSessionStore` (Zustand, `mobile/src/stores/sessionStore.ts`) does NOT import
  `supabase.ts` and is safe to import un-mocked in tests — set it up per-test with
  `useSessionStore.setState({ session: ..., profile: ..., status: ... })`, matching the pattern
  already used in `mobile/src/hooks/useRegistration.test.ts`.
- Postgres `time` columns (`matches.start_time`, `matches.end_time`) come back from Supabase as
  `"HH:MM:SS"` strings, not `"HH:MM"`. Always `.slice(0, 5)` when displaying a time or pre-filling
  a form from a fetched `Match` row (matches the convention `MatchCard.tsx` already established).
  Submit only `"HH:MM"`-formatted strings back to the API — the column accepts either, but every
  other write path in this codebase (and Task 9's manual test data) uses `"HH:MM"`.
  `match_date` (a `date` column) round-trips as a plain `"YYYY-MM-DD"` string with no such gotcha.
- A match's `latitude`/`longitude` are captured once, from the creator's device GPS, at creation
  time, and are never editable afterward in this MVP (see the spec's "known limitation"). This is
  enforced at the type level: `MatchEditableFields` (Task 1) must not include `latitude`/
  `longitude`, so passing them to `updateMatch` is a compile error, not just a UI omission.
- Expo Router requires an explicit `_layout.tsx` with a `<Stack>` for sibling route files in a
  directory to get push/back navigation as a coherent flow — without one, files in that directory
  are technically routable but don't compose into a navigable stack. `(tabs)/home/` currently has
  only `index.tsx` and no layout; Task 4 adds `(tabs)/home/_layout.tsx` before any other screen is
  added under it. Follow the exact convention already used by `(auth)/_layout.tsx`:
  `headerShown: false` and no native title — every screen in this app renders its own manual
  title/back-link `Text`/`Pressable`, never a native header.
- Screens stay presentational; business logic (fetching, mutation, navigation-on-success) lives
  in hooks under `src/hooks/`, matching every existing screen in this codebase.
- No screen-level (component) tests exist anywhere in this codebase today — confirmed during
  mobile-app-foundation's final review (`find` over the whole `app/` tree found zero test files
  for any screen). This plan follows that same precedent: `MatchForm.tsx`, `create-match.tsx`,
  and `match/[id].tsx` have no dedicated test files; their logic is covered by testing the hooks
  and API functions they call, plus manual end-to-end verification in Task 8.
- Supabase JS chainable mocks in this codebase follow a specific nesting style — see
  `mobile/src/api/users.test.ts` for the canonical example (`{ select: jest.fn().mockReturnValue({
  eq: jest.fn().mockReturnValue({ single }) }) }`). Match that style exactly for any new
  `matches.ts` test so mock shapes stay consistent project-wide.
- Use the Node version pinned by `mobile/.nvmrc` (`24.13.0`) for any `npm`/`npx expo` command — a
  documented bug in npm 12.0.2 breaks `create-expo-app`-family commands on other versions
  (already resolved once in this project; stay on the pinned version to avoid re-discovering it).

---

### Task 1: Match data layer — types, create/read/update/delete API

**Files:**
- Modify: `mobile/src/types/database.ts`
- Modify: `mobile/src/api/matches.ts`
- Modify: `mobile/src/api/matches.test.ts`

**Interfaces:**
- Consumes: `supabase` (`src/api/supabase.ts`, already exists).
- Produces: `Match`, `NewMatch`, `MatchEditableFields` types; `createMatch(input: NewMatch):
  Promise<Match>`, `fetchMatchById(id: string): Promise<Match>`, `updateMatch(id: string, input:
  MatchEditableFields): Promise<Match>`, `deleteMatch(id: string): Promise<void>` — all from
  `src/api/matches.ts`, consumed by Task 2 (`useMatchDetail`) and Task 5 (`useCreateMatch`).
  `fetchNearbyMatches`/`NearbyMatch` (already exist in this file) are untouched.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `mobile/src/api/matches.test.ts` with:

```ts
// mobile/src/api/matches.test.ts
import { supabase } from './supabase';
import { fetchNearbyMatches, createMatch, fetchMatchById, updateMatch, deleteMatch } from './matches';

jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));

describe('matches api', () => {
  afterEach(() => jest.clearAllMocks());

  describe('fetchNearbyMatches', () => {
    it('calls the nearby_open_matches RPC with the given coordinates and default radius', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ data: [{ id: 'm1', field_name: 'Campo Test' }], error: null });
      const result = await fetchNearbyMatches(38.1157, 13.3615);
      expect(supabase.rpc).toHaveBeenCalledWith('nearby_open_matches', {
        user_lat: 38.1157,
        user_lng: 13.3615,
        radius_km: 20,
      });
      expect(result).toHaveLength(1);
    });

    it('accepts a custom radius', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ data: [], error: null });
      await fetchNearbyMatches(38.1157, 13.3615, 5);
      expect(supabase.rpc).toHaveBeenCalledWith('nearby_open_matches', {
        user_lat: 38.1157,
        user_lng: 13.3615,
        radius_km: 5,
      });
    });

    it('throws the Supabase error message on failure', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: { message: 'connection failed' } });
      await expect(fetchNearbyMatches(0, 0)).rejects.toThrow('connection failed');
    });
  });

  const sampleMatch = {
    id: 'm1',
    creator_id: 'u1',
    match_type: 5,
    field_name: 'Campo Test',
    address: 'Via Test 1',
    latitude: 38.1157,
    longitude: 13.3615,
    match_date: '2026-09-05',
    start_time: '19:00:00',
    end_time: '20:30:00',
    max_players: 10,
    description: null,
    status: 'open',
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
  };

  const newMatchInput = {
    creator_id: 'u1',
    match_type: 5 as const,
    field_name: 'Campo Test',
    address: 'Via Test 1',
    latitude: 38.1157,
    longitude: 13.3615,
    match_date: '2026-09-05',
    start_time: '19:00',
    end_time: '20:30',
    max_players: 10,
    description: null,
  };

  const editableFields = {
    match_type: 5 as const,
    field_name: 'Campo Nuovo',
    address: 'Via Test 1',
    match_date: '2026-09-05',
    start_time: '19:00',
    end_time: '20:30',
    max_players: 10,
    description: null,
  };

  describe('createMatch', () => {
    it('inserts a new match and returns it', async () => {
      const single = jest.fn().mockResolvedValue({ data: sampleMatch, error: null });
      const select = jest.fn().mockReturnValue({ single });
      const insert = jest.fn().mockReturnValue({ select });
      (supabase.from as jest.Mock).mockReturnValue({ insert });

      const result = await createMatch(newMatchInput);

      expect(supabase.from).toHaveBeenCalledWith('matches');
      expect(insert).toHaveBeenCalledWith([expect.objectContaining({ creator_id: 'u1', field_name: 'Campo Test' })]);
      expect(result).toEqual(sampleMatch);
    });

    it('throws the Supabase error message on failure', async () => {
      const single = jest.fn().mockResolvedValue({ data: null, error: { message: 'insert failed' } });
      const select = jest.fn().mockReturnValue({ single });
      const insert = jest.fn().mockReturnValue({ select });
      (supabase.from as jest.Mock).mockReturnValue({ insert });

      await expect(createMatch(newMatchInput)).rejects.toThrow('insert failed');
    });
  });

  describe('fetchMatchById', () => {
    it('selects a single match by id', async () => {
      const single = jest.fn().mockResolvedValue({ data: sampleMatch, error: null });
      const eq = jest.fn().mockReturnValue({ single });
      const select = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ select });

      const result = await fetchMatchById('m1');

      expect(supabase.from).toHaveBeenCalledWith('matches');
      expect(eq).toHaveBeenCalledWith('id', 'm1');
      expect(result).toEqual(sampleMatch);
    });

    it('throws the Supabase error message on failure', async () => {
      const single = jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } });
      const eq = jest.fn().mockReturnValue({ single });
      const select = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ select });

      await expect(fetchMatchById('missing')).rejects.toThrow('not found');
    });
  });

  describe('updateMatch', () => {
    it('updates the given fields on a match and returns the updated row', async () => {
      const updated = { ...sampleMatch, field_name: 'Campo Nuovo' };
      const single = jest.fn().mockResolvedValue({ data: updated, error: null });
      const select = jest.fn().mockReturnValue({ single });
      const eq = jest.fn().mockReturnValue({ select });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      const result = await updateMatch('m1', editableFields);

      expect(supabase.from).toHaveBeenCalledWith('matches');
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ field_name: 'Campo Nuovo' }));
      expect(eq).toHaveBeenCalledWith('id', 'm1');
      expect(result.field_name).toBe('Campo Nuovo');
    });

    it('throws the Supabase error message on failure', async () => {
      const single = jest.fn().mockResolvedValue({ data: null, error: { message: 'update failed' } });
      const select = jest.fn().mockReturnValue({ single });
      const eq = jest.fn().mockReturnValue({ select });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await expect(updateMatch('m1', editableFields)).rejects.toThrow('update failed');
    });
  });

  describe('deleteMatch', () => {
    it('deletes the match by id', async () => {
      const eq = jest.fn().mockResolvedValue({ error: null });
      const del = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ delete: del });

      await deleteMatch('m1');

      expect(supabase.from).toHaveBeenCalledWith('matches');
      expect(eq).toHaveBeenCalledWith('id', 'm1');
    });

    it('throws the Supabase error message on failure', async () => {
      const eq = jest.fn().mockResolvedValue({ error: { message: 'delete failed' } });
      const del = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ delete: del });

      await expect(deleteMatch('m1')).rejects.toThrow('delete failed');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile && npm test -- matches.test.ts`
Expected: FAIL — `createMatch`, `fetchMatchById`, `updateMatch`, `deleteMatch` are not exported
by `./matches` yet.

- [ ] **Step 3: Add the `matches` row type to `database.ts`**

Add a `matches` entry alongside the existing `users` entry in
`mobile/src/types/database.ts` (keep `users` exactly as it is):

```ts
export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          unique_user_id: string;
          phone: string;
          first_name: string;
          last_name: string;
          birth_date: string;
          height_cm: number;
          preferred_foot: 'left' | 'right' | 'both';
          player_role: 'player' | 'goalkeeper' | 'both';
          profile_image_url: string | null;
          matches_played_count: number;
          matches_completed_count: number;
          matches_abandoned_count: number;
          created_at: string;
          updated_at: string;
        };
      };
      matches: {
        Row: {
          id: string;
          creator_id: string;
          match_type: 5 | 7 | 8;
          field_name: string;
          address: string;
          latitude: number;
          longitude: number;
          match_date: string;
          start_time: string;
          end_time: string;
          max_players: number;
          description: string | null;
          status: 'draft' | 'open' | 'full' | 'started' | 'completed' | 'cancelled';
          created_at: string;
          updated_at: string;
        };
      };
    };
  };
}
```

- [ ] **Step 4: Implement the API functions**

Replace the full contents of `mobile/src/api/matches.ts` with:

```ts
// mobile/src/api/matches.ts
import { supabase } from './supabase';
import type { Database } from '@/types/database';

export interface NearbyMatch {
  id: string;
  field_name: string;
  match_type: 5 | 7 | 8;
  match_date: string;
  start_time: string;
  end_time: string;
  max_players: number;
  distance_km: number;
  approved_players_count: number;
}

export async function fetchNearbyMatches(lat: number, lng: number, radiusKm = 20): Promise<NearbyMatch[]> {
  const { data, error } = await supabase.rpc('nearby_open_matches', {
    user_lat: lat,
    user_lng: lng,
    radius_km: radiusKm,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as NearbyMatch[];
}

export type Match = Database['public']['Tables']['matches']['Row'];

export type NewMatch = Pick<
  Match,
  | 'creator_id'
  | 'match_type'
  | 'field_name'
  | 'address'
  | 'latitude'
  | 'longitude'
  | 'match_date'
  | 'start_time'
  | 'end_time'
  | 'max_players'
  | 'description'
>;

// Location is captured once at creation from the creator's device GPS and is
// never editable afterward in this MVP -- omitting lat/lng here makes that a
// compile-time guarantee for every updateMatch call site, not just a UI rule.
export type MatchEditableFields = Omit<NewMatch, 'creator_id' | 'latitude' | 'longitude'>;

export async function createMatch(input: NewMatch): Promise<Match> {
  const { data, error } = await supabase.from('matches').insert([input]).select().single();
  if (error) throw new Error(error.message);
  return data as Match;
}

export async function fetchMatchById(id: string): Promise<Match> {
  const { data, error } = await supabase.from('matches').select().eq('id', id).single();
  if (error) throw new Error(error.message);
  return data as Match;
}

export async function updateMatch(id: string, input: MatchEditableFields): Promise<Match> {
  const { data, error } = await supabase.from('matches').update(input).eq('id', id).select().single();
  if (error) throw new Error(error.message);
  return data as Match;
}

export async function deleteMatch(id: string): Promise<void> {
  const { error } = await supabase.from('matches').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd mobile && npm test -- matches.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 6: Run full suite and typecheck**

Run: `cd mobile && npm test && npm run typecheck`
Expected: all passing, no type errors.

- [ ] **Step 7: Commit**

```bash
cd "/Users/giovanni/Desktop/app calcio"
git add mobile/src/types/database.ts mobile/src/api/matches.ts mobile/src/api/matches.test.ts
git commit -m "feat: add create/read/update/delete API for matches"
```

---

### Task 2: `useMatchDetail` hook

**Files:**
- Create: `mobile/src/hooks/useMatchDetail.ts`
- Create: `mobile/src/hooks/useMatchDetail.test.ts`

**Interfaces:**
- Consumes: `fetchMatchById`, `updateMatch`, `deleteMatch`, `Match`, `MatchEditableFields` from
  Task 1's `src/api/matches.ts`.
- Produces: `useMatchDetail(matchId: string): { match: Match | null; loading: boolean; error:
  string | null; refresh: () => Promise<void>; update: (input: MatchEditableFields) =>
  Promise<boolean>; remove: () => Promise<boolean> }` — consumed by Task 4's `match/[id].tsx`.

- [ ] **Step 1: Write the failing test**

```ts
// mobile/src/hooks/useMatchDetail.test.ts
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useMatchDetail } from './useMatchDetail';
import { fetchMatchById, updateMatch, deleteMatch } from '@/api/matches';

jest.mock('@/api/matches', () => ({
  fetchMatchById: jest.fn(),
  updateMatch: jest.fn(),
  deleteMatch: jest.fn(),
}));

const sampleMatch = {
  id: 'm1',
  creator_id: 'u1',
  match_type: 5,
  field_name: 'Campo Test',
  address: 'Via Test 1',
  latitude: 38.1157,
  longitude: 13.3615,
  match_date: '2026-09-05',
  start_time: '19:00:00',
  end_time: '20:30:00',
  max_players: 10,
  description: null,
  status: 'open',
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
};

const editableFields = {
  match_type: 5 as const,
  field_name: 'Campo Nuovo',
  address: 'Via Test 1',
  match_date: '2026-09-05',
  start_time: '19:00',
  end_time: '20:30',
  max_players: 10,
  description: null,
};

describe('useMatchDetail', () => {
  afterEach(() => jest.clearAllMocks());

  it('fetches the match by id on mount', async () => {
    (fetchMatchById as jest.Mock).mockResolvedValue(sampleMatch);

    // @testing-library/react-native@14's renderHook returns a Promise -- await it
    // (a real version-specific requirement, verified against the installed package's
    // own source, not a style choice -- applies to every renderHook call in this plan).
    const { result } = await renderHook(() => useMatchDetail('m1'));

    await waitFor(() => expect(result.current.match).toEqual(sampleMatch));
    expect(fetchMatchById).toHaveBeenCalledWith('m1');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('exposes an error when fetching fails', async () => {
    (fetchMatchById as jest.Mock).mockRejectedValue(new Error('not found'));

    const { result } = await renderHook(() => useMatchDetail('missing'));

    await waitFor(() => expect(result.current.error).toBe('not found'));
    expect(result.current.match).toBeNull();
  });

  it('update calls updateMatch and replaces the local match on success', async () => {
    (fetchMatchById as jest.Mock).mockResolvedValue(sampleMatch);
    const updatedMatch = { ...sampleMatch, field_name: 'Campo Nuovo' };
    (updateMatch as jest.Mock).mockResolvedValue(updatedMatch);

    const { result } = await renderHook(() => useMatchDetail('m1'));
    await waitFor(() => expect(result.current.match).toEqual(sampleMatch));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.update(editableFields);
    });

    expect(updateMatch).toHaveBeenCalledWith('m1', expect.objectContaining({ field_name: 'Campo Nuovo' }));
    expect(success).toBe(true);
    expect(result.current.match).toEqual(updatedMatch);
  });

  it('update sets an error and returns false on failure', async () => {
    (fetchMatchById as jest.Mock).mockResolvedValue(sampleMatch);
    (updateMatch as jest.Mock).mockRejectedValue(new Error('update failed'));

    const { result } = await renderHook(() => useMatchDetail('m1'));
    await waitFor(() => expect(result.current.match).toEqual(sampleMatch));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.update(editableFields);
    });

    expect(success).toBe(false);
    expect(result.current.error).toBe('update failed');
    expect(result.current.match).toEqual(sampleMatch);
  });

  it('remove calls deleteMatch and returns true on success', async () => {
    (fetchMatchById as jest.Mock).mockResolvedValue(sampleMatch);
    (deleteMatch as jest.Mock).mockResolvedValue(undefined);

    const { result } = await renderHook(() => useMatchDetail('m1'));
    await waitFor(() => expect(result.current.match).toEqual(sampleMatch));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.remove();
    });

    expect(deleteMatch).toHaveBeenCalledWith('m1');
    expect(success).toBe(true);
  });

  it('remove sets an error and returns false on failure', async () => {
    (fetchMatchById as jest.Mock).mockResolvedValue(sampleMatch);
    (deleteMatch as jest.Mock).mockRejectedValue(new Error('delete failed'));

    const { result } = await renderHook(() => useMatchDetail('m1'));
    await waitFor(() => expect(result.current.match).toEqual(sampleMatch));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.remove();
    });

    expect(success).toBe(false);
    expect(result.current.error).toBe('delete failed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- useMatchDetail.test.ts`
Expected: FAIL — `./useMatchDetail` doesn't exist yet.

- [ ] **Step 3: Implement the hook**

```ts
// mobile/src/hooks/useMatchDetail.ts
import { useCallback, useEffect, useState } from 'react';
import { fetchMatchById, updateMatch, deleteMatch, type Match, type MatchEditableFields } from '@/api/matches';

export function useMatchDetail(matchId: string) {
  const [match, setMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchMatchById(matchId);
      setMatch(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile caricare la partita.');
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    load();
  }, [load]);

  async function update(input: MatchEditableFields): Promise<boolean> {
    setError(null);
    try {
      const result = await updateMatch(matchId, input);
      setMatch(result);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile aggiornare la partita.');
      return false;
    }
  }

  async function remove(): Promise<boolean> {
    setError(null);
    try {
      await deleteMatch(matchId);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile cancellare la partita.');
      return false;
    }
  }

  return { match, loading, error, refresh: load, update, remove };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- useMatchDetail.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
cd "/Users/giovanni/Desktop/app calcio"
git add mobile/src/hooks/useMatchDetail.ts mobile/src/hooks/useMatchDetail.test.ts
git commit -m "feat: add useMatchDetail hook for fetch/update/delete"
```

---

### Task 3: `MatchForm` shared component

**Files:**
- Create: `mobile/src/components/MatchForm.tsx`

**Interfaces:**
- Produces: `MatchForm` component and `MatchFormValues` type, consumed by Task 4
  (`match/[id].tsx`, edit mode) and Task 6 (`create-match.tsx`).
- No dedicated test file — see this plan's Global Constraints on the no-screen/no-presentational-
  component-tests precedent already established in this codebase.

- [ ] **Step 1: Implement the component**

```tsx
// mobile/src/components/MatchForm.tsx
import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';

const MATCH_TYPES = [5, 7, 8] as const;
const DEFAULT_MAX_PLAYERS: Record<(typeof MATCH_TYPES)[number], number> = { 5: 10, 7: 14, 8: 16 };

export interface MatchFormValues {
  matchType: 5 | 7 | 8;
  fieldName: string;
  address: string;
  matchDate: string;
  startTime: string;
  endTime: string;
  maxPlayers: string;
  description: string;
}

interface MatchFormProps {
  initialValues?: MatchFormValues;
  onSubmit: (values: MatchFormValues) => void;
  submitLabel: string;
  loading?: boolean;
  error?: string | null;
}

export function MatchForm({ initialValues, onSubmit, submitLabel, loading, error }: MatchFormProps) {
  const [matchType, setMatchType] = useState<5 | 7 | 8>(initialValues?.matchType ?? 5);
  const [fieldName, setFieldName] = useState(initialValues?.fieldName ?? '');
  const [address, setAddress] = useState(initialValues?.address ?? '');
  const [matchDate, setMatchDate] = useState(initialValues?.matchDate ?? '');
  const [startTime, setStartTime] = useState(initialValues?.startTime ?? '');
  const [endTime, setEndTime] = useState(initialValues?.endTime ?? '');
  const [maxPlayers, setMaxPlayers] = useState(initialValues?.maxPlayers ?? String(DEFAULT_MAX_PLAYERS[5]));
  const [description, setDescription] = useState(initialValues?.description ?? '');

  function handleMatchTypeChange(type: 5 | 7 | 8) {
    setMatchType(type);
    // Only auto-fill the suggested default when this is a fresh creation (no
    // initialValues) AND the user hasn't already typed a custom max-players
    // value away from the current type's own default.
    if (!initialValues && maxPlayers === String(DEFAULT_MAX_PLAYERS[matchType])) {
      setMaxPlayers(String(DEFAULT_MAX_PLAYERS[type]));
    }
  }

  const canSubmit = !!(fieldName && address && matchDate && startTime && endTime && maxPlayers);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.label}>Tipo partita</Text>
      <View style={styles.row}>
        {MATCH_TYPES.map((type) => (
          <Pressable
            key={type}
            style={[styles.chip, matchType === type && styles.chipSelected]}
            onPress={() => handleMatchTypeChange(type)}
          >
            <Text style={matchType === type ? styles.chipTextSelected : styles.chipText}>{type}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput style={styles.input} placeholder="Nome campo" value={fieldName} onChangeText={setFieldName} />
      <TextInput style={styles.input} placeholder="Indirizzo" value={address} onChangeText={setAddress} />
      <TextInput
        style={styles.input}
        placeholder="Data (AAAA-MM-GG)"
        value={matchDate}
        onChangeText={setMatchDate}
      />
      <TextInput
        style={styles.input}
        placeholder="Ora inizio (HH:MM)"
        value={startTime}
        onChangeText={setStartTime}
      />
      <TextInput style={styles.input} placeholder="Ora fine (HH:MM)" value={endTime} onChangeText={setEndTime} />
      <TextInput
        style={styles.input}
        placeholder="Numero massimo giocatori"
        keyboardType="number-pad"
        value={maxPlayers}
        onChangeText={setMaxPlayers}
      />
      <TextInput
        style={[styles.input, styles.multiline]}
        placeholder="Descrizione (opzionale)"
        value={description}
        onChangeText={setDescription}
        multiline
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        style={styles.button}
        disabled={loading || !canSubmit}
        onPress={() =>
          onSubmit({ matchType, fieldName, address, matchDate, startTime, endTime, maxPlayers, description })
        }
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{submitLabel}</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 12 },
  label: { fontWeight: '600', marginTop: 8 },
  row: { flexDirection: 'row', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#ccc', borderRadius: 20, paddingVertical: 8, paddingHorizontal: 16 },
  chipSelected: { backgroundColor: '#1a7f37', borderColor: '#1a7f37' },
  chipText: { color: '#333' },
  chipTextSelected: { color: '#fff' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 16 },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  button: { backgroundColor: '#1a7f37', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 16 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  error: { color: '#c0392b' },
});
```

- [ ] **Step 2: Typecheck**

Run: `cd mobile && npm run typecheck`
Expected: no type errors. (No jest run needed — no test file for this task, see Interfaces above.)

- [ ] **Step 3: Commit**

```bash
cd "/Users/giovanni/Desktop/app calcio"
git add mobile/src/components/MatchForm.tsx
git commit -m "feat: add shared MatchForm component for create/edit"
```

---

### Task 4: Home tab stack layout + match detail screen

**Files:**
- Create: `mobile/app/(tabs)/home/_layout.tsx`
- Create: `mobile/app/(tabs)/home/match/[id].tsx`

**Interfaces:**
- Consumes: `useMatchDetail` (Task 2), `MatchForm`/`MatchFormValues` (Task 3), `useSessionStore`
  (`session.user.id`, already exists from mobile-app-foundation).
- Produces: route `/(tabs)/home/match/[id]`, consumed by Task 5's `useCreateMatch` (navigates
  here on successful creation) and Task 7's Home screen (navigates here on a `MatchCard` tap).
  Because this task creates the route before either later task needs to reference it, neither
  needs a forward-reference type cast for it.

- [ ] **Step 1: Add the Home tab's Stack layout**

```tsx
// mobile/app/(tabs)/home/_layout.tsx
import { Stack } from 'expo-router';

export default function HomeLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="create-match" />
      <Stack.Screen name="match/[id]" />
    </Stack>
  );
}
```

- [ ] **Step 2: Create the match detail screen**

```tsx
// mobile/app/(tabs)/home/match/[id].tsx
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMatchDetail } from '@/hooks/useMatchDetail';
import { useSessionStore } from '@/stores/sessionStore';
import { MatchForm, type MatchFormValues } from '@/components/MatchForm';

export default function MatchDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const userId = useSessionStore((s) => s.session?.user.id);
  const { match, loading, error, update, remove } = useMatchDetail(id);
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
  // populated across those failures (Task 2's own contract). Gating on
  // `!match` alone (not `error || !match`) is what keeps a failed edit on
  // the edit form and a failed delete on the detail view, instead of both
  // ejecting the user to this generic screen.
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
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 8 },
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
});
```

- [ ] **Step 3: Run full suite and typecheck**

Run: `cd mobile && npm test && npm run typecheck`
Expected: all passing, no type errors. (`useLocalSearchParams` and `expo-router` navigation types
resolve once `.expo/types/router.d.ts` regenerates — this happens automatically the next time the
dev server runs; a stale copy on disk before then is a known, self-resolving quirk already
documented in mobile-app-foundation's plan, not a bug in this task.)

- [ ] **Step 4: Commit**

```bash
cd "/Users/giovanni/Desktop/app calcio"
git add "mobile/app/(tabs)/home/_layout.tsx" "mobile/app/(tabs)/home/match"
git commit -m "feat: add Home tab stack layout and match detail screen"
```

---

### Task 5: `useCreateMatch` hook

**Files:**
- Create: `mobile/src/hooks/useCreateMatch.ts`
- Create: `mobile/src/hooks/useCreateMatch.test.ts`

**Interfaces:**
- Consumes: `createMatch` (Task 1), `useSessionStore` (existing), `MatchFormValues` (Task 3),
  route `/(tabs)/home/match/[id]` (Task 4, already exists by this task — no forward-reference
  cast needed), `expo-location` (same permission-request pattern already used by
  `useNearbyMatches`).
- Produces: `useCreateMatch(): { create: (values: MatchFormValues) => Promise<void>; loading:
  boolean; error: string | null; permissionDenied: boolean }` — consumed by Task 6's
  `create-match.tsx`.

- [ ] **Step 1: Write the failing test**

```ts
// mobile/src/hooks/useCreateMatch.test.ts
import { renderHook, act } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { useCreateMatch } from './useCreateMatch';
import { createMatch } from '@/api/matches';
import { useSessionStore } from '@/stores/sessionStore';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-location');
jest.mock('@/api/matches', () => ({ createMatch: jest.fn() }));

const formValues = {
  matchType: 5 as const,
  fieldName: 'Campo Test',
  address: 'Via Test 1',
  matchDate: '2026-09-05',
  startTime: '19:00',
  endTime: '20:30',
  maxPlayers: '10',
  description: '',
};

describe('useCreateMatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSessionStore.setState({
      session: { user: { id: 'u1' } } as never,
      profile: null,
      status: 'signed-in',
    });
  });

  it('requests location permission, creates the match with the current position, and navigates to its detail page', async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
      coords: { latitude: 38.1157, longitude: 13.3615 },
    });
    (createMatch as jest.Mock).mockResolvedValue({ id: 'm1' });

    // @testing-library/react-native@14's renderHook returns a Promise -- await it.
    const { result } = await renderHook(() => useCreateMatch());

    await act(async () => {
      await result.current.create(formValues);
    });

    expect(createMatch).toHaveBeenCalledWith(
      expect.objectContaining({
        creator_id: 'u1',
        latitude: 38.1157,
        longitude: 13.3615,
        field_name: 'Campo Test',
        max_players: 10,
      })
    );
    expect(router.push).toHaveBeenCalledWith({ pathname: '/(tabs)/home/match/[id]', params: { id: 'm1' } });
    expect(result.current.error).toBeNull();
  });

  it('sets permissionDenied and does not create a match when location permission is refused', async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });

    const { result } = await renderHook(() => useCreateMatch());

    await act(async () => {
      await result.current.create(formValues);
    });

    expect(result.current.permissionDenied).toBe(true);
    expect(createMatch).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('sets an error and does not navigate when creating the match fails', async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
      coords: { latitude: 38.1157, longitude: 13.3615 },
    });
    (createMatch as jest.Mock).mockRejectedValue(new Error('insert failed'));

    const { result } = await renderHook(() => useCreateMatch());

    await act(async () => {
      await result.current.create(formValues);
    });

    expect(result.current.error).toBe('insert failed');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('sets an error and does not attempt location/creation when there is no session', async () => {
    useSessionStore.setState({ session: null, profile: null, status: 'signed-out' });

    const { result } = await renderHook(() => useCreateMatch());

    await act(async () => {
      await result.current.create(formValues);
    });

    expect(result.current.error).toBeTruthy();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(createMatch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- useCreateMatch.test.ts`
Expected: FAIL — `./useCreateMatch` doesn't exist yet.

- [ ] **Step 3: Implement the hook**

```ts
// mobile/src/hooks/useCreateMatch.ts
import { useState } from 'react';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { createMatch } from '@/api/matches';
import { useSessionStore } from '@/stores/sessionStore';
import type { MatchFormValues } from '@/components/MatchForm';

export function useCreateMatch() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const session = useSessionStore((s) => s.session);

  async function create(values: MatchFormValues) {
    if (!session) {
      setError('Devi essere autenticato per creare una partita.');
      return;
    }
    setLoading(true);
    setError(null);
    setPermissionDenied(false);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setPermissionDenied(true);
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      const match = await createMatch({
        creator_id: session.user.id,
        match_type: values.matchType,
        field_name: values.fieldName,
        address: values.address,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        match_date: values.matchDate,
        start_time: values.startTime,
        end_time: values.endTime,
        max_players: Number(values.maxPlayers),
        description: values.description || null,
      });
      router.push({ pathname: '/(tabs)/home/match/[id]', params: { id: match.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile creare la partita.');
    } finally {
      setLoading(false);
    }
  }

  return { create, loading, error, permissionDenied };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- useCreateMatch.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
cd "/Users/giovanni/Desktop/app calcio"
git add mobile/src/hooks/useCreateMatch.ts mobile/src/hooks/useCreateMatch.test.ts
git commit -m "feat: add useCreateMatch hook (GPS capture + create + navigate)"
```

---

### Task 6: Create-match screen

**Files:**
- Create: `mobile/app/(tabs)/home/create-match.tsx`

**Interfaces:**
- Consumes: `MatchForm` (Task 3), `useCreateMatch` (Task 5).
- Produces: route `/(tabs)/home/create-match`, consumed by Task 7's Home screen.

- [ ] **Step 1: Implement the screen**

```tsx
// mobile/app/(tabs)/home/create-match.tsx
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { MatchForm } from '@/components/MatchForm';
import { useCreateMatch } from '@/hooks/useCreateMatch';

export default function CreateMatchScreen() {
  const router = useRouter();
  const { create, loading, error, permissionDenied } = useCreateMatch();

  if (permissionDenied) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Attiva la posizione</Text>
        <Text style={styles.subtitle}>
          Per creare una partita abbiamo bisogno della posizione del tuo dispositivo, che useremo
          come posizione del campo.
        </Text>
        <Pressable style={styles.button} onPress={() => router.back()}>
          <Text style={styles.buttonText}>Torna alla Home</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Pressable onPress={() => router.back()}>
        <Text style={styles.backLink}>← Annulla</Text>
      </Pressable>
      <Text style={styles.title}>Crea partita</Text>
      <MatchForm onSubmit={create} submitLabel="Crea partita" loading={loading} error={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 24, paddingHorizontal: 24 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 8 },
  subtitle: { color: '#666', textAlign: 'center' },
  backLink: { color: '#1a7f37', marginBottom: 8 },
  button: { backgroundColor: '#1a7f37', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 20, marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '600' },
});
```

- [ ] **Step 2: Run full suite and typecheck**

Run: `cd mobile && npm test && npm run typecheck`
Expected: all passing, no type errors.

- [ ] **Step 3: Commit**

```bash
cd "/Users/giovanni/Desktop/app calcio"
git add "mobile/app/(tabs)/home/create-match.tsx"
git commit -m "feat: add create-match screen"
```

---

### Task 7: Wire the create button and match navigation into Home

**Files:**
- Modify: `mobile/app/(tabs)/home/index.tsx`

**Interfaces:**
- Consumes: route `/(tabs)/home/create-match` (Task 6), route `/(tabs)/home/match/[id]`
  (Task 4) — both already exist by this task, no forward-reference casts needed.
- Produces: nothing new consumed elsewhere; this is the final integration point of this plan.

- [ ] **Step 1: Replace the full contents of `index.tsx`**

```tsx
// mobile/app/(tabs)/home/index.tsx
import { View, Text, FlatList, ActivityIndicator, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useNearbyMatches } from '@/hooks/useNearbyMatches';
import { MatchCard } from '@/components/MatchCard';

export default function HomeScreen() {
  const router = useRouter();
  const { matches, loading, error, permissionDenied, refresh } = useNearbyMatches();

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
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>Partite vicino a te</Text>
        <Pressable style={styles.createButton} onPress={() => router.push('/(tabs)/home/create-match')}>
          <Text style={styles.createButtonText}>+ Crea</Text>
        </Pressable>
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
  container: { flex: 1, paddingTop: 16 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  header: { fontSize: 22, fontWeight: '700' },
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

- [ ] **Step 2: Run full suite and typecheck**

Run: `cd mobile && npm test && npm run typecheck`
Expected: all passing, no type errors.

- [ ] **Step 3: Commit**

```bash
cd "/Users/giovanni/Desktop/app calcio"
git add "mobile/app/(tabs)/home/index.tsx"
git commit -m "feat: wire create-match and match detail navigation into Home"
```

---

### Task 8: End-to-end manual verification in the iOS Simulator

**Files:** none (verification only).

**Interfaces:** none — this task exercises every interface produced by Tasks 1-7 together,
against the real local Supabase backend.

- [ ] **Step 1: Confirm the backend is up**

Run: `cd "/Users/giovanni/Desktop/app calcio" && supabase status`
Expected: all services running. If not, `supabase start`.

- [ ] **Step 2: Boot the Expo dev server and open it in the iOS Simulator**

Use the iOS Simulator tool (`attach` first so the panel is visible, then `launch`/build via
Expo's own tooling: `cd mobile && npx expo run:ios`, or `npx expo start` and open the already-
built app). If a previously-built `mobile.app` from mobile-app-foundation's own Task 9 is still
installed and Metro is reachable, a plain relaunch + Metro restart is enough — no rebuild needed,
since this plan adds no new native dependencies.

- [ ] **Step 3: Log in as the existing test user**

Using the phone/password from mobile-app-foundation's own manual verification
(`+390000000001`, or whatever password is currently set for that account — reset it via
Supabase's admin API if forgotten, exactly as done during that plan's own Task 9), confirm you
land on the Home tab.

- [ ] **Step 4: Create a match**

Tap "+ Crea". Fill in: tipo `5`, nome campo `Campo Test`, indirizzo `Via Test 1`, data (any
future `AAAA-MM-GG`), ora inizio/fine, lascia il numero massimo giocatori al valore precompilato
`10`. Submit.

Expected: a location-permission prompt if not already granted (accept it, or if testing in the
simulator, set a location first via Features → Location, matching mobile-app-foundation's own
Task 9 pattern: `xcrun simctl location <udid> set 38.1157,13.3615`); after submitting, lands on
the new match's detail page showing exactly what was entered.

- [ ] **Step 5: Verify it appears in Home**

Tap "← Torna alla Home". Confirm the newly created match appears in the list (pull-to-refresh if
needed — `useNearbyMatches` only fetches on mount, and Expo Router's Stack keeps Home mounted
across a push/pop, so returning to it doesn't automatically re-fetch). It will show a correct,
near-zero distance, since its location is your current device location, per this plan's own
design.

- [ ] **Step 6: Edit the match**

Tap the match card to reopen its detail page. Tap "Modifica", change the nome campo to
`Campo Test Modificato`, save. Confirm the detail page now shows the updated name, and that
`Home` (after `← Torna alla Home`) also reflects it (pull-to-refresh if needed).

- [ ] **Step 7: Cancel the match**

Reopen the match detail, tap "Cancella partita", confirm in the native alert. Confirm you land
back on Home and the match no longer appears in the list.

- [ ] **Step 8: Record the outcome**

If every check in Steps 3-7 passes, this task (and the plan) is complete. If anything fails,
treat it as a normal bug: fix the specific hook/screen/API wrapper responsible, re-run the
affected Jest tests, and repeat this task's manual walkthrough from the failing step.

---

## What this plan does not cover (by design)

- Participation requests, creator approval, `match_participants` — a match created here has no
  way for anyone but its creator to join it yet. This is explicitly the next follow-up plan
  (mirrors the same scoping decision mobile-app-foundation made for this plan).
- Match room chat (`match_messages`).
- Google Places/Maps address autocomplete or any interactive map/pin placement — address is
  free text, location is the creator's device GPS at creation time (see the spec's known
  limitation).
- Editing a match's location after creation.
- Any change to `nearby_open_matches` or other backend RPCs/RLS — none needed, all already exist
  and already work correctly with matches created by this plan's code.
