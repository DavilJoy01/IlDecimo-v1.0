# Eliminazione account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in user permanently delete their own account from "Modifica profilo" — matches they created are deleted, messages they sent are preserved but anonymized, their own participations elsewhere are removed, and their phone number is freed for future re-registration.

**Architecture:** A single `security definer` Postgres RPC (`delete_own_account()`) does all data-fate work in one transaction: deletes the caller's own matches (existing cascades clean up participants/messages of those matches), removes the caller's participations in others' matches, anonymizes the caller's `public.users` row (never deletes it — every table whose rows must survive, e.g. `match_messages`, references `public.users` with `on delete cascade`, so keeping the row alive under a placeholder identity is the only way to preserve those rows), then disables the caller's `auth.users` row in place (`banned_until`, cleared `phone`, randomized `encrypted_password`) without deleting it — deleting it would cascade-delete the `public.users` placeholder just anonymized, defeating the whole approach. No Edge Function, no admin API call, no new secret: every field touched is an ordinary Postgres column, writable directly by a `security definer` function the same way every other sensitive operation in this backend already works. The mobile layer adds a storage-cleanup call (past profile photos are never deleted on ordinary edits, so deletion must explicitly purge all of them, not just the current one), a thin RPC wrapper, an orchestrating hook, and a "zona pericolosa" section in the edit-profile screen.

**Tech Stack:** Supabase Postgres (PL/pgSQL, pgTAP), React Native (Expo Router), Jest + `@testing-library/react-native`.

**Spec:** [docs/superpowers/specs/2026-09-11-eliminazione-account-design.md](../specs/2026-09-11-eliminazione-account-design.md)

## Global Constraints

- **`delete_own_account()` takes no parameters** — it always acts on `auth.uid()`, never on a passed id, so there is no way to call it against someone else's account. It raises if `auth.uid()` is null.
- **`public.users` and `auth.users` rows are never deleted** — only updated in place. This is the load-bearing decision the whole design rests on: deleting either row would cascade-delete rows this plan requires to survive (see spec §2.2–2.3).
- **Matches created by the caller are hard-deleted** — existing `on delete cascade` on `matches.creator_id` already cleans up `match_participants`, `match_messages`, `match_message_mentions`, `match_invitations` for those matches. No new cascade logic needed for this part.
- **The caller's own participations in matches created by others are hard-deleted** (`match_participants` rows where `user_id = auth.uid()`), freeing the spot for someone else.
- **Anonymization values are fixed literals**, not derived from anything reversible: `first_name = 'Utente'`, `last_name = 'eliminato'`, `phone = 'deleted-' || id::text`, `birth_date = '2000-01-01'`, `profile_image_url = null`. `height_cm`, `preferred_foot`, `player_role`, `unique_user_id` are left untouched (not identifying once name/phone/photo are gone).
- **`auth.users` disabling uses only native GoTrue columns already in the schema**: `phone = null`, `phone_confirmed_at = null`, `encrypted_password = extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf'))`, `banned_until = '2999-12-31'::timestamptz`. `pgcrypto` is already installed in this database, in the `extensions` schema — since the function sets `search_path = ''` (see Task 1), `crypt`/`gen_salt` must be schema-qualified as `extensions.crypt`/`extensions.gen_salt` or they won't resolve; `gen_random_uuid()` is core Postgres and needs no qualification.
- **Past profile photos are never deleted by ordinary edits** (`mobile/src/api/users.ts`'s `uploadProfileImage` always writes a fresh timestamped path and never removes the old one) — account deletion must therefore `list()` every file under the `${userId}/` prefix in the `profile-images` bucket and `remove()` all of them, not just the one referenced by `profile.profile_image_url`.
- **Storage cleanup happens client-side, before the RPC call** — Postgres cannot reach Supabase Storage. If the RPC then fails, the photos are already gone but the account is untouched; this is an accepted, documented trade-off (spec §3.3), not a bug to defend against further.
- **The "zona pericolosa" section lives in `mobile/app/(tabs)/profile/edit.tsx` as a sibling of `<ProfileForm>`, never inside `ProfileForm` itself** — `ProfileForm` is shared with `mobile/app/(auth)/create-profile.tsx` (the registration flow), which must never show a delete-account option. `ProfileForm` wraps its own fields in its own internal `ScrollView`; the new section renders after it, in `edit.tsx`'s own (non-scrolling) outer `View`.
- **Confirmation is two steps, both required**: an `Alert.alert` ("sei sicuro?", irreversible) followed by re-entering the current password, verified by calling the already-existing `signInWithPassword` (from `mobile/src/api/auth.ts`) — no new verification mechanism.
- **`mobile/src/api/auth.test.ts` and `mobile/src/api/users.test.ts` already exist with several passing tests** — extend them, never recreate or restructure. Both already mock `supabase` in the pattern shown in each task below; match it exactly.

---

### Task 1: `delete_own_account()` RPC

**Files:**
- Create: `supabase/migrations/20260911000000_add_delete_own_account.sql`
- Create: `supabase/tests/026_delete_own_account.test.sql`

**Interfaces:**
- Produces: `public.delete_own_account() returns void`, callable by any `authenticated` user, granted to `authenticated`, revoked from `public`/`anon`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260911000000_add_delete_own_account.sql
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'must be authenticated to delete an account';
  end if;

  -- 1. Matches created by the caller: existing on-delete-cascade cleans up
  -- match_participants, match_messages, match_message_mentions, and
  -- match_invitations for those matches.
  delete from public.matches where creator_id = v_uid;

  -- 2. The caller's own participations in matches created by others:
  -- frees the spot for someone else.
  delete from public.match_participants where user_id = v_uid;

  -- 3. Anonymize the public profile -- NEVER delete it, since match_messages,
  -- private_messages, notifications, friendships, user_blocks, and reports
  -- all reference it with on-delete-cascade, and messages the caller sent
  -- must survive (shown as sent by "Utente eliminato").
  update public.users
  set first_name = 'Utente',
      last_name = 'eliminato',
      phone = 'deleted-' || v_uid::text,
      birth_date = '2000-01-01',
      profile_image_url = null
  where id = v_uid;

  -- 4. Disable auth.users in place -- never delete it (that would cascade
  -- to the public.users row just anonymized above).
  update auth.users
  set phone = null,
      phone_confirmed_at = null,
      encrypted_password = extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
      banned_until = '2999-12-31'::timestamptz
  where id = v_uid;
end;
$$;

grant execute on function public.delete_own_account() to authenticated;
revoke execute on function public.delete_own_account() from public, anon;
```

- [ ] **Step 2: Write the pgTAP test file**

```sql
-- supabase/tests/026_delete_own_account.test.sql
begin;
select plan(9);

-- CALLER: the user who will delete their own account.
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','caller@example.com');
update auth.users set phone = '+390000000001' where id = '11111111-1111-1111-1111-111111111111';
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

-- OTHER: a second user, both to receive a message from the caller and to
-- own a match the caller will join and later be removed from.
insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','other@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

-- Match created BY THE CALLER (must be gone entirely after deletion).
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players, status)
values ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',5,'Campo Caller','Via A 1',38.11,13.36,'2026-02-01','10:00','11:00',10,'open');

-- Match created BY OTHER, the caller is an approved participant (the
-- caller's own row here must be gone after deletion; the match itself and
-- OTHER's ownership of it must be untouched).
select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players, status)
values ('aaaaaaaa-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222',5,'Campo Other','Via B 1',38.11,13.36,'2026-02-02','10:00','11:00',10,'open');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.match_participants (id, match_id, user_id, status)
values ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','requested');
select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
update public.match_participants set status = 'approved' where id = 'bbbbbbbb-0000-0000-0000-000000000001';

-- A message the caller sent, which must survive deletion: it has to live
-- in a match that is NOT deleted by this plan, i.e. one created by OTHER
-- (not by the caller) -- the caller's own matches are hard-deleted, which
-- would take any message inside them along for the ride regardless of
-- sender. OTHER's match, where the caller is merely a participant, is
-- never touched by the caller's own account deletion. match_messages'
-- own insert policy requires sender_id = auth.uid(), so re-authenticate
-- as the caller (not OTHER, the last authenticated role above) first.
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.match_messages (id, match_id, sender_id, body)
values ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Ci vediamo al campo!');

-- 1. Unauthenticated call is rejected outright.
select tests.clear_authentication();
select throws_ok(
  $$select public.delete_own_account()$$,
  'P0001',
  'must be authenticated to delete an account',
  'delete_own_account rejects an unauthenticated caller'
);

-- Perform the real deletion, as the caller.
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
select public.delete_own_account();

-- 2. The caller's own match is gone entirely.
select is(
  (select count(*)::int from public.matches where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0,
  'a match created by the deleted account no longer exists'
);

-- 3. OTHER's match is untouched -- still exists, still owned by OTHER.
select is(
  (select creator_id from public.matches where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'a match created by someone else survives untouched'
);

-- 4. The caller's participation in OTHER's match is gone (spot freed).
select is(
  (select count(*)::int from public.match_participants where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  0,
  'the deleted account''s own participation in someone else''s match is removed'
);

-- 5. The message the caller sent in OTHER's match still exists, content
-- unchanged -- re-authenticate as OTHER first: the caller's own
-- match_messages_select_participants visibility into this match just
-- disappeared as a side effect of step 2 above (their own
-- match_participants row there was deleted), so reading as the caller
-- would now see nothing regardless of whether the message survived.
-- OTHER, the match's creator, always has visibility and is unaffected by
-- anything this deletion does.
select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
select is(
  (select body from public.match_messages where id = 'cccccccc-0000-0000-0000-000000000001'),
  'Ci vediamo al campo!',
  'a message sent by the deleted account survives with its content intact'
);

-- 6. The message's sender, read through the surviving row, now shows the
-- anonymized placeholder identity.
select is(
  (select u.first_name || ' ' || u.last_name from public.match_messages m join public.users u on u.id = m.sender_id where m.id = 'cccccccc-0000-0000-0000-000000000001'),
  'Utente eliminato',
  'the surviving message''s sender now reads as the anonymized placeholder'
);

-- 7. public.users.phone no longer holds the real number (freed).
select isnt(
  (select phone from public.users where id = '11111111-1111-1111-1111-111111111111'),
  '+390000000001',
  'the deleted account''s public.users.phone is no longer the real number'
);

-- 8. The real phone number is reusable -- inserting a fresh public.users
-- row with it does not violate the unique constraint.
select tests.clear_authentication();
insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333','newcomer@example.com');
select lives_ok(
  $$insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
    values ('33333333-3333-3333-3333-333333333333','+390000000001','New','Comer','1995-01-01',170,'right','player')$$,
  'the freed phone number can be reused by a brand-new registration'
);

-- 9. auth.users is disabled: banned far in the future, phone cleared.
select ok(
  (select banned_until from auth.users where id = '11111111-1111-1111-1111-111111111111') > now() + interval '100 years',
  'the deleted account''s auth.users row is banned far into the future'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Run the pgTAP suite**

Run (Docker's CLI may need adding to `PATH` first: `export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"`): from `supabase/`, `npx supabase test db`.
Expected: `026_delete_own_account.test.sql` passes all 9 assertions; full suite `Files=27` (one more than before), all green.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260911000000_add_delete_own_account.sql supabase/tests/026_delete_own_account.test.sql
git commit -m "feat: add delete_own_account RPC for GDPR account deletion"
```

---

### Task 2: Mobile data layer — `deleteOwnAccount()` and `deleteAllProfileImages()`

**Files:**
- Modify: `mobile/src/api/auth.ts`
- Modify: `mobile/src/api/auth.test.ts`
- Modify: `mobile/src/api/users.ts`
- Modify: `mobile/src/api/users.test.ts`

**Interfaces:**
- Consumes: `public.delete_own_account()` RPC (Task 1); Supabase JS `supabase.storage.from('profile-images').list(path)` / `.remove(paths)` (existing client, same pattern already used by `uploadProfileImage` in `mobile/src/api/users.ts`).
- Produces: `deleteOwnAccount(): Promise<void>` in `mobile/src/api/auth.ts`; `deleteAllProfileImages(userId: string): Promise<void>` in `mobile/src/api/users.ts`. Both consumed by Task 3's hook.

- [ ] **Step 1: Write the failing tests for `deleteOwnAccount`**

Append to `mobile/src/api/auth.test.ts` (the existing `jest.mock('./supabase', ...)` at the top of the file needs `rpc: jest.fn()` added alongside the existing `auth: {...}` mock — the existing tests only exercise `supabase.auth.*`, never `supabase.rpc`, so this addition doesn't touch any of them):

```ts
// Change the top-of-file mock from:
jest.mock('./supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: jest.fn(),
      signInWithOtp: jest.fn(),
      verifyOtp: jest.fn(),
      updateUser: jest.fn(),
    },
  },
}));
// to:
jest.mock('./supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: jest.fn(),
      signInWithOtp: jest.fn(),
      verifyOtp: jest.fn(),
      updateUser: jest.fn(),
    },
    rpc: jest.fn(),
  },
}));
```

Then update the top import line to add `deleteOwnAccount`:

```ts
import { signInWithPassword, requestPhoneOtp, verifyPhoneOtp, setPassword, deleteOwnAccount } from './auth';
```

And append this new `describe` block at the end of the file, before the final closing `});` of the outer `describe('auth api', ...)` block (i.e. as one more `it(...)` inside that same describe, matching every other test in the file):

```ts
  it('deleteOwnAccount calls the delete_own_account RPC with no arguments', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: null });
    await deleteOwnAccount();
    expect(supabase.rpc).toHaveBeenCalledWith('delete_own_account');
  });

  it('deleteOwnAccount throws the Supabase error message on failure', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: { message: 'must be authenticated to delete an account' } });
    await expect(deleteOwnAccount()).rejects.toThrow('must be authenticated to delete an account');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mobile && npx jest src/api/auth.test.ts`
Expected: FAIL — `deleteOwnAccount` is not exported from `./auth`.

- [ ] **Step 3: Implement `deleteOwnAccount`**

Append to `mobile/src/api/auth.ts`:

```ts
export async function deleteOwnAccount(): Promise<void> {
  const { error } = await supabase.rpc('delete_own_account');
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mobile && npx jest src/api/auth.test.ts`
Expected: PASS, all tests in the file (existing + 2 new).

- [ ] **Step 5: Write the failing tests for `deleteAllProfileImages`**

Append to `mobile/src/api/users.test.ts`. First add `deleteAllProfileImages` to the existing top import line:

```ts
import { createOwnProfile, fetchOwnProfile, updateOwnProfile, uploadProfileImage, deleteAllProfileImages, fetchUserProfile, fetchUserMatchHistory } from './users';
```

Then add this new `describe` block, as a sibling of the existing `describe('uploadProfileImage', ...)` block (inside the same outer `describe('users api', ...)`, after it, before that outer describe's closing `});`):

```ts
  describe('deleteAllProfileImages', () => {
    it('lists every file under the user prefix and removes them all', async () => {
      const list = jest.fn().mockResolvedValue({
        data: [{ name: '1700000000000.jpg' }, { name: '1699999999999.jpg' }],
        error: null,
      });
      const remove = jest.fn().mockResolvedValue({ data: [], error: null });
      (supabase.storage as unknown as { from: jest.Mock }) = { from: jest.fn().mockReturnValue({ list, remove }) } as never;

      await deleteAllProfileImages('u1');

      expect(supabase.storage.from).toHaveBeenCalledWith('profile-images');
      expect(list).toHaveBeenCalledWith('u1');
      expect(remove).toHaveBeenCalledWith(['u1/1700000000000.jpg', 'u1/1699999999999.jpg']);
    });

    it('does nothing when the user has no uploaded photos', async () => {
      const list = jest.fn().mockResolvedValue({ data: [], error: null });
      const remove = jest.fn();
      (supabase.storage as unknown as { from: jest.Mock }) = { from: jest.fn().mockReturnValue({ list, remove }) } as never;

      await deleteAllProfileImages('u1');

      expect(remove).not.toHaveBeenCalled();
    });

    it('throws the raw Supabase error message when listing fails', async () => {
      const list = jest.fn().mockResolvedValue({ data: null, error: { message: 'bucket not found' } });
      (supabase.storage as unknown as { from: jest.Mock }) = { from: jest.fn().mockReturnValue({ list, remove: jest.fn() }) } as never;

      await expect(deleteAllProfileImages('u1')).rejects.toThrow('bucket not found');
    });

    it('throws the raw Supabase error message when removal fails', async () => {
      const list = jest.fn().mockResolvedValue({ data: [{ name: '1700000000000.jpg' }], error: null });
      const remove = jest.fn().mockResolvedValue({ data: null, error: { message: 'permission denied' } });
      (supabase.storage as unknown as { from: jest.Mock }) = { from: jest.fn().mockReturnValue({ list, remove }) } as never;

      await expect(deleteAllProfileImages('u1')).rejects.toThrow('permission denied');
    });
  });
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `cd mobile && npx jest src/api/users.test.ts`
Expected: FAIL — `deleteAllProfileImages` is not exported from `./users`.

- [ ] **Step 7: Implement `deleteAllProfileImages`**

Append to `mobile/src/api/users.ts`:

```ts
export async function deleteAllProfileImages(userId: string): Promise<void> {
  const { data, error } = await supabase.storage.from('profile-images').list(userId);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return;
  const paths = data.map((file) => `${userId}/${file.name}`);
  const { error: removeError } = await supabase.storage.from('profile-images').remove(paths);
  if (removeError) throw new Error(removeError.message);
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd mobile && npx jest src/api/users.test.ts`
Expected: PASS, all tests in the file (existing + 4 new).

- [ ] **Step 9: Run the full suite and typecheck**

Run: `cd mobile && npm run typecheck && npm test -- --watchAll=false`
Expected: both clean; Jest suite count grows by 6 tests over the pre-task baseline (2 in `auth.test.ts`, 4 in `users.test.ts`).

- [ ] **Step 10: Commit**

```bash
git add mobile/src/api/auth.ts mobile/src/api/auth.test.ts mobile/src/api/users.ts mobile/src/api/users.test.ts
git commit -m "feat: add deleteOwnAccount and deleteAllProfileImages to the data layer"
```

---

### Task 3: `useDeleteAccount` hook

**Files:**
- Create: `mobile/src/hooks/useDeleteAccount.ts`
- Create: `mobile/src/hooks/useDeleteAccount.test.ts`

**Interfaces:**
- Consumes: `signInWithPassword` (existing, `mobile/src/api/auth.ts`), `deleteOwnAccount` (Task 2, `mobile/src/api/auth.ts`), `deleteAllProfileImages` (Task 2, `mobile/src/api/users.ts`), `useSessionStore` (existing, for `profile.id`/`profile.phone`), `supabase.auth.signOut` (existing client method, already used as-is in `mobile/app/(tabs)/profile/index.tsx`).
- Produces: `useDeleteAccount()` returning `{ deleteAccount(password: string): Promise<boolean>, loading: boolean, error: string | null }`, consumed by Task 4's UI.

- [ ] **Step 1: Write the failing tests**

Create `mobile/src/hooks/useDeleteAccount.test.ts`:

```ts
import { renderHook, act } from '@testing-library/react-native';
import { useDeleteAccount } from './useDeleteAccount';
import { signInWithPassword, deleteOwnAccount } from '@/api/auth';
import { deleteAllProfileImages } from '@/api/users';
import { supabase } from '@/api/supabase';
import { useSessionStore } from '@/stores/sessionStore';

jest.mock('@/api/auth', () => ({
  signInWithPassword: jest.fn(),
  deleteOwnAccount: jest.fn(),
}));
jest.mock('@/api/users', () => ({
  deleteAllProfileImages: jest.fn(),
}));
jest.mock('@/api/supabase', () => ({
  supabase: { auth: { signOut: jest.fn() } },
}));

const existingProfile = {
  id: 'u1',
  unique_user_id: 'FC-100001',
  phone: '+390000000001',
  first_name: 'Mario',
  last_name: 'Rossi',
  birth_date: '1990-01-01',
  height_cm: 180,
  preferred_foot: 'right',
  player_role: 'player',
  profile_image_url: null,
  matches_played_count: 0,
  matches_completed_count: 0,
  matches_abandoned_count: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('useDeleteAccount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSessionStore.setState({
      session: { user: { id: 'u1' } } as never,
      profile: existingProfile as never,
      status: 'signed-in',
    });
  });

  it('verifies the password, cleans up storage, calls the RPC, then signs out -- in that order', async () => {
    const calls: string[] = [];
    (signInWithPassword as jest.Mock).mockImplementation(async () => { calls.push('verify'); return { user: null }; });
    (deleteAllProfileImages as jest.Mock).mockImplementation(async () => { calls.push('storage'); });
    (deleteOwnAccount as jest.Mock).mockImplementation(async () => { calls.push('rpc'); });
    (supabase.auth.signOut as jest.Mock).mockImplementation(async () => { calls.push('signout'); });

    const { result } = await renderHook(() => useDeleteAccount());

    let success = false;
    await act(async () => {
      success = await result.current.deleteAccount('hunter2');
    });

    expect(success).toBe(true);
    expect(signInWithPassword).toHaveBeenCalledWith('+390000000001', 'hunter2');
    expect(deleteAllProfileImages).toHaveBeenCalledWith('u1');
    expect(deleteOwnAccount).toHaveBeenCalled();
    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(calls).toEqual(['verify', 'storage', 'rpc', 'signout']);
  });

  it('returns false and sets an error when the password is wrong, without touching storage or the RPC', async () => {
    (signInWithPassword as jest.Mock).mockRejectedValue(new Error('Invalid login credentials'));

    const { result } = await renderHook(() => useDeleteAccount());

    let success = true;
    await act(async () => {
      success = await result.current.deleteAccount('wrong');
    });

    expect(success).toBe(false);
    expect(result.current.error).toBe('Invalid login credentials');
    expect(deleteAllProfileImages).not.toHaveBeenCalled();
    expect(deleteOwnAccount).not.toHaveBeenCalled();
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
  });

  it('returns false and sets an error when the RPC fails, without signing out', async () => {
    (signInWithPassword as jest.Mock).mockResolvedValue({ user: null });
    (deleteAllProfileImages as jest.Mock).mockResolvedValue(undefined);
    (deleteOwnAccount as jest.Mock).mockRejectedValue(new Error('must be authenticated to delete an account'));

    const { result } = await renderHook(() => useDeleteAccount());

    let success = true;
    await act(async () => {
      success = await result.current.deleteAccount('hunter2');
    });

    expect(success).toBe(false);
    expect(result.current.error).toBe('must be authenticated to delete an account');
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
  });

  it('returns false without calling anything when there is no profile loaded', async () => {
    useSessionStore.setState({ session: null, profile: null, status: 'signed-out' });

    const { result } = await renderHook(() => useDeleteAccount());

    let success = true;
    await act(async () => {
      success = await result.current.deleteAccount('hunter2');
    });

    expect(success).toBe(false);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mobile && npx jest src/hooks/useDeleteAccount.test.ts`
Expected: FAIL — cannot find module `./useDeleteAccount`.

- [ ] **Step 3: Implement the hook**

Create `mobile/src/hooks/useDeleteAccount.ts`:

```ts
import { useState } from 'react';
import { signInWithPassword, deleteOwnAccount } from '@/api/auth';
import { deleteAllProfileImages } from '@/api/users';
import { supabase } from '@/api/supabase';
import { useSessionStore } from '@/stores/sessionStore';

export function useDeleteAccount() {
  const profile = useSessionStore((s) => s.profile);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteAccount(password: string): Promise<boolean> {
    if (!profile) return false;
    setLoading(true);
    setError(null);
    try {
      await signInWithPassword(profile.phone, password);
      await deleteAllProfileImages(profile.id);
      await deleteOwnAccount();
      await supabase.auth.signOut();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile eliminare l\'account.');
      return false;
    } finally {
      setLoading(false);
    }
  }

  return { deleteAccount, loading, error };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mobile && npx jest src/hooks/useDeleteAccount.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `cd mobile && npm run typecheck && npm test -- --watchAll=false`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/hooks/useDeleteAccount.ts mobile/src/hooks/useDeleteAccount.test.ts
git commit -m "feat: add useDeleteAccount hook orchestrating password check, cleanup, and sign-out"
```

---

### Task 4: "Zona pericolosa" UI in Modifica profilo

**Files:**
- Modify: `mobile/app/(tabs)/profile/edit.tsx`

**Interfaces:**
- Consumes: `useDeleteAccount` (Task 3) — `{ deleteAccount(password), loading, error }`.

No test file for this screen — this project's established convention is no automated tests for screens (every other screen, including this same file's existing `handleSubmit` flow, has none); this task is verified by typecheck and by Task 5's manual walkthrough.

- [ ] **Step 1: Add the danger-zone section**

The file currently ends with (around line 40-47):

```tsx
      <ProfileForm
        initialValues={{
          firstName: profile.first_name,
          lastName: profile.last_name,
          birthDate: profile.birth_date,
          heightCm: String(profile.height_cm),
          preferredFoot: profile.preferred_foot,
          playerRole: profile.player_role,
        }}
        currentImageUrl={profile.profile_image_url}
        showImagePicker
        onImageSelected={setSelectedImageUri}
        onSubmit={handleSubmit}
        submitLabel="Salva modifiche"
        loading={loading}
        error={error}
      />
    </View>
  );
}
```

Replace it with (adds the danger-zone section as a sibling of `<ProfileForm>`, still inside the same outer `<View>`):

```tsx
      <ProfileForm
        initialValues={{
          firstName: profile.first_name,
          lastName: profile.last_name,
          birthDate: profile.birth_date,
          heightCm: String(profile.height_cm),
          preferredFoot: profile.preferred_foot,
          playerRole: profile.player_role,
        }}
        currentImageUrl={profile.profile_image_url}
        showImagePicker
        onImageSelected={setSelectedImageUri}
        onSubmit={handleSubmit}
        submitLabel="Salva modifiche"
        loading={loading}
        error={error}
      />
      <View style={styles.dangerZone}>
        <Pressable onPress={confirmDelete} disabled={deleting}>
          <Text style={styles.dangerLink}>Elimina account</Text>
        </Pressable>
        {showPasswordPrompt && (
          <View style={styles.passwordPrompt}>
            <Text style={styles.passwordLabel}>Inserisci la password attuale per confermare</Text>
            <TextInput
              style={styles.passwordInput}
              placeholder="Password"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              autoFocus
            />
            {deleteError && <Text style={styles.deleteError}>{deleteError}</Text>}
            <Pressable style={withPressed(styles.confirmDeleteButton)} disabled={deleting} onPress={handleConfirmDelete}>
              {deleting ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.confirmDeleteText}>Conferma eliminazione</Text>}
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Add the imports, state, and handlers**

The file currently starts with:

```tsx
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useEditProfile } from '@/hooks/useEditProfile';
import { ProfileForm, type ProfileFormValues } from '@/components/ProfileForm';
import { colors, typography, spacing } from '@/theme';

export default function EditProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile, loading, error, save } = useEditProfile();
  const [selectedImageUri, setSelectedImageUri] = useState<string | undefined>(undefined);

  if (!profile) return null; // unreachable in practice: this screen is only mounted once status === 'signed-in'

  async function handleSubmit(values: ProfileFormValues) {
    const success = await save(values, selectedImageUri);
    if (success) router.back();
  }
```

Replace it with:

```tsx
import { useState } from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useEditProfile } from '@/hooks/useEditProfile';
import { useDeleteAccount } from '@/hooks/useDeleteAccount';
import { ProfileForm, type ProfileFormValues } from '@/components/ProfileForm';
import { colors, typography, spacing, withPressed } from '@/theme';

export default function EditProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile, loading, error, save } = useEditProfile();
  const [selectedImageUri, setSelectedImageUri] = useState<string | undefined>(undefined);
  const { deleteAccount, loading: deleting, error: deleteError } = useDeleteAccount();
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [password, setPassword] = useState('');

  if (!profile) return null; // unreachable in practice: this screen is only mounted once status === 'signed-in'

  async function handleSubmit(values: ProfileFormValues) {
    const success = await save(values, selectedImageUri);
    if (success) router.back();
  }

  function confirmDelete() {
    Alert.alert(
      'Elimina il tuo account',
      'Questa azione è irreversibile. Le partite che hai creato verranno cancellate; i messaggi che hai inviato resteranno visibili ma anonimi. Vuoi continuare?',
      [
        { text: 'Annulla', style: 'cancel' },
        { text: 'Continua', style: 'destructive', onPress: () => setShowPasswordPrompt(true) },
      ]
    );
  }

  async function handleConfirmDelete() {
    const success = await deleteAccount(password);
    if (success) router.replace('/(auth)/login');
  }
```

- [ ] **Step 3: Add the new styles**

The file's `StyleSheet.create` call currently ends with:

```tsx
const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, paddingHorizontal: spacing.spaceMd },
  backLink: { color: colors.primary, marginBottom: spacing.spaceXs },
  header: { ...typography.screenTitle, marginBottom: 4 },
});
```

Replace it with:

```tsx
const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, paddingHorizontal: spacing.spaceMd },
  backLink: { color: colors.primary, marginBottom: spacing.spaceXs },
  header: { ...typography.screenTitle, marginBottom: 4 },
  dangerZone: { marginTop: spacing.spaceLg, paddingTop: spacing.spaceMd, borderTopWidth: 1, borderTopColor: colors.border, paddingBottom: spacing.spaceLg },
  dangerLink: { color: colors.danger, ...typography.label, textAlign: 'center' },
  passwordPrompt: { marginTop: spacing.spaceMd, gap: spacing.spaceSm },
  passwordLabel: { color: colors.muted, ...typography.body },
  passwordInput: { borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusControl, padding: spacing.spaceSm, ...typography.body },
  deleteError: { color: colors.danger },
  confirmDeleteButton: { backgroundColor: colors.danger, borderRadius: spacing.radiusControl, padding: 14, alignItems: 'center' },
  confirmDeleteText: { color: colors.onPrimary, ...typography.label },
});
```

- [ ] **Step 4: Run typecheck**

Run: `cd mobile && npm run typecheck`
Expected: clean.

- [ ] **Step 5: Run the full suite**

Run: `cd mobile && npm test -- --watchAll=false`
Expected: clean, same test count as after Task 3 (this task adds no test file).

- [ ] **Step 6: Commit**

```bash
git add "mobile/app/(tabs)/profile/edit.tsx"
git commit -m "feat: add delete-account danger zone to the edit-profile screen"
```

---

### Task 5: Manual verification

**Files:** none (manual walkthrough, no code changes)

- [ ] **Step 1: Run the full automated suite one more time**

Run: `cd mobile && npm run typecheck && npm test -- --watchAll=false` and (Docker's CLI may need adding to `PATH`) `cd supabase && npx supabase test db`.
Expected: typecheck clean; full Jest suite green (prior total + this plan's new tests: 6 from Task 2 + 4 from Task 3 = 10 new tests); full pgTAP suite green, including the 9 new assertions in `026_delete_own_account.test.sql`.

- [ ] **Step 2: Live walkthrough in the iOS Simulator**

Using two throwaway test users (A and B, seeded via the GoTrue admin API + direct SQL, per this project's established manual-testing pattern):
1. As A, create a match. As B, request to join and get approved by A. In the match's chat, send a message as B.
2. As A, request to join a DIFFERENT match created by B (or seed this directly via SQL, approved) — this is the "participation in someone else's match" case.
3. As A, open "Modifica profilo", scroll to "Elimina account", tap it — confirm the alert appears with the expected text, tap "Continua".
4. Confirm the password prompt appears. Enter a wrong password first — confirm an error shows and nothing else happens (verify via direct SQL query that A's match, B's approved participation, and A's own auth.users row are all still completely untouched).
5. Enter A's correct password, tap "Conferma eliminazione". Confirm the app signs out and returns to the login screen.
6. Verify via direct SQL: A's created match is gone; A's participation in B's match is gone (B's match itself and B's other data untouched); A's `public.users` row shows "Utente"/"eliminato"; A's `auth.users.banned_until` is set.
7. As B, open the chat with A's old message — confirm it still shows the message text, with the sender now displayed as "Utente eliminato".
8. Attempt to log in as A with A's original phone number and password directly via `curl` against the local GoTrue token endpoint (`POST {SUPABASE_URL}/auth/v1/token?grant_type=password`) — confirm it's rejected (banned account).
9. Register a brand-new test user with A's original phone number — confirm it succeeds (the number was genuinely freed).

- [ ] **Step 3: Clean up test data**

Delete any matches/users created directly via SQL for this walkthrough (the account-deletion test itself will have already anonymized/disabled A's real rows — no cleanup needed for those; B and the brand-new re-registered user should be removed).

- [ ] **Step 4: Update the SDD ledger**

Record the walkthrough's outcome (pass/fail, any bugs found and fixed) in `.superpowers/sdd/2026-09-11-eliminazione-account/progress.md`, following the same style as every prior plan's final manual-verification entry.
