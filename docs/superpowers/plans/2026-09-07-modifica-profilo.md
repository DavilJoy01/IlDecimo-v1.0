# Modifica profilo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in user edit their own profile (name, birth date, height, preferred foot, role, and profile photo), currently view-only.

**Architecture:** Two new backend migrations (an immutable-fields trigger on `users`, a new public Storage bucket for photos), a small mobile data layer, a shared `ProfileForm` component extracted from the existing registration screen, and a new edit screen.

**Tech Stack:** React Native (Expo Router), Supabase JS client + Storage, `expo-image-picker`, `expo-file-system`, `base64-arraybuffer`, Jest, pgTAP.

**Spec:** [docs/superpowers/specs/2026-09-07-modifica-profilo-design.md](../specs/2026-09-07-modifica-profilo-design.md)

## Global Constraints

- Editable fields: `first_name`, `last_name`, `birth_date`, `height_cm`, `preferred_foot`, `player_role`, `profile_image_url`. Never editable via this feature: `phone`, `unique_user_id`, `matches_played_count`, `matches_completed_count`, `matches_abandoned_count` — enforced server-side by a new trigger, not just by the client omitting them from its update payload.
- The immutable-fields trigger raises a plain `RAISE EXCEPTION` (no explicit `SQLSTATE`), which Postgres surfaces as `P0001` — not `42501` or `23505`. Any client-side error translation for this specific failure must match on the exception's message text, not assume a specific standard error code.
- The Storage bucket `profile-images` is public (`insert into storage.buckets (..., public) values (..., true)`); reads need no auth, writes are restricted per-user via `(storage.foldername(name))[1] = auth.uid()::text`.
- Every uploaded file's path must be `<user_id>/<timestamp>.jpg` (timestamp in milliseconds via `Date.now()`) — this guarantees a fresh public URL on every new upload, so no client/CDN cache can ever serve a stale photo under an old URL, and removes any need for `upsert: true` or delete-before-upload logic.
- `expo-image-picker` and `expo-file-system` are new dependencies — install with `npx expo install expo-image-picker expo-file-system` (not plain `npm install`, so Expo resolves SDK-57-compatible versions). `base64-arraybuffer` is a small, dependency-free, framework-agnostic base64 decoder — install with `npm install base64-arraybuffer` (a plain npm package, not an Expo/RN-specific one, so `npx expo install` does not apply to it).
- Follow this codebase's established error-translation pattern exactly: a local `translate*Error(message, code?)` function per API file (see `mobile/src/api/friendships.ts`'s `translateFriendshipError`, `mobile/src/api/matchInvitations.ts`'s `translateInvitationError`) that maps a backend-internal message to a neutral Italian string, never surfaced as `error.code === '...'` alone when the failure is a custom trigger exception rather than a standard Postgres error code.
- Hook tests must follow `mobile/src/hooks/useFriends.test.ts`'s exact setup convention: `useSessionStore.setState({ session: ..., profile: ..., status: 'signed-in' })` against the real Zustand store (never a manual selector mock), `jest.mock('@/api/<module>', () => ({ <named exports>: jest.fn() }))`, `await renderHook(...)` (the `await` is required — this project's installed `@testing-library/react-native` version needs it), and every mutating call wrapped in `await act(async () => {...})`, never a bare `act(() => ...)`.
- No `_layout.tsx` currently exists under `mobile/app/(tabs)/profile/` and this plan adds a second file (`edit.tsx`) as a direct sibling of `index.tsx` inside that same tab folder — this is exactly the sibling-files-under-a-tab-folder shape that caused Expo Router to auto-promote a child route into its own top-level tab in the `persone` and `messaggi` plans. A `profile/_layout.tsx` declaring both `index` and `edit` under one `Stack` is required (see Task 9) — this is the opposite situation from `match-invitations`' `match/[id]/invite.tsx`, which needed no layout because it was nested under a dynamic route, not a tab-folder sibling.

---

### Task 1: Immutable-fields trigger on `users`

**Files:**
- Create: `supabase/migrations/20260907100000_restrict_users_update_self.sql`
- Test: `supabase/tests/023_restrict_users_update_self.test.sql`

**Interfaces:**
- Produces: a `before update on public.users` trigger that rejects (raises an exception) any update attempting to change `phone`, `unique_user_id`, `matches_played_count`, `matches_completed_count`, or `matches_abandoned_count`. All other columns remain freely updatable by the row's own owner (the pre-existing `users_update_self` policy, `auth.uid() = id`, is untouched by this task).

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- supabase/tests/023_restrict_users_update_self.test.sql
begin;
select plan(8);

select tests.create_supabase_user('editor', 'editor@example.com');
select tests.authenticate_as('editor');

insert into public.users (id, unique_user_id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values (tests.get_supabase_uid('editor'), 'FC-900001', '+390000900001', 'Anna', 'Neri', '1995-05-05', 168, 'right', 'player');

-- Editable fields: update succeeds.
select lives_ok(
  $$ update public.users set first_name = 'Anna Maria', last_name = 'Verdi', birth_date = '1995-06-06', height_cm = 170, preferred_foot = 'left', player_role = 'goalkeeper', profile_image_url = 'https://example.com/photo.jpg' where id = tests.get_supabase_uid('editor') $$,
  'updating only editable fields succeeds'
);

select is(
  (select first_name from public.users where id = tests.get_supabase_uid('editor')),
  'Anna Maria',
  'first_name was actually updated'
);

-- Protected fields: each one individually rejected.
select throws_ok(
  $$ update public.users set phone = '+390000999999' where id = tests.get_supabase_uid('editor') $$,
  'cannot modify phone, unique_user_id, or match count fields',
  'changing phone is rejected'
);

select throws_ok(
  $$ update public.users set unique_user_id = 'FC-999999' where id = tests.get_supabase_uid('editor') $$,
  'cannot modify phone, unique_user_id, or match count fields',
  'changing unique_user_id is rejected'
);

select throws_ok(
  $$ update public.users set matches_played_count = 99 where id = tests.get_supabase_uid('editor') $$,
  'cannot modify phone, unique_user_id, or match count fields',
  'changing matches_played_count is rejected'
);

select throws_ok(
  $$ update public.users set matches_completed_count = 99 where id = tests.get_supabase_uid('editor') $$,
  'cannot modify phone, unique_user_id, or match count fields',
  'changing matches_completed_count is rejected'
);

select throws_ok(
  $$ update public.users set matches_abandoned_count = 99 where id = tests.get_supabase_uid('editor') $$,
  'cannot modify phone, unique_user_id, or match count fields',
  'changing matches_abandoned_count is rejected'
);

-- A rejected update must not partially apply -- phone stays what it was before any of the above attempts.
select is(
  (select phone from public.users where id = tests.get_supabase_uid('editor')),
  '+390000900001',
  'phone is unchanged after all the rejected attempts'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd supabase && npx supabase test db`
Expected: FAIL — `public.users` has no such trigger yet, so every `throws_ok` fails (the update succeeds instead of raising) and the `lives_ok`/`is` checks may also behave unexpectedly since the table isn't in the state the test assumes yet.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260907100000_restrict_users_update_self.sql
-- A policy's USING/WITH CHECK cannot compare a column's OLD value against
-- its NEW value in one expression -- that comparison needs a trigger, the
-- same pattern already used in this schema for protect_match_invitation_
-- identity/protect_private_message_immutable_fields. security definer +
-- set search_path = '' is not strictly required here (this trigger reads
-- only OLD/NEW of the row already being modified, no external queries),
-- but every trigger function in this schema uses it as a standing
-- hardening convention, so this one does too for consistency.
create or replace function public.protect_users_identity_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.phone is distinct from old.phone
     or new.unique_user_id is distinct from old.unique_user_id
     or new.matches_played_count is distinct from old.matches_played_count
     or new.matches_completed_count is distinct from old.matches_completed_count
     or new.matches_abandoned_count is distinct from old.matches_abandoned_count
  then
    raise exception 'cannot modify phone, unique_user_id, or match count fields';
  end if;
  return new;
end;
$$;

create trigger trg_protect_users_identity_fields
  before update on public.users
  for each row execute function public.protect_users_identity_fields();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd supabase && npx supabase test db`
Expected: PASS, all 8 assertions in `023_restrict_users_update_self.test.sql`, plus every pre-existing pgTAP file still green (the full suite, not just the new file — a trigger on `users` is exactly the kind of change that can silently break an unrelated test that inserts/updates a `users` row).

- [ ] **Step 5: Commit**

```bash
cd "/path/to/this/worktree"
git add supabase/migrations/20260907100000_restrict_users_update_self.sql supabase/tests/023_restrict_users_update_self.test.sql
git commit -m "$(cat <<'EOF'
feat: add trigger protecting phone/unique_user_id/match counts on users

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Storage bucket for profile photos

**Files:**
- Create: `supabase/migrations/20260907100100_create_profile_images_bucket.sql`

**Interfaces:**
- Produces: a public Storage bucket `profile-images` with RLS allowing anyone to read, and only the owner of a `<user_id>/...` path to insert/update/delete under it.

No pgTAP test for this task — per the spec's §8 Testing section, this project has no established pattern yet for testing `storage.objects` RLS (no bucket existed before this plan), and building one from scratch for four simple, symmetric policies is disproportionate; this task's correctness is verified by the manual walkthrough in Task 10.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260907100100_create_profile_images_bucket.sql
insert into storage.buckets (id, name, public)
values ('profile-images', 'profile-images', true);

create policy "profile_images_public_read"
  on storage.objects for select
  using (bucket_id = 'profile-images');

create policy "profile_images_insert_own"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'profile-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "profile_images_update_own"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'profile-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "profile_images_delete_own"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'profile-images' and (storage.foldername(name))[1] = auth.uid()::text);
```

- [ ] **Step 2: Apply the migration and verify the bucket exists**

Run: `cd supabase && npx supabase db reset` (or, if already applied by the running local instance, verify directly: `docker exec supabase_db_backend-foundation psql -U postgres -d postgres -c "select id, public from storage.buckets;"` should show one row, `profile-images | t`).
Expected: the bucket and its four policies exist; the full pgTAP suite from Task 1 still passes after the reset (a `db reset` replays every migration from scratch).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260907100100_create_profile_images_bucket.sql
git commit -m "$(cat <<'EOF'
feat: create public profile-images storage bucket with per-user write RLS

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `updateOwnProfile` in the data layer

**Files:**
- Modify: `mobile/src/api/users.ts`
- Test: `mobile/src/api/users.test.ts` (create if it doesn't exist yet — check first)

**Interfaces:**
- Consumes: `supabase` client from `./supabase` (same import as the rest of this file); `Database['public']['Tables']['users']['Row']` type, already imported in this file as `UserProfile`.
- Produces: `export async function updateOwnProfile(userId: string, fields: Partial<Pick<UserProfile, 'first_name' | 'last_name' | 'birth_date' | 'height_cm' | 'preferred_foot' | 'player_role' | 'profile_image_url'>>): Promise<UserProfile>`

- [ ] **Step 1: Check whether `mobile/src/api/users.test.ts` already exists**

Run: `ls mobile/src/api/users.test.ts`
If it exists, read it first and add the new `describe('updateOwnProfile', ...)` block to it, following its existing style. If it doesn't exist, create it fresh with the content below.

- [ ] **Step 2: Write the failing tests**

```ts
// mobile/src/api/users.test.ts
import { supabase } from './supabase';
import { createOwnProfile, fetchOwnProfile, updateOwnProfile } from './users';

jest.mock('./supabase', () => ({ supabase: { from: jest.fn() } }));

describe('users api', () => {
  afterEach(() => jest.clearAllMocks());

  describe('updateOwnProfile', () => {
    it('updates only the passed fields and returns the updated row', async () => {
      const updatedRow = {
        id: 'u1',
        unique_user_id: 'FC-100001',
        phone: '+390000000001',
        first_name: 'Mario',
        last_name: 'Bianchi',
        birth_date: '1990-01-01',
        height_cm: 182,
        preferred_foot: 'left',
        player_role: 'goalkeeper',
        profile_image_url: null,
        matches_played_count: 0,
        matches_completed_count: 0,
        matches_abandoned_count: 0,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };
      const single = jest.fn().mockResolvedValue({ data: updatedRow, error: null });
      const select = jest.fn().mockReturnValue({ single });
      const eq = jest.fn().mockReturnValue({ select });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      const result = await updateOwnProfile('u1', { last_name: 'Bianchi', height_cm: 182, preferred_foot: 'left', player_role: 'goalkeeper' });

      expect(supabase.from).toHaveBeenCalledWith('users');
      expect(update).toHaveBeenCalledWith({ last_name: 'Bianchi', height_cm: 182, preferred_foot: 'left', player_role: 'goalkeeper' });
      expect(eq).toHaveBeenCalledWith('id', 'u1');
      expect(result).toEqual(updatedRow);
    });

    it('translates the immutable-fields trigger exception into a neutral Italian message', async () => {
      const single = jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'cannot modify phone, unique_user_id, or match count fields', code: 'P0001' },
      });
      const select = jest.fn().mockReturnValue({ single });
      const eq = jest.fn().mockReturnValue({ select });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await expect(updateOwnProfile('u1', { first_name: 'X' })).rejects.toThrow('Non è possibile modificare questi dati del profilo.');
    });

    it('throws the raw message for an unrelated error', async () => {
      const single = jest.fn().mockResolvedValue({ data: null, error: { message: 'network error', code: undefined } });
      const select = jest.fn().mockReturnValue({ single });
      const eq = jest.fn().mockReturnValue({ select });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await expect(updateOwnProfile('u1', { first_name: 'X' })).rejects.toThrow('network error');
    });
  });
});
```

- [ ] **Step 3: Run tests to verify the new ones fail**

Run: `cd mobile && npx jest src/api/users.test.ts`
Expected: FAIL — `updateOwnProfile` is not exported yet.

- [ ] **Step 4: Write the implementation**

Add to `mobile/src/api/users.ts` (keep `createOwnProfile` and `fetchOwnProfile` exactly as they are):

```ts
// Matches the exact text raised by trg_protect_users_identity_fields
// (supabase/migrations/20260907100000_restrict_users_update_self.sql) --
// a plain RAISE EXCEPTION with no explicit SQLSTATE, which Postgres
// surfaces as P0001, not a standard RLS/constraint code like 42501 or
// 23505. Matched by message text, not code, for that reason.
function translateProfileUpdateError(message: string): string {
  if (message === 'cannot modify phone, unique_user_id, or match count fields') {
    return 'Non è possibile modificare questi dati del profilo.';
  }
  return message;
}

export async function updateOwnProfile(
  userId: string,
  fields: Partial<Pick<UserProfile, 'first_name' | 'last_name' | 'birth_date' | 'height_cm' | 'preferred_foot' | 'player_role' | 'profile_image_url'>>
): Promise<UserProfile> {
  const { data, error } = await supabase.from('users').update(fields).eq('id', userId).select().single();
  if (error) throw new Error(translateProfileUpdateError(error.message));
  return data as UserProfile;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd mobile && npx jest src/api/users.test.ts`
Expected: PASS, all tests in the file (the new `updateOwnProfile` block plus any pre-existing tests for `createOwnProfile`/`fetchOwnProfile` if the file already existed).

- [ ] **Step 6: Commit**

```bash
cd mobile
git add src/api/users.ts src/api/users.test.ts
git commit -m "$(cat <<'EOF'
feat: add updateOwnProfile to the users data layer

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `uploadProfileImage` in the data layer

**Files:**
- Modify: `mobile/src/api/users.ts`
- Test: `mobile/src/api/users.test.ts`
- Modify: `mobile/package.json` (new dependencies)

**Interfaces:**
- Consumes: `supabase` client (same as Task 3).
- Produces: `export async function uploadProfileImage(userId: string, localUri: string): Promise<string>` — returns the new file's public URL.

- [ ] **Step 1: Install the new dependencies**

```bash
cd mobile
npx expo install expo-file-system
npm install base64-arraybuffer
```

- [ ] **Step 2: Write the failing tests**

Append to `mobile/src/api/users.test.ts`:

```ts
// Add these imports at the top of the file, alongside the existing ones:
// import * as FileSystem from 'expo-file-system';
// import { uploadProfileImage } from './users';
//
// Add this mock alongside the existing jest.mock('./supabase', ...) call:
// jest.mock('expo-file-system', () => ({ readAsStringAsync: jest.fn(), EncodingType: { Base64: 'base64' } }));

describe('uploadProfileImage', () => {
  it('reads the local file, uploads it, and returns the public URL', async () => {
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue('ZmFrZS1pbWFnZS1kYXRh'); // base64 of "fake-image-data"
    const upload = jest.fn().mockResolvedValue({ data: { path: 'u1/1700000000000.jpg' }, error: null });
    const getPublicUrl = jest.fn().mockReturnValue({ data: { publicUrl: 'https://storage.example.com/profile-images/u1/1700000000000.jpg' } });
    (supabase.storage as unknown as { from: jest.Mock }) = { from: jest.fn().mockReturnValue({ upload, getPublicUrl }) } as never;

    const result = await uploadProfileImage('u1', 'file:///tmp/photo.jpg');

    expect(FileSystem.readAsStringAsync).toHaveBeenCalledWith('file:///tmp/photo.jpg', { encoding: 'base64' });
    expect(supabase.storage.from).toHaveBeenCalledWith('profile-images');
    expect(upload.mock.calls[0][0]).toMatch(/^u1\/\d+\.jpg$/);
    expect(upload.mock.calls[0][2]).toEqual({ contentType: 'image/jpeg', upsert: false });
    expect(getPublicUrl).toHaveBeenCalledWith(upload.mock.calls[0][0]);
    expect(result).toBe('https://storage.example.com/profile-images/u1/1700000000000.jpg');
  });

  it('throws the raw Supabase error message when the upload fails', async () => {
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue('ZmFrZS1pbWFnZS1kYXRh');
    const upload = jest.fn().mockResolvedValue({ data: null, error: { message: 'storage quota exceeded' } });
    (supabase.storage as unknown as { from: jest.Mock }) = { from: jest.fn().mockReturnValue({ upload, getPublicUrl: jest.fn() }) } as never;

    await expect(uploadProfileImage('u1', 'file:///tmp/photo.jpg')).rejects.toThrow('storage quota exceeded');
  });
});
```

Note: `supabase.storage` is reassigned per-test here rather than chained through the module-level `jest.mock('./supabase', ...)` factory (which only mocks `.from` for the Postgres table client) — the storage client is a genuinely separate namespace on the same client object, so this is the simplest way to mock it without restructuring the existing `./supabase` mock that every other test in this file already depends on.

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd mobile && npx jest src/api/users.test.ts`
Expected: FAIL — `uploadProfileImage` is not exported yet, and the `FileSystem`/`uploadProfileImage` imports referenced in Step 2's comment aren't in the file yet either (add them for real now, not just as a comment — the comment in Step 2 exists only to show where they go relative to the existing imports).

- [ ] **Step 4: Write the implementation**

At the top of `mobile/src/api/users.ts`, add:

```ts
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
```

Add the function:

```ts
// Reads the local file as base64 and decodes to an ArrayBuffer for the
// upload -- fetch(uri).blob() is not reliable for local file:// URIs on
// React Native, this base64-round-trip is the pattern Supabase's own
// docs recommend for Expo. The millisecond timestamp in the path
// guarantees a fresh public URL on every upload, so no cache (client or
// CDN) can ever serve a stale photo under an old URL, and there's never
// a need for upsert or a delete-before-upload step.
export async function uploadProfileImage(userId: string, localUri: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: 'base64' });
  const path = `${userId}/${Date.now()}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from('profile-images')
    .upload(path, decode(base64), { contentType: 'image/jpeg', upsert: false });
  if (uploadError) throw new Error(uploadError.message);
  const { data } = supabase.storage.from('profile-images').getPublicUrl(path);
  return data.publicUrl;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd mobile && npx jest src/api/users.test.ts`
Expected: PASS, every test in the file.

- [ ] **Step 6: Run typecheck**

Run: `cd mobile && npm run typecheck`
Expected: clean (confirms `expo-file-system` and `base64-arraybuffer`'s types resolve correctly).

- [ ] **Step 7: Commit**

```bash
cd mobile
git add package.json package-lock.json src/api/users.ts src/api/users.test.ts
git commit -m "$(cat <<'EOF'
feat: add uploadProfileImage to the users data layer

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `ProfileForm` shared component

**Files:**
- Create: `mobile/src/components/ProfileForm.tsx`
- Modify: `mobile/app.json` (add `expo-image-picker` plugin config)

**Interfaces:**
- Consumes: `FOOT_LABELS`, `ROLE_LABELS` from `@/utils/profileDisplay` (already exist).
- Produces:
  ```ts
  export interface ProfileFormValues {
    firstName: string;
    lastName: string;
    birthDate: string;
    heightCm: string;
    preferredFoot: 'left' | 'right' | 'both';
    playerRole: 'player' | 'goalkeeper' | 'both';
  }
  ```
  `export function ProfileForm(props: { initialValues?: ProfileFormValues; currentImageUrl?: string | null; showImagePicker?: boolean; onImageSelected?: (localUri: string) => void; onSubmit: (values: ProfileFormValues) => void; submitLabel: string; loading?: boolean; error?: string | null }): JSX.Element`

No automated test for this component — matches this codebase's established convention of no screen/component-level automated tests for form UI (see `MatchForm`, which has none either). Verified by Task 6's typecheck (used by `create-profile.tsx`) and Task 10's manual walkthrough.

- [ ] **Step 1: Install `expo-image-picker` and configure the plugin**

```bash
cd mobile
npx expo install expo-image-picker
```

In `mobile/app.json`, the `plugins` array currently reads:
```json
    "plugins": [
      "expo-router",
      [
        "expo-splash-screen",
        {
          "backgroundColor": "#208AEF",
          "image": "./assets/images/splash-icon.png",
          "imageWidth": 76
        }
      ],
      "expo-secure-store"
    ],
```
Add `expo-image-picker` as a new entry with its permission string:
```json
    "plugins": [
      "expo-router",
      [
        "expo-splash-screen",
        {
          "backgroundColor": "#208AEF",
          "image": "./assets/images/splash-icon.png",
          "imageWidth": 76
        }
      ],
      "expo-secure-store",
      [
        "expo-image-picker",
        {
          "photosPermission": "Consente all'app di accedere alle tue foto per impostare l'immagine del profilo."
        }
      ]
    ],
```

- [ ] **Step 2: Write the component**

```tsx
// mobile/src/components/ProfileForm.tsx
import { useState } from 'react';
import { View, TextInput, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { FOOT_LABELS, ROLE_LABELS } from '@/utils/profileDisplay';

const FEET = ['left', 'right', 'both'] as const;
const ROLES = ['player', 'goalkeeper', 'both'] as const;

export interface ProfileFormValues {
  firstName: string;
  lastName: string;
  birthDate: string;
  heightCm: string;
  preferredFoot: (typeof FEET)[number];
  playerRole: (typeof ROLES)[number];
}

interface ProfileFormProps {
  initialValues?: ProfileFormValues;
  currentImageUrl?: string | null;
  showImagePicker?: boolean;
  onImageSelected?: (localUri: string) => void;
  onSubmit: (values: ProfileFormValues) => void;
  submitLabel: string;
  loading?: boolean;
  error?: string | null;
}

export function ProfileForm({
  initialValues,
  currentImageUrl,
  showImagePicker,
  onImageSelected,
  onSubmit,
  submitLabel,
  loading,
  error,
}: ProfileFormProps) {
  const [firstName, setFirstName] = useState(initialValues?.firstName ?? '');
  const [lastName, setLastName] = useState(initialValues?.lastName ?? '');
  const [birthDate, setBirthDate] = useState(initialValues?.birthDate ?? '');
  const [heightCm, setHeightCm] = useState(initialValues?.heightCm ?? '');
  const [preferredFoot, setPreferredFoot] = useState<(typeof FEET)[number]>(initialValues?.preferredFoot ?? 'right');
  const [playerRole, setPlayerRole] = useState<(typeof ROLES)[number]>(initialValues?.playerRole ?? 'player');
  const [previewUri, setPreviewUri] = useState<string | null>(null);

  const canSubmit = !!(firstName && lastName && birthDate && heightCm);

  async function handlePickImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled && result.assets[0]) {
      setPreviewUri(result.assets[0].uri);
      onImageSelected?.(result.assets[0].uri);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {showImagePicker && (
        <Pressable style={styles.avatarWrapper} onPress={handlePickImage}>
          {previewUri || currentImageUrl ? (
            <Image source={{ uri: previewUri ?? currentImageUrl ?? undefined }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarPlaceholderText}>{firstName ? firstName.charAt(0).toUpperCase() : '?'}</Text>
            </View>
          )}
          <Text style={styles.avatarHint}>Tocca per cambiare foto</Text>
        </Pressable>
      )}
      <TextInput style={styles.input} placeholder="Nome" value={firstName} onChangeText={setFirstName} />
      <TextInput style={styles.input} placeholder="Cognome" value={lastName} onChangeText={setLastName} />
      <TextInput style={styles.input} placeholder="Data di nascita (AAAA-MM-GG)" value={birthDate} onChangeText={setBirthDate} />
      <TextInput style={styles.input} placeholder="Altezza (cm)" keyboardType="number-pad" value={heightCm} onChangeText={setHeightCm} />
      <Text style={styles.label}>Piede preferito</Text>
      <View style={styles.row}>
        {FEET.map((foot) => (
          <Pressable key={foot} style={[styles.chip, preferredFoot === foot && styles.chipSelected]} onPress={() => setPreferredFoot(foot)}>
            <Text style={preferredFoot === foot ? styles.chipTextSelected : styles.chipText}>{FOOT_LABELS[foot]}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.label}>Ruolo</Text>
      <View style={styles.row}>
        {ROLES.map((role) => (
          <Pressable key={role} style={[styles.chip, playerRole === role && styles.chipSelected]} onPress={() => setPlayerRole(role)}>
            <Text style={playerRole === role ? styles.chipTextSelected : styles.chipText}>{ROLE_LABELS[role]}</Text>
          </Pressable>
        ))}
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        style={styles.button}
        disabled={loading || !canSubmit}
        onPress={() => onSubmit({ firstName, lastName, birthDate, heightCm, preferredFoot, playerRole })}
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{submitLabel}</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 12 },
  avatarWrapper: { alignItems: 'center', marginBottom: 12 },
  avatar: { width: 88, height: 88, borderRadius: 44 },
  avatarPlaceholder: { backgroundColor: '#1a7f37', alignItems: 'center', justifyContent: 'center' },
  avatarPlaceholderText: { color: '#fff', fontSize: 36, fontWeight: '700' },
  avatarHint: { color: '#1a7f37', fontSize: 13, marginTop: 8, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 16 },
  label: { fontWeight: '600', marginTop: 8 },
  row: { flexDirection: 'row', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#ccc', borderRadius: 20, paddingVertical: 8, paddingHorizontal: 16 },
  chipSelected: { backgroundColor: '#1a7f37', borderColor: '#1a7f37' },
  chipText: { color: '#333' },
  chipTextSelected: { color: '#fff' },
  button: { backgroundColor: '#1a7f37', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 16 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  error: { color: '#c0392b' },
});
```

- [ ] **Step 3: Run typecheck**

Run: `cd mobile && npm run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
cd mobile
git add app.json src/components/ProfileForm.tsx package.json package-lock.json
git commit -m "$(cat <<'EOF'
feat: add shared ProfileForm component with optional photo picker

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Refactor `create-profile.tsx` to use `ProfileForm`

**Files:**
- Modify: `mobile/app/(auth)/create-profile.tsx`

**Interfaces:**
- Consumes: `ProfileForm`, `type ProfileFormValues` from `@/components/ProfileForm` (Task 5).

- [ ] **Step 1: Replace the inline form with `ProfileForm`**

Replace the entire content of `mobile/app/(auth)/create-profile.tsx` with:

```tsx
import { View, Text, StyleSheet } from 'react-native';
import { useRegistration } from '@/hooks/useRegistration';
import { useSessionStore } from '@/stores/sessionStore';
import { ProfileForm, type ProfileFormValues } from '@/components/ProfileForm';

export default function CreateProfileScreen() {
  const userId = useSessionStore((s) => s.session?.user.id);
  const { completeProfile, loading, error } = useRegistration();

  function handleSubmit(values: ProfileFormValues) {
    if (!userId) return;
    completeProfile({
      userId,
      firstName: values.firstName,
      lastName: values.lastName,
      birthDate: values.birthDate,
      heightCm: Number(values.heightCm),
      preferredFoot: values.preferredFoot,
      playerRole: values.playerRole,
    });
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Crea il tuo profilo</Text>
      <ProfileForm onSubmit={handleSubmit} submitLabel="Crea profilo" loading={loading} error={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 24 },
  title: { fontSize: 28, fontWeight: '700', paddingHorizontal: 24 },
});
```

This drops the old `canSubmit` gate that also required `!!userId` (the button was disabled without a session) — `ProfileForm`'s own `canSubmit` no longer knows about `userId`, so `handleSubmit`'s own `if (!userId) return;` guard is what replaces it: the button becomes pressable once the required text fields are filled, but pressing it silently no-ops without a session instead of being disabled. This screen is only ever reached with an active session (it's an auth-flow screen gated by the root layout), so `userId` is always present here in practice; this is a cosmetic behavior change with no reachable bad state, not a regression.

- [ ] **Step 2: Run typecheck**

Run: `cd mobile && npm run typecheck`
Expected: clean.

- [ ] **Step 3: Run the full test suite**

Run: `cd mobile && npm test`
Expected: PASS, no test references the old inline JSX structure of this screen (no screen-level tests exist for it), so nothing should break.

- [ ] **Step 4: Commit**

```bash
cd mobile
git add "app/(auth)/create-profile.tsx"
git commit -m "$(cat <<'EOF'
refactor: use shared ProfileForm in create-profile screen

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `useEditProfile` hook

**Files:**
- Create: `mobile/src/hooks/useEditProfile.ts`
- Test: `mobile/src/hooks/useEditProfile.test.ts`

**Interfaces:**
- Consumes: `updateOwnProfile`, `uploadProfileImage` from `@/api/users` (Tasks 3, 4); `useSessionStore` from `@/stores/sessionStore`; `type ProfileFormValues` from `@/components/ProfileForm` (Task 5).
- Produces: `export function useEditProfile()` returning `{ profile: UserProfile | null; loading: boolean; error: string | null; save: (values: ProfileFormValues, newImageUri?: string) => Promise<boolean> }`

- [ ] **Step 1: Write the failing test**

```ts
// mobile/src/hooks/useEditProfile.test.ts
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { useEditProfile } from './useEditProfile';
import { updateOwnProfile, uploadProfileImage } from '@/api/users';
import { useSessionStore } from '@/stores/sessionStore';

jest.mock('@/api/users', () => ({
  updateOwnProfile: jest.fn(),
  uploadProfileImage: jest.fn(),
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

const formValues = {
  firstName: 'Mario',
  lastName: 'Bianchi',
  birthDate: '1990-01-01',
  heightCm: '182',
  preferredFoot: 'left' as const,
  playerRole: 'goalkeeper' as const,
};

describe('useEditProfile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSessionStore.setState({
      session: { user: { id: 'u1' } } as never,
      profile: existingProfile as never,
      status: 'signed-in',
    });
  });

  it('exposes the current profile from the session store', async () => {
    const { result } = await renderHook(() => useEditProfile());
    expect(result.current.profile).toEqual(existingProfile);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('save() without a new image calls updateOwnProfile only, and updates the session store', async () => {
    const updatedRow = { ...existingProfile, last_name: 'Bianchi', height_cm: 182, preferred_foot: 'left', player_role: 'goalkeeper' };
    (updateOwnProfile as jest.Mock).mockResolvedValue(updatedRow);

    const { result } = await renderHook(() => useEditProfile());

    let success = false;
    await act(async () => {
      success = await result.current.save(formValues);
    });

    expect(success).toBe(true);
    expect(uploadProfileImage).not.toHaveBeenCalled();
    expect(updateOwnProfile).toHaveBeenCalledWith('u1', {
      first_name: 'Mario',
      last_name: 'Bianchi',
      birth_date: '1990-01-01',
      height_cm: 182,
      preferred_foot: 'left',
      player_role: 'goalkeeper',
    });
    expect(useSessionStore.getState().profile).toEqual(updatedRow);
  });

  it('save() with a new image uploads first, then includes the returned URL in the update', async () => {
    (uploadProfileImage as jest.Mock).mockResolvedValue('https://storage.example.com/u1/123.jpg');
    const updatedRow = { ...existingProfile, profile_image_url: 'https://storage.example.com/u1/123.jpg' };
    (updateOwnProfile as jest.Mock).mockResolvedValue(updatedRow);

    const { result } = await renderHook(() => useEditProfile());

    await act(async () => {
      await result.current.save(formValues, 'file:///tmp/new-photo.jpg');
    });

    expect(uploadProfileImage).toHaveBeenCalledWith('u1', 'file:///tmp/new-photo.jpg');
    expect(updateOwnProfile).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ profile_image_url: 'https://storage.example.com/u1/123.jpg' })
    );
  });

  it('save() sets an error and returns false on failure, without touching the session store', async () => {
    (updateOwnProfile as jest.Mock).mockRejectedValue(new Error('Non è possibile modificare questi dati del profilo.'));

    const { result } = await renderHook(() => useEditProfile());

    let success = true;
    await act(async () => {
      success = await result.current.save(formValues);
    });

    expect(success).toBe(false);
    expect(result.current.error).toBe('Non è possibile modificare questi dati del profilo.');
    expect(useSessionStore.getState().profile).toEqual(existingProfile);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/hooks/useEditProfile.test.ts`
Expected: FAIL with "Cannot find module './useEditProfile'"

- [ ] **Step 3: Write the implementation**

```ts
// mobile/src/hooks/useEditProfile.ts
import { useState } from 'react';
import { updateOwnProfile, uploadProfileImage } from '@/api/users';
import { useSessionStore } from '@/stores/sessionStore';
import type { ProfileFormValues } from '@/components/ProfileForm';

export function useEditProfile() {
  const userId = useSessionStore((s) => s.session?.user.id);
  const profile = useSessionStore((s) => s.profile);
  const setProfile = useSessionStore((s) => s.setProfile);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(values: ProfileFormValues, newImageUri?: string): Promise<boolean> {
    if (!userId) return false;
    setLoading(true);
    setError(null);
    try {
      let profileImageUrl: string | undefined;
      if (newImageUri) {
        profileImageUrl = await uploadProfileImage(userId, newImageUri);
      }
      const updated = await updateOwnProfile(userId, {
        first_name: values.firstName,
        last_name: values.lastName,
        birth_date: values.birthDate,
        height_cm: Number(values.heightCm),
        preferred_foot: values.preferredFoot,
        player_role: values.playerRole,
        ...(profileImageUrl ? { profile_image_url: profileImageUrl } : {}),
      });
      setProfile(updated);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile salvare le modifiche.');
      return false;
    } finally {
      setLoading(false);
    }
  }

  return { profile, loading, error, save };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/hooks/useEditProfile.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Commit**

```bash
cd mobile
git add src/hooks/useEditProfile.ts src/hooks/useEditProfile.test.ts
git commit -m "$(cat <<'EOF'
feat: add useEditProfile hook

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `profile/edit.tsx` screen

**Files:**
- Create: `mobile/app/(tabs)/profile/edit.tsx`

**Interfaces:**
- Consumes: `useEditProfile` (Task 7); `ProfileForm`, `type ProfileFormValues` (Task 5).

No automated test — matches this codebase's established no-screen-tests convention. Verified by typecheck and Task 10's manual walkthrough.

- [ ] **Step 1: Write the screen**

```tsx
// mobile/app/(tabs)/profile/edit.tsx
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useEditProfile } from '@/hooks/useEditProfile';
import { ProfileForm, type ProfileFormValues } from '@/components/ProfileForm';

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

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <Pressable onPress={() => router.back()}>
        <Text style={styles.backLink}>← Torna al profilo</Text>
      </Pressable>
      <Text style={styles.header}>Modifica profilo</Text>
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

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16 },
  backLink: { color: '#1a7f37', marginBottom: 8 },
  header: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
});
```

- [ ] **Step 2: Run typecheck**

Run: `cd mobile && npm run typecheck`
Expected: clean. Nothing links TO this new screen yet (Task 9 adds the button that does), so there's no forward-reference route-typing concern here — this file only needs its own imports (`useEditProfile` from Task 7, `ProfileForm`/`ProfileFormValues` from Task 5) to resolve correctly.

- [ ] **Step 3: Commit**

```bash
cd mobile
git add "app/(tabs)/profile/edit.tsx"
git commit -m "$(cat <<'EOF'
feat: add edit-profile screen

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Wire up navigation — button, and the required `_layout.tsx`

**Files:**
- Modify: `mobile/app/(tabs)/profile/index.tsx`
- Create: `mobile/app/(tabs)/profile/_layout.tsx`

**Interfaces:**
- Consumes: the route `/(tabs)/profile/edit` (Task 8).

- [ ] **Step 1: Add the "Modifica profilo" button**

`mobile/app/(tabs)/profile/index.tsx` currently ends its JSX with:
```tsx
      <Pressable style={styles.logoutButton} onPress={() => supabase.auth.signOut()}>
        <Text style={styles.logoutText}>Esci</Text>
      </Pressable>
    </View>
  );
}
```
Change the imports at the top to add `useRouter`:
```tsx
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSessionStore } from '@/stores/sessionStore';
import { supabase } from '@/api/supabase';
import { calculateAge, FOOT_LABELS, ROLE_LABELS } from '@/utils/profileDisplay';

export default function ProfileScreen() {
  const router = useRouter();
  const profile = useSessionStore((s) => s.profile);
```
And change the ending to add the new button, between the stats and the logout button:
```tsx
      <Pressable style={styles.editButton} onPress={() => router.push('/(tabs)/profile/edit')}>
        <Text style={styles.editButtonText}>Modifica profilo</Text>
      </Pressable>

      <Pressable style={styles.logoutButton} onPress={() => supabase.auth.signOut()}>
        <Text style={styles.logoutText}>Esci</Text>
      </Pressable>
    </View>
  );
}
```
Add the new style to the existing `StyleSheet.create` call, alongside `logoutButton`/`logoutText`:
```tsx
  editButton: { marginTop: 24, backgroundColor: '#1a7f37', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 24 },
  editButtonText: { color: '#fff', fontWeight: '600' },
```

- [ ] **Step 2: Create the layout file**

```tsx
// mobile/app/(tabs)/profile/_layout.tsx
import { Stack } from 'expo-router';

export default function ProfileLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="edit" />
    </Stack>
  );
}
```

This is required — see this plan's Global Constraints: `index.tsx` and `edit.tsx` are direct siblings inside the `(tabs)/profile/` tab folder, the exact shape that already caused Expo Router to auto-promote a nested route into its own top-level tab in both the `persone` and `messaggi` plans. Without this file, expect the tab bar to show 6 tabs instead of 5 the first time this is tested live.

- [ ] **Step 3: Run typecheck**

Run: `cd mobile && npm run typecheck`
Expected: clean.

- [ ] **Step 4: Run the full test suite**

Run: `cd mobile && npm test`
Expected: PASS, full suite green (no test touches `profile/index.tsx` directly, but this is a good point to catch any accidental collateral break before the manual walkthrough).

- [ ] **Step 5: Commit**

```bash
cd mobile
git add "app/(tabs)/profile/index.tsx" "app/(tabs)/profile/_layout.tsx"
git commit -m "$(cat <<'EOF'
feat: add Modifica profilo button and the required profile/_layout.tsx

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Manual verification

**Files:** none (manual walkthrough, no code changes)

- [ ] **Step 1: Run the full automated suite one more time**

Run: `cd mobile && npm run typecheck && npm test` and `cd supabase && npx supabase test db`
Expected: typecheck clean; full Jest suite green (prior total + this plan's new tests: 3 from Task 3 + 2 from Task 4 + 4 from Task 7 = 9 new tests); full pgTAP suite green (prior file count + this plan's `023_restrict_users_update_self.test.sql`, 8 assertions).

- [ ] **Step 2: Live walkthrough in the iOS Simulator**

Using an existing test user (e.g. Mario Rossi):
1. Open Profilo, confirm the tab bar still shows exactly 5 tabs (the `_layout.tsx` check).
2. Tap "Modifica profilo". Confirm the form is pre-filled with the current name/birth date/height/foot/role, and the foot/role chips show the Italian labels ("Sinistro"/"Destro"/"Entrambi", "Giocatore"/"Portiere"/"Entrambi"), not the raw English values.
3. Change the last name, height, preferred foot, and role. Tap "Salva modifiche". Confirm navigation back to the Profilo screen, and that it immediately shows the updated values with no manual refresh needed (confirms the session-store update in `useEditProfile`).
4. Query the database directly to confirm the row actually changed and that `phone`/`unique_user_id`/the three match counters are unchanged.
5. Return to "Modifica profilo", tap the avatar, pick a photo from the simulator's photo library (seed one via `xcrun simctl addmedia <udid> <path-to-any-jpg>` first if the simulator's library is empty), confirm the picked photo shows as a preview immediately. Save. Confirm the new photo appears on the Profilo screen.
6. Query the database directly to confirm `profile_image_url` is a `https://.../storage/v1/object/public/profile-images/<user_id>/...` URL, and confirm the file is actually fetchable (`curl -I <that URL>` returns `200`).
7. Open the same profile from another surface that renders `profile_image_url` (e.g. this user's own row in a match's participant roster, or their profile as viewed by a friend in Persone) and confirm the new photo shows there too, without any of that code having been touched by this plan.
8. Log in as a fresh registering user and confirm `create-profile.tsx` still works end-to-end (Task 6's refactor didn't break initial registration) — Italian labels on the chips there too, submit succeeds, lands on Home.

- [ ] **Step 3: Clean up test data**

If a throwaway registration was created in step 8, note it for cleanup but no destructive action is needed mid-session; if the walkthrough leaves any test artifacts (e.g. an extra uploaded photo under a real test user's path in `profile-images`), no cleanup is required — unlike match/friendship/message rows used in prior plans' walkthroughs, an extra profile photo revision for an existing test user causes no test pollution for future sessions (the old photo is simply an orphaned but harmless object in storage; see the spec's §9 "no cleanup of replaced photos" accepted limitation).

- [ ] **Step 4: Update the SDD ledger**

Record the walkthrough's outcome (pass/fail, any bugs found and fixed) in `.superpowers/sdd/2026-09-07-modifica-profilo/progress.md`, following the same style as every prior plan's final manual-verification entry.
