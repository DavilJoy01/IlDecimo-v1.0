# Inviti diretti alla partita — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a match's creator invite a friend directly to that match, surfaced to the invitee via the existing Notifiche list.

**Architecture:** Pure mobile slice — the backend (`match_invitations` table, its RLS, its triggers, the `match_invitation` notification type) already exists in full and needs zero changes. Add a thin data-layer file, one hook, one new screen, and two small edits to existing screens.

**Tech Stack:** React Native (Expo Router), Supabase JS client, Jest.

**Spec:** [docs/superpowers/specs/2026-09-07-match-invitations-design.md](../specs/2026-09-07-match-invitations-design.md)

## Global Constraints

- No new backend migration — `match_invitations`, its RLS, its triggers, and the `match_invitation` value in `notifications.type`'s check constraint all already exist. Verified directly against the dev DB before this plan was written, not assumed from the MVP spec alone.
- Errors surfaced from `matchInvitations.ts` insert paths must never show a raw Postgres/PostgREST string to the user — translate Postgres code `42501` to a neutral Italian message, same principle as `friendships.ts`'s `translateFriendshipError` and `privateMessages.ts`'s `translateMessagingError`. Do not reveal *why* an invite was denied (a mutual block is one possible cause, and revealing it would leak the block).
- `fetchInvitableFriends` excludes a friend from the picker if they have ANY existing row in `match_participants` for this match (any status) OR any existing row in `match_invitations` for this match (any status) — not just "active" ones. This keeps the picker's exclusion logic simple and guarantees `sendMatchInvitation` never hits the `(match_id, invitee_id)` unique constraint from the picker's own list.
- No `_layout.tsx` changes anywhere in this plan. Verified directly on the filesystem: `mobile/app/(tabs)/home/_layout.tsx` doesn't declare `match/[id]/chat` (which already works fine), and `match/[id]/` has no `_layout.tsx` of its own — a new sibling file `match/[id]/invite.tsx` needs neither. This is the opposite of the `(tabs)/<name>/index.tsx` + `(tabs)/<name>/[id].tsx` sibling pattern that caused the tab-promotion bug in `persone` and `messaggi` — this route is nested *under* a dynamic route, not a direct tab-folder sibling.
- Follow this codebase's established hook-mutation pattern exactly: after a mutating call succeeds, re-run the hook's own `load()` rather than splicing local state by hand (see `useFriendRequests.respond`/`.cancel`, both of which just `await load()` after the API call). Do not invent a hand-rolled optimistic-removal pattern that doesn't match this convention.
- Hook tests must follow `useFriends.test.ts`'s exact setup convention: `useSessionStore.setState({ session: ..., profile: null, status: 'signed-in' })` against the real Zustand store (never a manual selector mock), `jest.mock('@/api/<module>', () => ({ <named exports>: jest.fn() }))`, `await renderHook(...)` (the `await` is required — this project's installed `@testing-library/react-native` version needs it or `result.current` races the hook's own update), and every mutating call wrapped in `await act(async () => {...})`, never a bare `act(() => ...)`.

---

### Task 1: `matchInvitations.ts` data layer

**Files:**
- Create: `mobile/src/api/matchInvitations.ts`
- Test: `mobile/src/api/matchInvitations.test.ts`

**Interfaces:**
- Consumes: `supabase` client from `./supabase` (same import as every other file in `src/api/`).
- Produces:
  - `export interface InvitableFriend { user_id: string; first_name: string; last_name: string; profile_image_url: string | null; }`
  - `export async function fetchInvitableFriends(userId: string, matchId: string): Promise<InvitableFriend[]>`
  - `export async function sendMatchInvitation(matchId: string, inviterId: string, inviteeId: string): Promise<void>`
  - `export async function markInvitationViewed(matchId: string, inviteeId: string): Promise<void>`

- [ ] **Step 1: Write the failing tests**

```ts
// mobile/src/api/matchInvitations.test.ts
import { supabase } from './supabase';
import { fetchInvitableFriends, sendMatchInvitation, markInvitationViewed } from './matchInvitations';

jest.mock('./supabase', () => ({ supabase: { from: jest.fn() } }));

describe('matchInvitations api', () => {
  afterEach(() => jest.clearAllMocks());

  describe('fetchInvitableFriends', () => {
    it('returns friends minus existing participants and existing invitees', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'friendships') {
          return {
            select: jest.fn().mockReturnValue({
              or: jest.fn().mockReturnValue({
                eq: jest.fn().mockResolvedValue({
                  data: [
                    { requester_id: 'u1', receiver_id: 'u2' },
                    { requester_id: 'u3', receiver_id: 'u1' },
                    { requester_id: 'u1', receiver_id: 'u4' },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'user_public_profiles') {
          return {
            select: jest.fn().mockReturnValue({
              in: jest.fn().mockResolvedValue({
                data: [
                  { id: 'u2', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null },
                  { id: 'u3', first_name: 'Gino', last_name: 'Verdi', profile_image_url: null },
                  { id: 'u4', first_name: 'Anna', last_name: 'Neri', profile_image_url: null },
                ],
                error: null,
              }),
            }),
          };
        }
        if (table === 'match_participants') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: [{ user_id: 'u2' }], error: null }),
            }),
          };
        }
        if (table === 'match_invitations') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: [{ invitee_id: 'u4' }], error: null }),
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      });

      const result = await fetchInvitableFriends('u1', 'm1');

      // u2 excluded (already a participant), u4 excluded (already invited), u3 remains
      expect(result).toEqual([{ user_id: 'u3', first_name: 'Gino', last_name: 'Verdi', profile_image_url: null }]);
    });

    it('returns an empty array without querying anything else when there are no friendships', async () => {
      const eq = jest.fn().mockResolvedValue({ data: [], error: null });
      const or = jest.fn().mockReturnValue({ eq });
      const fromMock = jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ or }) });
      (supabase.from as jest.Mock).mockImplementation(fromMock);

      const result = await fetchInvitableFriends('u1', 'm1');

      expect(result).toEqual([]);
      expect(fromMock).toHaveBeenCalledTimes(1);
    });

    it('throws the Supabase error message when the friendships query fails', async () => {
      const eq = jest.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
      const or = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ select: jest.fn().mockReturnValue({ or }) });

      await expect(fetchInvitableFriends('u1', 'm1')).rejects.toThrow('boom');
    });
  });

  describe('sendMatchInvitation', () => {
    it('inserts an invitation row', async () => {
      const insertMock = jest.fn().mockResolvedValue({ error: null });
      (supabase.from as jest.Mock).mockReturnValue({ insert: insertMock });

      await sendMatchInvitation('m1', 'u1', 'u2');

      expect(supabase.from).toHaveBeenCalledWith('match_invitations');
      expect(insertMock).toHaveBeenCalledWith([{ match_id: 'm1', inviter_id: 'u1', invitee_id: 'u2' }]);
    });

    it('translates a 42501 RLS denial into a neutral Italian message', async () => {
      const insertMock = jest.fn().mockResolvedValue({
        error: { message: 'new row violates row-level security policy for table "match_invitations"', code: '42501' },
      });
      (supabase.from as jest.Mock).mockReturnValue({ insert: insertMock });

      await expect(sendMatchInvitation('m1', 'u1', 'u2')).rejects.toThrow('Non è possibile invitare questo utente.');
    });

    it('throws the raw message for a non-42501 error', async () => {
      const insertMock = jest.fn().mockResolvedValue({ error: { message: 'something else broke', code: 'XX000' } });
      (supabase.from as jest.Mock).mockReturnValue({ insert: insertMock });

      await expect(sendMatchInvitation('m1', 'u1', 'u2')).rejects.toThrow('something else broke');
    });
  });

  describe('markInvitationViewed', () => {
    it('updates the invitation status to viewed, scoped to sent status', async () => {
      const eqStatus = jest.fn().mockResolvedValue({ error: null });
      const eqInvitee = jest.fn().mockReturnValue({ eq: eqStatus });
      const eqMatch = jest.fn().mockReturnValue({ eq: eqInvitee });
      const updateMock = jest.fn().mockReturnValue({ eq: eqMatch });
      (supabase.from as jest.Mock).mockReturnValue({ update: updateMock });

      await markInvitationViewed('m1', 'u2');

      expect(supabase.from).toHaveBeenCalledWith('match_invitations');
      expect(updateMock).toHaveBeenCalledWith({ status: 'viewed' });
      expect(eqMatch).toHaveBeenCalledWith('match_id', 'm1');
      expect(eqInvitee).toHaveBeenCalledWith('invitee_id', 'u2');
      expect(eqStatus).toHaveBeenCalledWith('status', 'sent');
    });

    it('throws the Supabase error message on failure', async () => {
      const eqStatus = jest.fn().mockResolvedValue({ error: { message: 'update failed' } });
      const eqInvitee = jest.fn().mockReturnValue({ eq: eqStatus });
      const eqMatch = jest.fn().mockReturnValue({ eq: eqInvitee });
      (supabase.from as jest.Mock).mockReturnValue({ update: jest.fn().mockReturnValue({ eq: eqMatch }) });

      await expect(markInvitationViewed('m1', 'u2')).rejects.toThrow('update failed');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile && npx jest src/api/matchInvitations.test.ts`
Expected: FAIL with "Cannot find module './matchInvitations'"

- [ ] **Step 3: Write the implementation**

```ts
// mobile/src/api/matchInvitations.ts
import { supabase } from './supabase';

export interface InvitableFriend {
  user_id: string;
  first_name: string;
  last_name: string;
  profile_image_url: string | null;
}

// Postgres 42501 = insufficient_privilege, the code an RLS `with check`
// denial surfaces as -- covers the case where inviter and invitee have a
// mutual block (invisible to the inviter if THEY are the blocked party,
// so no specific reason is safe to show; mirrors friendships.ts's
// translateFriendshipError and privateMessages.ts's translateMessagingError).
function translateInvitationError(message: string, code?: string): string {
  if (code === '42501') return 'Non è possibile invitare questo utente.';
  return message;
}

// user_public_profiles is a VIEW with no PostgREST-discoverable FK from
// friendships.requester_id/receiver_id, so the friends lookup is two
// queries + a client-side merge (same shape as friendships.ts's own
// fetchFriends), then two more queries (existing participants, existing
// invitees for this match) reduced to exclusion sets client-side -- the
// same multi-query-merge pattern already established in messaggi's
// fetchConversations and persone's fetchFriends, not a new approach.
export async function fetchInvitableFriends(userId: string, matchId: string): Promise<InvitableFriend[]> {
  const { data: friendshipRows, error: friendshipsError } = await supabase
    .from('friendships')
    .select('requester_id, receiver_id')
    .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`)
    .eq('status', 'accepted');
  if (friendshipsError) throw new Error(friendshipsError.message);
  if (!friendshipRows || friendshipRows.length === 0) return [];

  const friendIds = friendshipRows.map((r) => (r.requester_id === userId ? r.receiver_id : r.requester_id));

  const { data: profiles, error: profilesError } = await supabase
    .from('user_public_profiles')
    .select('id, first_name, last_name, profile_image_url')
    .in('id', friendIds);
  if (profilesError) throw new Error(profilesError.message);

  const { data: participantRows, error: participantsError } = await supabase
    .from('match_participants')
    .select('user_id')
    .eq('match_id', matchId);
  if (participantsError) throw new Error(participantsError.message);

  const { data: invitationRows, error: invitationsError } = await supabase
    .from('match_invitations')
    .select('invitee_id')
    .eq('match_id', matchId);
  if (invitationsError) throw new Error(invitationsError.message);

  // Excludes ANY existing state (any participant status, any invitation
  // status) -- not just "active" ones. Keeps this exclusion simple and
  // guarantees sendMatchInvitation, called only against this list, never
  // hits the (match_id, invitee_id) unique constraint.
  const excluded = new Set<string>([
    ...(participantRows ?? []).map((r) => r.user_id),
    ...(invitationRows ?? []).map((r) => r.invitee_id),
  ]);

  return (profiles ?? [])
    .filter((p) => !excluded.has(p.id))
    .map((p) => ({
      user_id: p.id,
      first_name: p.first_name,
      last_name: p.last_name,
      profile_image_url: p.profile_image_url,
    }));
}

// No 23505-recovery needed here (unlike findOrCreateConversation in
// messaggi): fetchInvitableFriends already excludes anyone with an
// existing invitation, so a duplicate can only happen from a genuine
// double-tap race on the same friend -- the translated error below is an
// acceptable outcome for that narrow case, no recovery path needed.
export async function sendMatchInvitation(matchId: string, inviterId: string, inviteeId: string): Promise<void> {
  const { error } = await supabase
    .from('match_invitations')
    .insert([{ match_id: matchId, inviter_id: inviterId, invitee_id: inviteeId }]);
  if (error) throw new Error(translateInvitationError(error.message, error.code));
}

// Scoped to status = 'sent' so a second call (e.g. re-opening the same
// notification) is a harmless no-op, not an error -- the update simply
// matches zero rows.
export async function markInvitationViewed(matchId: string, inviteeId: string): Promise<void> {
  const { error } = await supabase
    .from('match_invitations')
    .update({ status: 'viewed' })
    .eq('match_id', matchId)
    .eq('invitee_id', inviteeId)
    .eq('status', 'sent');
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile && npx jest src/api/matchInvitations.test.ts`
Expected: PASS, all 8 tests

- [ ] **Step 5: Commit**

```bash
cd mobile
git add src/api/matchInvitations.ts src/api/matchInvitations.test.ts
git commit -m "$(cat <<'EOF'
feat: add match invitations data layer

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `useInvitableFriends` hook

**Files:**
- Create: `mobile/src/hooks/useInvitableFriends.ts`
- Test: `mobile/src/hooks/useInvitableFriends.test.ts`

**Interfaces:**
- Consumes: `fetchInvitableFriends`, `sendMatchInvitation`, `type InvitableFriend` from `@/api/matchInvitations` (Task 1); `useSessionStore` from `@/stores/sessionStore` (existing).
- Produces: `export function useInvitableFriends(matchId: string): { friends: InvitableFriend[]; loading: boolean; error: string | null; invite: (inviteeId: string) => Promise<boolean>; inviting: boolean; refresh: () => void }`

- [ ] **Step 1: Write the failing test**

This test follows the exact mock/setup convention already established in
`src/hooks/useFriends.test.ts` and `src/hooks/usePrivateMessages.test.ts`
(read either file before writing this one if anything below is unclear) —
`useSessionStore.setState(...)` against the real Zustand store, not a
manual selector mock; `jest.mock('@/api/matchInvitations', () => ({...}))`
with explicit named exports; `await renderHook(...)` (the `await` matters
— this project's installed `@testing-library/react-native` version needs
it); every mutating call wrapped in `await act(async () => {...})`, never
a bare `act(() => ...)`.

```ts
// mobile/src/hooks/useInvitableFriends.test.ts
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { useInvitableFriends } from './useInvitableFriends';
import { fetchInvitableFriends, sendMatchInvitation } from '@/api/matchInvitations';
import { useSessionStore } from '@/stores/sessionStore';

jest.mock('@/api/matchInvitations', () => ({
  fetchInvitableFriends: jest.fn(),
  sendMatchInvitation: jest.fn(),
}));

const friend = { user_id: 'u2', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null };

describe('useInvitableFriends', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSessionStore.setState({ session: { user: { id: 'u1' } } as never, profile: null, status: 'signed-in' });
  });

  it('loads invitable friends on mount', async () => {
    (fetchInvitableFriends as jest.Mock).mockResolvedValue([friend]);

    const { result } = await renderHook(() => useInvitableFriends('m1'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchInvitableFriends).toHaveBeenCalledWith('u1', 'm1');
    expect(result.current.friends).toEqual([friend]);
    expect(result.current.error).toBeNull();
  });

  it('sets an error message when loading fails', async () => {
    (fetchInvitableFriends as jest.Mock).mockRejectedValue(new Error('boom'));

    const { result } = await renderHook(() => useInvitableFriends('m1'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('boom');
  });

  it('invite() sends the invitation then reloads the list', async () => {
    (fetchInvitableFriends as jest.Mock).mockResolvedValueOnce([friend]).mockResolvedValueOnce([]);
    (sendMatchInvitation as jest.Mock).mockResolvedValue(undefined);

    const { result } = await renderHook(() => useInvitableFriends('m1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success = false;
    await act(async () => {
      success = await result.current.invite('u2');
    });

    expect(success).toBe(true);
    expect(sendMatchInvitation).toHaveBeenCalledWith('m1', 'u1', 'u2');
    expect(fetchInvitableFriends).toHaveBeenCalledTimes(2);
    expect(result.current.friends).toEqual([]);
  });

  it('invite() sets an error and returns false on failure, without removing the friend', async () => {
    (fetchInvitableFriends as jest.Mock).mockResolvedValue([friend]);
    (sendMatchInvitation as jest.Mock).mockRejectedValue(new Error('Non è possibile invitare questo utente.'));

    const { result } = await renderHook(() => useInvitableFriends('m1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success = true;
    await act(async () => {
      success = await result.current.invite('u2');
    });

    expect(success).toBe(false);
    expect(result.current.error).toBe('Non è possibile invitare questo utente.');
    expect(result.current.friends).toEqual([friend]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/hooks/useInvitableFriends.test.ts`
Expected: FAIL with "Cannot find module './useInvitableFriends'"

- [ ] **Step 3: Write the implementation**

```ts
// mobile/src/hooks/useInvitableFriends.ts
import { useCallback, useEffect, useState } from 'react';
import { fetchInvitableFriends, sendMatchInvitation, type InvitableFriend } from '@/api/matchInvitations';
import { useSessionStore } from '@/stores/sessionStore';

export function useInvitableFriends(matchId: string) {
  const userId = useSessionStore((s) => s.session?.user.id);
  const [friends, setFriends] = useState<InvitableFriend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetchInvitableFriends(userId, matchId);
      setFriends(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile caricare gli amici invitabili.');
    } finally {
      setLoading(false);
    }
  }, [userId, matchId]);

  useEffect(() => {
    load();
  }, [load]);

  // Re-fetches rather than splicing local state by hand on success --
  // matches this codebase's established hook-mutation convention (see
  // useFriendRequests.respond/.cancel).
  async function invite(inviteeId: string): Promise<boolean> {
    if (!userId) return false;
    setInviting(true);
    setError(null);
    try {
      await sendMatchInvitation(matchId, userId, inviteeId);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile inviare l’invito.');
      return false;
    } finally {
      setInviting(false);
    }
  }

  return { friends, loading, error, invite, inviting, refresh: load };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/hooks/useInvitableFriends.test.ts`
Expected: PASS, all 4 tests

- [ ] **Step 5: Commit**

```bash
cd mobile
git add src/hooks/useInvitableFriends.ts src/hooks/useInvitableFriends.test.ts
git commit -m "$(cat <<'EOF'
feat: add useInvitableFriends hook

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `home/match/[id]/invite.tsx` screen

**Files:**
- Create: `mobile/app/(tabs)/home/match/[id]/invite.tsx`

**Interfaces:**
- Consumes: `useInvitableFriends` from `@/hooks/useInvitableFriends` (Task 2). Route param `id` (match id) via `useLocalSearchParams<{ id: string }>()`, same pattern as `match/[id]/index.tsx` and `match/[id]/chat.tsx`.
- Produces: the route `/(tabs)/home/match/[id]/invite`, consumed by Task 4's new button.

No test for this screen — matches this plan's testing section and this codebase's established convention of no screen-level automated tests.

- [ ] **Step 1: Write the screen**

```tsx
// mobile/app/(tabs)/home/match/[id]/invite.tsx
import { View, Text, FlatList, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useInvitableFriends } from '@/hooks/useInvitableFriends';

export default function InviteFriendsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { friends, loading, error, invite, inviting } = useInvitableFriends(id);

  if (loading && friends.length === 0) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <Pressable onPress={() => router.back()}>
        <Text style={styles.backLink}>← Torna alla partita</Text>
      </Pressable>
      <Text style={styles.header}>Invita amici</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={friends}
        keyExtractor={(item) => item.user_id}
        renderItem={({ item }) => (
          <View style={styles.friendRow}>
            <Text style={styles.friendName}>
              {item.first_name} {item.last_name}
            </Text>
            <Pressable style={styles.inviteButton} disabled={inviting} onPress={() => invite(item.user_id)}>
              {inviting ? <ActivityIndicator color="#fff" /> : <Text style={styles.inviteButtonText}>Invita</Text>}
            </Pressable>
          </View>
        )}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.subtitle}>Nessun amico da invitare.</Text>}
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
  subtitle: { color: '#666', textAlign: 'center', marginTop: 24 },
  list: { paddingBottom: 24 },
  friendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  friendName: { fontSize: 16, fontWeight: '600' },
  inviteButton: { backgroundColor: '#1a7f37', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16, minWidth: 80, alignItems: 'center' },
  inviteButtonText: { color: '#fff', fontWeight: '600' },
});
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd mobile && npm run typecheck`
Expected: clean (this step has no test to run, so typecheck is the verification)

- [ ] **Step 3: Commit**

```bash
cd mobile
git add "app/(tabs)/home/match/[id]/invite.tsx"
git commit -m "$(cat <<'EOF'
feat: add invite-friends screen for a match

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: "Invita amici" button on the match detail screen

**Files:**
- Modify: `mobile/app/(tabs)/home/match/[id]/index.tsx`

**Interfaces:**
- Consumes: the route `/(tabs)/home/match/[id]/invite` (Task 3).
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Add the button**

In `mobile/app/(tabs)/home/match/[id]/index.tsx`, the `isCreator` block currently reads:

```tsx
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
```

Add an "Invita amici" button directly after this block (still inside the same `isCreator &&` guard is not necessary since this is its own conditional, but it must render whenever `isCreator` is true, regardless of the "Partecipanti" section below rendering or not):

```tsx
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

      {isCreator && (
        <Pressable
          style={styles.inviteButton}
          onPress={() => router.push({ pathname: '/(tabs)/home/match/[id]/invite', params: { id } })}
        >
          <Text style={styles.inviteButtonText}>Invita amici</Text>
        </Pressable>
      )}
```

Add the two new styles to the `StyleSheet.create` call at the bottom of the file, alongside the existing `editButton`/`deleteButton` styles:

```tsx
  inviteButton: { backgroundColor: '#1a7f37', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 12 },
  inviteButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd mobile && npm run typecheck`
Expected: clean

- [ ] **Step 3: Commit**

```bash
cd mobile
git add "app/(tabs)/home/match/[id]/index.tsx"
git commit -m "$(cat <<'EOF'
feat: add Invita amici button to the match detail screen

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Route `match_invitation` notifications to the match, marking the invitation viewed

**Files:**
- Modify: `mobile/app/(tabs)/home/notifications.tsx`

**Interfaces:**
- Consumes: `markInvitationViewed` from `@/api/matchInvitations` (Task 1); `useSessionStore` from `@/stores/sessionStore` (existing, not currently imported in this file).

- [ ] **Step 1: Add the import and the new branch**

`mobile/app/(tabs)/home/notifications.tsx` currently starts:

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

    if (notification.type === 'friend_request_received') {
      router.push('/(tabs)/people/friend-requests');
      return;
    }
    if (notification.type === 'friend_request_approved' || notification.type === 'friend_request_rejected') {
      const userId = notification.payload.user_id;
      if (typeof userId === 'string') {
        router.push({ pathname: '/(tabs)/people/user/[id]', params: { id: userId } });
      }
      return;
    }
    if (notification.type === 'private_message') {
      const conversationId = notification.payload.conversation_id;
      if (typeof conversationId === 'string') {
        router.push({ pathname: '/(tabs)/messages/[id]', params: { id: conversationId } });
      }
      return;
    }

    if (!notification.payload.match_id) return;
    const id = notification.payload.match_id;
    if (notification.type === 'match_message' || notification.type === 'match_message_mention') {
      router.push({ pathname: '/(tabs)/home/match/[id]/chat', params: { id } });
    } else {
      router.push({ pathname: '/(tabs)/home/match/[id]', params: { id } });
    }
  }
```

Change the import block to add `useSessionStore` and `markInvitationViewed`:

```tsx
// mobile/app/(tabs)/home/notifications.tsx
import { View, Text, FlatList, ActivityIndicator, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useNotifications } from '@/hooks/useNotifications';
import { useSessionStore } from '@/stores/sessionStore';
import { markInvitationViewed } from '@/api/matchInvitations';
import type { AppNotification } from '@/api/notifications';

export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = useSessionStore((s) => s.session?.user.id);
  const { notifications, loading, error, markRead, refresh } = useNotifications();

  function handlePress(notification: AppNotification) {
    if (!notification.read_at) markRead(notification.id);

    if (notification.type === 'friend_request_received') {
      router.push('/(tabs)/people/friend-requests');
      return;
    }
    if (notification.type === 'friend_request_approved' || notification.type === 'friend_request_rejected') {
      const userId = notification.payload.user_id;
      if (typeof userId === 'string') {
        router.push({ pathname: '/(tabs)/people/user/[id]', params: { id: userId } });
      }
      return;
    }
    if (notification.type === 'private_message') {
      const conversationId = notification.payload.conversation_id;
      if (typeof conversationId === 'string') {
        router.push({ pathname: '/(tabs)/messages/[id]', params: { id: conversationId } });
      }
      return;
    }
    if (notification.type === 'match_invitation') {
      const matchId = notification.payload.match_id;
      if (typeof matchId === 'string') {
        // Best-effort, matches this codebase's established "don't block
        // navigation on a secondary write" convention (see
        // markConversationRead's usage in messaggi's chat screen) -- a
        // failure here must never prevent the user reaching the match.
        if (userId) markInvitationViewed(matchId, userId).catch(() => {});
        router.push({ pathname: '/(tabs)/home/match/[id]', params: { id: matchId } });
      }
      return;
    }

    if (!notification.payload.match_id) return;
    const id = notification.payload.match_id;
    if (notification.type === 'match_message' || notification.type === 'match_message_mention') {
      router.push({ pathname: '/(tabs)/home/match/[id]/chat', params: { id } });
    } else {
      router.push({ pathname: '/(tabs)/home/match/[id]', params: { id } });
    }
  }
```

(The inner `const userId = notification.payload.user_id;` in the `friend_request_approved`/`rejected` branch shadows the outer `userId` from `useSessionStore` — this is pre-existing code, unchanged by this task, and TypeScript allows the shadow since the inner one is block-scoped; not a bug to fix here.)

- [ ] **Step 2: Verify it type-checks**

Run: `cd mobile && npm run typecheck`
Expected: clean

- [ ] **Step 3: Commit**

```bash
cd mobile
git add "app/(tabs)/home/notifications.tsx"
git commit -m "$(cat <<'EOF'
feat: route match_invitation notifications to the match, marking it viewed

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Manual verification

**Files:** none (manual walkthrough, no code changes)

- [ ] **Step 1: Run the full automated suite one more time**

Run: `cd mobile && npm run typecheck && npm test`
Expected: typecheck clean, all suites/tests pass (should be 4 new tests from Task 1's `matchInvitations.test.ts`'s 8 tests plus Task 2's `useInvitableFriends.test.ts`'s 4 tests added to the existing suite — verify the exact prior total from `git log`/the last full run before this plan started, and confirm the new total is prior + 12).

- [ ] **Step 2: Live walkthrough in the iOS Simulator**

Using two existing test users (e.g. Mario Rossi and Luca Bianchi, already friends from prior verification sessions — if not currently friends, re-establish it via Persone first):

1. As Mario (creator of an open match, or create a new one first): open the match's detail screen, tap "Invita amici", confirm Luca appears in the list (and that anyone already participating in this specific match does NOT appear).
2. Tap "Invita" next to Luca. Confirm the button shows a loading state and Luca disappears from the list afterward (the re-fetch excluding him now that he has a `match_invitations` row).
3. Query the database directly to confirm the `match_invitations` row exists with `status = 'sent'`.
4. Switch to Luca's account. Open Notifiche, confirm a "ti ha invitato a partecipare a una partita a `<campo>`" notification is present.
5. Tap it. Confirm navigation lands on the match's detail screen.
6. Query the database directly to confirm that same `match_invitations` row now has `status = 'viewed'`.
7. As Luca, tap "Richiedi di partecipare" on the match detail screen (the normal, pre-existing participation flow) and confirm it works exactly as it does for any other match — this invitation flow must not have altered participation in any way.
8. Clean up any test data created during this walkthrough (the invitation row, and the participation request if it would otherwise leave stray state for a future session) the same way prior plans' Task 9/11 walkthroughs did.

- [ ] **Step 3: Update the SDD ledger**

Record the walkthrough's outcome (pass/fail, any bugs found and fixed) in `.superpowers/sdd/2026-09-07-match-invitations/progress.md`, following the same style as every prior plan's final manual-verification entry.
