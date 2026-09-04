# Match Room Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a match's creator and its approved/active/completed participants read and send
messages in a real-time chat scoped to that match, with the ability to mention a single other
eligible participant and have them receive a dedicated notification.

**Architecture:** Backend: three focused migrations — fix a real RLS gap (the creator currently
cannot access their own match's chat), add a `match_message_mentions` table with backend-enforced
validation, and replace the existing `AFTER INSERT` notification trigger with a single
`send_match_message` RPC (the trigger fires too early to see mention rows, which must be inserted
after the message they reference exists). Mobile: one new API file, one new hook wrapping a
Supabase Realtime subscription plus optimistic send, a route restructure (`match/[id].tsx` becomes
`match/[id]/index.tsx` so a sibling `chat.tsx` can exist), a new chat screen, and a small
navigation change in the existing notifications screen.

**Tech Stack:** React Native + Expo Router, Supabase (Postgres + RLS + Realtime) — already in
place, see `docs/superpowers/plans/2026-09-02-match-participation.md` for the foundation this
builds on. This is the first feature in the codebase to use Supabase Realtime from the mobile
client.

**Spec:** [docs/superpowers/specs/2026-09-04-match-room-chat-design.md](../specs/2026-09-04-match-room-chat-design.md)
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
- `useSessionStore` (Zustand, `mobile/src/stores/sessionStore.ts`) does NOT import `supabase.ts`
  and is safe to import un-mocked in tests — set it up per-test with
  `useSessionStore.setState({ session: ..., profile: ..., status: ... })`. `profile` is the raw
  `users` table row (`first_name`, `last_name`, `profile_image_url` among its fields) — the same
  shape `user_public_profiles` (a view over this same table) exposes for other users.
- **`public.user_public_profiles`** (a view, not a table) is readable by **any** authenticated
  user for **any** other user, never exposes `phone`. It has no PostgREST-discoverable FK from
  `match_messages.sender_id` or `match_participants.user_id`, so joining sender/participant
  profiles is always **two separate queries merged client-side** — this plan's API functions
  follow the exact pattern already established in `mobile/src/api/participants.ts`
  (`fetchMatchParticipantProfiles`): fetch the owning rows, collect the distinct user ids, fetch
  `user_public_profiles` filtered `.in('id', ids)`, merge with a `Map`.
- **Supabase Realtime channel mocking (new to this codebase — this plan is the first feature to
  use it).** Mock shape for any test touching a hook that subscribes:
  ```ts
  jest.mock('@/api/supabase', () => ({
    supabase: { from: jest.fn(), rpc: jest.fn(), channel: jest.fn(), removeChannel: jest.fn() },
  }));
  ```
  In the test body:
  ```ts
  const mockChannel = { on: jest.fn().mockReturnThis(), subscribe: jest.fn().mockReturnThis() };
  (supabase.channel as jest.Mock).mockReturnValue(mockChannel);
  // ... render the hook ...
  const onInsert = mockChannel.on.mock.calls[0][2]; // the callback passed to .on(...)
  act(() => { onInsert({ new: { id: 'm2', match_id: 'm1', sender_id: 'u2', body: 'ciao', created_at: '...' } }); });
  ```
- **Inverted `FlatList` ordering.** The chat screen renders messages in a `FlatList` with
  `inverted`, the standard React Native pattern for chat UIs (it starts scrolled to the newest
  message and reveals older ones by scrolling up). This means the **data array must be
  newest-first** (`created_at` descending, index `0` = newest) — the opposite of normal
  chronological order. `fetchMatchMessages` returns newest-first for exactly this reason; new
  messages (optimistic or from Realtime) are **prepended** (`[newMessage, ...prev]`), never
  appended. Getting this backwards silently inverts the whole chat visually — there is no runtime
  error to catch it, only a wrong-looking screen.
- **RPC return shape.** `send_match_message` is declared `returns public.match_messages` (a
  single row, not `setof`), so `supabase.rpc('send_match_message', {...})` resolves `data` to the
  row object directly — do **not** chain `.single()` on it (that method exists for `.select()`
  table queries, not for a scalar-returning RPC call).
- **Own messages are never read back through the Realtime subscription.** `sendMatchMessage`'s
  RPC call already returns the freshly-inserted row directly, so the hook uses that return value
  to reconcile its own optimistic message. The Realtime `INSERT` handler explicitly ignores any
  row where `sender_id` equals the current user's id — this is what avoids ever rendering your
  own message twice (once optimistically, once from the echo).
- **Route file → folder conversion is a pure rename, not a behavior change.** Expo Router treats
  `match/[id]/index.tsx` as the exact same route (`/home/match/[id]`) as `match/[id].tsx` — every
  existing `router.push({ pathname: '/(tabs)/home/match/[id]', ... })` call site (there are four:
  `home/index.tsx`, `notifications.tsx`, `my-matches/index.tsx`, `useCreateMatch.ts`) keeps
  working unmodified. `npm run typecheck` (Expo's typed routes) is the safety net that proves
  this — it fails loudly if any of the four call sites' literal path strings stop resolving.
- No screen-level (component) tests exist anywhere in this codebase (established precedent from
  match-creation and match-participation). This plan follows the same precedent: `chat.tsx` has
  no dedicated test file; its logic is covered by testing `useMatchChat` and the API functions it
  calls, plus manual end-to-end verification in the final task.
- Supabase JS chainable mocks in this codebase follow a specific nesting style — see
  `mobile/src/api/users.test.ts` for the canonical example. Where a function makes **two**
  separate `supabase.from(...)` calls, mock `supabase.from` with
  `mockImplementation((table) => ...)` switching on the table name, not a single
  `mockReturnValue`.
- Use the Node version pinned by `mobile/.nvmrc` (`24.13.0`) for any `npm`/`npx expo` command.
- Local Supabase must be running (`cd "/Users/giovanni/Desktop/app calcio" && npx supabase status`
  to check) for every backend task's `psql`/pgTAP steps — apply each new migration by piping it
  into the running `supabase_db_backend-foundation` container (the pattern already used
  throughout this project's session history), not via `supabase db push` (no linked remote
  project).

---

### Task 1: Fix `match_messages` RLS — the creator can access their own match's chat

The creator of a match never gets a row in `match_participants` for their own match (confirmed:
no code anywhere inserts one). The existing `match_messages` policies only check
`match_participants.status`, so today the creator is locked out of their own match's chat — a
real bug, not a design choice (the equivalent `match_participants` policies already special-case
the creator; these two were written in the same original migration without that clause). This
task fixes it, and corrects an existing pgTAP test that currently codifies the bug as expected
behavior.

**Files:**
- Create: `supabase/migrations/20260904000000_fix_match_messages_creator_access.sql`
- Modify: `supabase/tests/007_match_messages.test.sql`

**Interfaces:**
- Consumes: `public.matches`, `public.match_participants` (existing tables).
- Produces: updated `match_messages_select_participants` / `match_messages_insert_participants`
  RLS policies — every later task's manual/automated chat access as the creator depends on this.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260904000000_fix_match_messages_creator_access.sql`:

```sql
-- supabase/migrations/20260904000000_fix_match_messages_creator_access.sql
-- The creator of a match never has a row in match_participants for their own
-- match, so the original policies (which only check match_participants.status)
-- locked them out of their own match's chat. The equivalent policies on
-- match_participants itself already special-case the creator; these two did
-- not, which was an oversight in the original migration, not a design choice.
drop policy "match_messages_select_participants" on public.match_messages;
drop policy "match_messages_insert_participants" on public.match_messages;

create policy "match_messages_select_participants" on public.match_messages
  for select to authenticated using (
    exists (
      select 1 from public.match_participants mp
      where mp.match_id = match_messages.match_id
        and mp.user_id = auth.uid()
        and mp.status in ('approved','active','completed')
    )
    or auth.uid() = (select creator_id from public.matches where id = match_messages.match_id)
  );

create policy "match_messages_insert_participants" on public.match_messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and (
      exists (
        select 1 from public.match_participants mp
        where mp.match_id = match_messages.match_id
          and mp.user_id = auth.uid()
          and mp.status in ('approved','active','completed')
      )
      or auth.uid() = (select creator_id from public.matches where id = match_messages.match_id)
    )
  );
```

- [ ] **Step 2: Apply the migration to the local database**

Run:
```bash
DOCKER="/Applications/Docker.app/Contents/Resources/bin/docker"
$DOCKER exec -i supabase_db_backend-foundation psql -U postgres -d postgres < "supabase/migrations/20260904000000_fix_match_messages_creator_access.sql"
```
Expected: `DROP POLICY` x2, `CREATE POLICY` x2, no errors.

- [ ] **Step 3: Fix the existing test that currently codifies the bug**

In `supabase/tests/007_match_messages.test.sql`, the assertion at (originally) lines 67-73 reads:

```sql
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.match_messages where match_id = '55555555-5555-5555-5555-555555555555'),
  0,
  'the creator cannot read the room chat before being an approved participant themselves'
);
```

Replace it with (the creator now *can* read, and can also *write*, without a participant row):

```sql
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.match_messages where match_id = '55555555-5555-5555-5555-555555555555'),
  1,
  'the creator can read the room chat even without an approved participant row for their own match'
);

insert into public.match_messages (match_id, sender_id, body)
values ('55555555-5555-5555-5555-555555555555','11111111-1111-1111-1111-111111111111','Ciao, sono il creatore');

select is(
  (select count(*)::int from public.match_messages where match_id = '55555555-5555-5555-5555-555555555555' and sender_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'the creator can also post in the room chat even without an approved participant row for their own match'
);
```

Update `select plan(6);` at the top of the file to `select plan(7);` (one new assertion added).

- [ ] **Step 4: Run the full test to verify it passes**

Run:
```bash
DOCKER="/Applications/Docker.app/Contents/Resources/bin/docker"
$DOCKER cp "supabase/tests/007_match_messages.test.sql" supabase_db_backend-foundation:/tmp/007_test.sql
$DOCKER exec supabase_db_backend-foundation psql -U postgres -d postgres -f /tmp/007_test.sql
```
Expected: `1..7`, all `ok`, `rollback` at the end — no `not ok` lines.

- [ ] **Step 5: Run the full pgTAP suite to confirm nothing else broke**

```bash
DOCKER="/Applications/Docker.app/Contents/Resources/bin/docker"
$DOCKER cp "supabase/tests" supabase_db_backend-foundation:/tmp/alltests
$DOCKER exec supabase_db_backend-foundation bash -c '
for f in /tmp/alltests/*.sql; do
  out=$(psql -U postgres -d postgres -f "$f" 2>&1)
  if echo "$out" | grep -qE "^(not ok|# Looks like)"; then
    echo "=== FAIL: $f ==="; echo "$out" | grep -E "^(not ok|# Looks like|#.*Failed)"
  fi
done
echo DONE'
```
Expected: only `DONE` printed, no `FAIL` blocks.

- [ ] **Step 6: Commit**

```bash
cd "/Users/giovanni/Desktop/app calcio"
git add supabase/migrations/20260904000000_fix_match_messages_creator_access.sql supabase/tests/007_match_messages.test.sql
git commit -m "fix: let a match's creator access their own match's chat"
```

---

### Task 2: `match_message_mentions` table, validation trigger, RLS

**Files:**
- Create: `supabase/migrations/20260904000100_create_match_message_mentions.sql`
- Create: `supabase/tests/018_match_message_mentions.test.sql`

**Interfaces:**
- Consumes: `public.match_messages`, `public.match_participants`, `public.matches` (existing).
- Produces: `public.match_message_mentions` table — consumed by Task 3's `send_match_message` RPC.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260904000100_create_match_message_mentions.sql`:

```sql
-- supabase/migrations/20260904000100_create_match_message_mentions.sql
create table public.match_message_mentions (
  message_id uuid not null references public.match_messages(id) on delete cascade,
  mentioned_user_id uuid not null references public.users(id) on delete cascade,
  primary key (message_id, mentioned_user_id)
);

alter table public.match_message_mentions enable row level security;
grant select, insert on public.match_message_mentions to authenticated;
revoke all on public.match_message_mentions from public, anon;

create policy "match_message_mentions_select_participants" on public.match_message_mentions
  for select to authenticated using (
    exists (
      select 1 from public.match_messages mm
      where mm.id = match_message_mentions.message_id
        and (
          exists (
            select 1 from public.match_participants mp
            where mp.match_id = mm.match_id and mp.user_id = auth.uid()
              and mp.status in ('approved','active','completed')
          )
          or auth.uid() = (select creator_id from public.matches where id = mm.match_id)
        )
    )
  );

create policy "match_message_mentions_insert_own_message" on public.match_message_mentions
  for insert to authenticated with check (
    mentioned_user_id <> auth.uid()
    and exists (
      select 1 from public.match_messages mm
      where mm.id = match_message_mentions.message_id and mm.sender_id = auth.uid()
    )
  );

-- Never trust the client to only send valid mention targets: reject any
-- mention of someone who isn't the match's creator or an approved/active
-- participant. Runs inside the same transaction as send_match_message's
-- insert (Task 3), so an invalid mention rolls back the whole send, not just
-- the bad mention row -- deliberate, see that migration's comment.
create or replace function public.enforce_valid_mention()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match_id uuid;
  v_creator_id uuid;
  v_is_valid boolean;
begin
  select match_id into v_match_id from public.match_messages where id = new.message_id;
  select creator_id into v_creator_id from public.matches where id = v_match_id;

  if new.mentioned_user_id = v_creator_id then
    v_is_valid := true;
  else
    select exists(
      select 1 from public.match_participants
      where match_id = v_match_id
        and user_id = new.mentioned_user_id
        and status in ('approved','active')
    ) into v_is_valid;
  end if;

  if not v_is_valid then
    raise exception 'cannot mention a user who is not the creator or an approved/active participant of this match';
  end if;

  return new;
end;
$$;

create trigger trg_enforce_valid_mention
  before insert on public.match_message_mentions
  for each row execute function public.enforce_valid_mention();
```

- [ ] **Step 2: Apply the migration**

```bash
DOCKER="/Applications/Docker.app/Contents/Resources/bin/docker"
$DOCKER exec -i supabase_db_backend-foundation psql -U postgres -d postgres < "supabase/migrations/20260904000100_create_match_message_mentions.sql"
```
Expected: `CREATE TABLE`, `CREATE POLICY` x2, `CREATE FUNCTION`, `CREATE TRIGGER`, no errors.

- [ ] **Step 3: Write the failing pgTAP test**

Create `supabase/tests/018_match_message_mentions.test.sql`:

```sql
-- supabase/tests/018_match_message_mentions.test.sql
begin;
select plan(4);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','creator@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','approved@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333','stranger@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('33333333-3333-3333-3333-333333333333','+390000000003','Gino','Verdi','1992-01-01',170,'both','player');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('55555555-5555-5555-5555-555555555555','11111111-1111-1111-1111-111111111111',5,'Campo Palermo','Via Roma 1',38.1157,13.3615,'2026-09-05','20:00','21:30',10);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
insert into public.match_participants (id, match_id, user_id, status)
values ('66666666-6666-6666-6666-666666666666','55555555-5555-5555-5555-555555555555','22222222-2222-2222-2222-222222222222','requested');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'approved' where id = '66666666-6666-6666-6666-666666666666';

insert into public.match_messages (id, match_id, sender_id, body)
values ('99999999-9999-9999-9999-999999999999','55555555-5555-5555-5555-555555555555','11111111-1111-1111-1111-111111111111','Ciao Luca');

insert into public.match_message_mentions (message_id, mentioned_user_id)
values ('99999999-9999-9999-9999-999999999999','22222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.match_message_mentions where message_id = '99999999-9999-9999-9999-999999999999'),
  1,
  'the creator can mention an approved participant in their own message'
);

select throws_ok(
  $$ insert into public.match_message_mentions (message_id, mentioned_user_id)
     values ('99999999-9999-9999-9999-999999999999','33333333-3333-3333-3333-333333333333') $$,
  'cannot mention a user who is not the creator or an approved/active participant of this match',
  'mentioning a user who is not the creator or an approved/active participant is rejected'
);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
insert into public.match_messages (id, match_id, sender_id, body)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','55555555-5555-5555-5555-555555555555','22222222-2222-2222-2222-222222222222','Ciao Mario');

select throws_ok(
  $$ insert into public.match_message_mentions (message_id, mentioned_user_id)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222') $$,
  null,
  'a user cannot mention themselves'
);

select throws_ok(
  $$ insert into public.match_message_mentions (message_id, mentioned_user_id)
     values ('99999999-9999-9999-9999-999999999999','11111111-1111-1111-1111-111111111111') $$,
  null,
  'a user cannot insert a mention row for a message they did not send'
);

select * from finish();
rollback;
```

- [ ] **Step 4: Run the test**

```bash
DOCKER="/Applications/Docker.app/Contents/Resources/bin/docker"
$DOCKER cp "supabase/tests/018_match_message_mentions.test.sql" supabase_db_backend-foundation:/tmp/018_test.sql
$DOCKER exec supabase_db_backend-foundation psql -U postgres -d postgres -f /tmp/018_test.sql
```
Expected: `1..4`, all `ok`.

- [ ] **Step 5: Commit**

```bash
cd "/Users/giovanni/Desktop/app calcio"
git add supabase/migrations/20260904000100_create_match_message_mentions.sql supabase/tests/018_match_message_mentions.test.sql
git commit -m "feat: add match_message_mentions table with backend-enforced validation"
```

---

### Task 3: `send_match_message` RPC — replaces the old notify-on-insert trigger

The existing `trg_notify_on_match_message` (`AFTER INSERT ON match_messages`) fires immediately
after the message row is inserted — too early to see mention rows, which must reference the
message's own id and therefore can only be inserted afterward. This task replaces that trigger
with a single RPC that inserts the message, inserts its mentions, then generates notifications
for everyone with full knowledge of who was mentioned.

**Files:**
- Create: `supabase/migrations/20260904000200_create_send_match_message_function.sql`
- Create: `supabase/tests/019_send_match_message.test.sql`
- Modify: `supabase/tests/007_match_messages.test.sql` (removes two assertions that depended on
  the trigger this task drops — see Step 3)

**Interfaces:**
- Consumes: `public.match_messages`, `public.match_message_mentions` (Task 2), `public.matches`,
  `public.match_participants`, `public.notifications` (existing).
- Produces: `public.send_match_message(p_match_id uuid, p_body text, p_mentions uuid[])
  returns public.match_messages` — consumed by Task 4's `sendMatchMessage`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260904000200_create_send_match_message_function.sql`:

```sql
-- supabase/migrations/20260904000200_create_send_match_message_function.sql
drop trigger if exists trg_notify_on_match_message on public.match_messages;
drop function if exists public.notify_on_match_message();

-- security invoker (the default, spelled out for clarity): this function
-- relies entirely on the caller's own RLS grants for both inserts it
-- performs (into match_messages and match_message_mentions) -- it is not a
-- privilege-escalation path, a caller who couldn't do these inserts
-- directly can't do them through this function either.
create or replace function public.send_match_message(
  p_match_id uuid,
  p_body text,
  p_mentions uuid[] default '{}'
)
returns public.match_messages
language plpgsql
security invoker
as $$
declare
  v_message public.match_messages;
  v_mentioned_id uuid;
  v_field_name text;
  v_recipient record;
begin
  insert into public.match_messages (match_id, sender_id, body)
  values (p_match_id, auth.uid(), p_body)
  returning * into v_message;

  foreach v_mentioned_id in array p_mentions loop
    insert into public.match_message_mentions (message_id, mentioned_user_id)
    values (v_message.id, v_mentioned_id);
  end loop;

  select field_name into v_field_name from public.matches where id = p_match_id;

  for v_recipient in
    select user_id from public.match_participants
    where match_id = p_match_id and status in ('approved','active') and user_id <> auth.uid()
    union
    select creator_id from public.matches where id = p_match_id and creator_id <> auth.uid()
  loop
    insert into public.notifications (user_id, type, payload)
    values (
      v_recipient.user_id,
      case when v_recipient.user_id = any(p_mentions) then 'match_message_mention' else 'match_message' end,
      jsonb_build_object(
        'message',
        case when v_recipient.user_id = any(p_mentions)
          then 'Sei stato menzionato in ' || v_field_name
          else 'Nuovo messaggio nella stanza di ' || v_field_name
        end,
        'match_id', p_match_id
      )
    );
  end loop;

  return v_message;
end;
$$;

grant execute on function public.send_match_message(uuid, text, uuid[]) to authenticated;
revoke execute on function public.send_match_message(uuid, text, uuid[]) from public, anon;
```

- [ ] **Step 2: Apply the migration**

```bash
DOCKER="/Applications/Docker.app/Contents/Resources/bin/docker"
$DOCKER exec -i supabase_db_backend-foundation psql -U postgres -d postgres < "supabase/migrations/20260904000200_create_send_match_message_function.sql"
```
Expected: `DROP TRIGGER`, `DROP FUNCTION`, `CREATE FUNCTION`, `GRANT`, `REVOKE`, no errors.

- [ ] **Step 3: Fix two now-broken assertions in `007_match_messages.test.sql`**

That file's remaining assertions (the ones Task 1 didn't already touch) insert directly into
`match_messages` with a plain `insert` to test notification fan-out — that only worked because
the old `trg_notify_on_match_message` trigger, just dropped in Step 2, fired on any insert.
Notifications are now only generated by the `send_match_message` RPC, so these two assertions
would either fail outright or silently pass for the wrong reason (no notification ever being
created, for anyone). Remove them — notification behavior for chat messages is now covered by
`019_send_match_message.test.sql` (this task's own new test file, Step 5 below), so this isn't a
coverage loss, just moving the assertion to the file that exercises the real code path.

In `supabase/tests/007_match_messages.test.sql`, delete these two blocks (currently the last two
assertions before `select * from finish();`):

```sql
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
```

Update `select plan(7);` (set by Task 1) at the top of the file to `select plan(5);` (two
assertions removed).

- [ ] **Step 4: Re-run `007_match_messages.test.sql` to confirm it's still green**

```bash
DOCKER="/Applications/Docker.app/Contents/Resources/bin/docker"
$DOCKER cp "supabase/tests/007_match_messages.test.sql" supabase_db_backend-foundation:/tmp/007_test.sql
$DOCKER exec supabase_db_backend-foundation psql -U postgres -d postgres -f /tmp/007_test.sql
```
Expected: `1..5`, all `ok`.

- [ ] **Step 5: Write the failing pgTAP test for the new RPC**

Create `supabase/tests/019_send_match_message.test.sql`:

```sql
-- supabase/tests/019_send_match_message.test.sql
begin;
select plan(6);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','creator@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('11111111-1111-1111-1111-111111111111','+390000000001','Mario','Rossi','1990-01-01',180,'right','player');

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','approved-a@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('22222222-2222-2222-2222-222222222222','+390000000002','Luca','Bianchi','1991-01-01',175,'left','goalkeeper');

insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333','approved-b@example.com');
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('33333333-3333-3333-3333-333333333333','+390000000003','Gino','Verdi','1992-01-01',170,'both','player');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players)
values ('55555555-5555-5555-5555-555555555555','11111111-1111-1111-1111-111111111111',5,'Campo Palermo','Via Roma 1',38.1157,13.3615,'2026-09-05','20:00','21:30',10);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
insert into public.match_participants (id, match_id, user_id, status)
values ('aaaaaaaa-1111-1111-1111-111111111111','55555555-5555-5555-5555-555555555555','22222222-2222-2222-2222-222222222222','requested');

select tests.authenticate_as('33333333-3333-3333-3333-333333333333');
insert into public.match_participants (id, match_id, user_id, status)
values ('bbbbbbbb-2222-2222-2222-222222222222','55555555-5555-5555-5555-555555555555','33333333-3333-3333-3333-333333333333','requested');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.match_participants set status = 'approved' where match_id = '55555555-5555-5555-5555-555555555555';

-- Creator sends a plain message (no mentions) -- both approved participants
-- should get the generic notification.
select send_match_message('55555555-5555-5555-5555-555555555555', 'Ciao a tutti', '{}');

select is(
  (select count(*)::int from public.match_messages where match_id = '55555555-5555-5555-5555-555555555555'),
  1,
  'send_match_message inserts the message row'
);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
select is(
  (select type from public.notifications where user_id = '22222222-2222-2222-2222-222222222222' order by created_at desc limit 1),
  'match_message',
  'a non-mentioned approved participant gets the generic match_message notification'
);

-- Now the creator sends a message mentioning only Luca.
select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
select send_match_message('55555555-5555-5555-5555-555555555555', 'Ciao @Luca', array['22222222-2222-2222-2222-222222222222']::uuid[]);

select is(
  (select count(*)::int from public.match_message_mentions mm join public.match_messages m on m.id = mm.message_id where m.body = 'Ciao @Luca'),
  1,
  'send_match_message records the mention row'
);

select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
select is(
  (select type from public.notifications where user_id = '22222222-2222-2222-2222-222222222222' order by created_at desc limit 1),
  'match_message_mention',
  'the mentioned participant gets the dedicated match_message_mention notification'
);

select tests.authenticate_as('33333333-3333-3333-3333-333333333333');
select is(
  (select type from public.notifications where user_id = '33333333-3333-3333-3333-333333333333' order by created_at desc limit 1),
  'match_message',
  'a participant who was not mentioned still gets the generic notification for the same message'
);

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
select throws_ok(
  $$ select send_match_message('55555555-5555-5555-5555-555555555555', 'bad mention', array['99999999-9999-9999-9999-999999999999']::uuid[]) $$,
  'cannot mention a user who is not the creator or an approved/active participant of this match',
  'sending a message with an invalid mention rolls back the whole send'
);

select * from finish();
rollback;
```

- [ ] **Step 6: Run the test**

```bash
DOCKER="/Applications/Docker.app/Contents/Resources/bin/docker"
$DOCKER cp "supabase/tests/019_send_match_message.test.sql" supabase_db_backend-foundation:/tmp/019_test.sql
$DOCKER exec supabase_db_backend-foundation psql -U postgres -d postgres -f /tmp/019_test.sql
```
Expected: `1..6`, all `ok`.

- [ ] **Step 7: Run the full pgTAP suite**

```bash
DOCKER="/Applications/Docker.app/Contents/Resources/bin/docker"
$DOCKER cp "supabase/tests" supabase_db_backend-foundation:/tmp/alltests
$DOCKER exec supabase_db_backend-foundation bash -c '
for f in /tmp/alltests/*.sql; do
  out=$(psql -U postgres -d postgres -f "$f" 2>&1)
  if echo "$out" | grep -qE "^(not ok|# Looks like)"; then
    echo "=== FAIL: $f ==="; echo "$out" | grep -E "^(not ok|# Looks like|#.*Failed)"
  fi
done
echo DONE'
```
Expected: only `DONE`, no `FAIL` blocks.

- [ ] **Step 8: Commit**

```bash
cd "/Users/giovanni/Desktop/app calcio"
git add supabase/migrations/20260904000200_create_send_match_message_function.sql supabase/tests/019_send_match_message.test.sql supabase/tests/007_match_messages.test.sql
git commit -m "feat: add send_match_message RPC, replacing the old notify-on-insert trigger"
```

---

### Task 4: `src/api/matchMessages.ts` — chat data layer

**Files:**
- Create: `mobile/src/api/matchMessages.ts`
- Create: `mobile/src/api/matchMessages.test.ts`

**Interfaces:**
- Consumes: `supabase` (`src/api/supabase.ts`).
- Produces: `ChatMessage`, `SenderProfile`, `ChatMessageWithSender`, `ChatParticipant` types;
  `fetchMatchMessages`, `fetchChatParticipants`, `sendMatchMessage` functions — consumed by
  Task 5 (`useMatchChat`).

- [ ] **Step 1: Write the failing tests**

Create `mobile/src/api/matchMessages.test.ts`:

```ts
// mobile/src/api/matchMessages.test.ts
import { supabase } from './supabase';
import { fetchMatchMessages, fetchChatParticipants, sendMatchMessage } from './matchMessages';

jest.mock('./supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

describe('matchMessages api', () => {
  afterEach(() => jest.clearAllMocks());

  describe('fetchMatchMessages', () => {
    it('fetches the last N messages newest-first and merges sender profiles', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'match_messages') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                order: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue({
                    data: [
                      { id: 'm2', match_id: 'match1', sender_id: 'u2', body: 'seconda', created_at: '2026-09-04T10:01:00Z' },
                      { id: 'm1', match_id: 'match1', sender_id: 'u1', body: 'prima', created_at: '2026-09-04T10:00:00Z' },
                    ],
                    error: null,
                  }),
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
                  { id: 'u1', first_name: 'Mario', last_name: 'Rossi', profile_image_url: null },
                  { id: 'u2', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null },
                ],
                error: null,
              }),
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      });

      const result = await fetchMatchMessages('match1');

      expect(result).toEqual([
        { id: 'm2', match_id: 'match1', sender_id: 'u2', body: 'seconda', created_at: '2026-09-04T10:01:00Z', sender: { first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null } },
        { id: 'm1', match_id: 'match1', sender_id: 'u1', body: 'prima', created_at: '2026-09-04T10:00:00Z', sender: { first_name: 'Mario', last_name: 'Rossi', profile_image_url: null } },
      ]);
    });

    it('returns an empty array without querying profiles when there are no messages', async () => {
      const limit = jest.fn().mockResolvedValue({ data: [], error: null });
      const order = jest.fn().mockReturnValue({ limit });
      const eq = jest.fn().mockReturnValue({ order });
      const fromMock = jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ eq }) });
      (supabase.from as jest.Mock).mockImplementation(fromMock);

      const result = await fetchMatchMessages('match1');

      expect(result).toEqual([]);
      expect(fromMock).toHaveBeenCalledTimes(1);
    });

    it('throws the Supabase error message when the messages query fails', async () => {
      const limit = jest.fn().mockResolvedValue({ data: null, error: { message: 'messages failed' } });
      const order = jest.fn().mockReturnValue({ limit });
      const eq = jest.fn().mockReturnValue({ order });
      (supabase.from as jest.Mock).mockReturnValue({ select: jest.fn().mockReturnValue({ eq }) });

      await expect(fetchMatchMessages('match1')).rejects.toThrow('messages failed');
    });
  });

  describe('fetchChatParticipants', () => {
    it('combines the creator and approved/active participants into one list', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'matches') {
          return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { creator_id: 'u1' }, error: null }) }) }) };
        }
        if (table === 'match_participants') {
          return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ in: jest.fn().mockResolvedValue({ data: [{ user_id: 'u2' }], error: null }) }) }) };
        }
        if (table === 'user_public_profiles') {
          return {
            select: jest.fn().mockReturnValue({
              in: jest.fn().mockResolvedValue({
                data: [
                  { id: 'u1', first_name: 'Mario', last_name: 'Rossi', profile_image_url: null },
                  { id: 'u2', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null },
                ],
                error: null,
              }),
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      });

      const result = await fetchChatParticipants('match1');

      expect(result).toEqual([
        { user_id: 'u1', first_name: 'Mario', last_name: 'Rossi', profile_image_url: null },
        { user_id: 'u2', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null },
      ]);
    });

    it('throws the Supabase error message when the match lookup fails', async () => {
      (supabase.from as jest.Mock).mockReturnValue({ select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: { message: 'match lookup failed' } }) }) }) });

      await expect(fetchChatParticipants('match1')).rejects.toThrow('match lookup failed');
    });
  });

  describe('sendMatchMessage', () => {
    it('calls the send_match_message RPC and returns the created message', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: { id: 'm3', match_id: 'match1', sender_id: 'u1', body: 'ciao', created_at: '2026-09-04T10:02:00Z' },
        error: null,
      });

      const result = await sendMatchMessage('match1', 'ciao', ['u2']);

      expect(supabase.rpc).toHaveBeenCalledWith('send_match_message', { p_match_id: 'match1', p_body: 'ciao', p_mentions: ['u2'] });
      expect(result).toEqual({ id: 'm3', match_id: 'match1', sender_id: 'u1', body: 'ciao', created_at: '2026-09-04T10:02:00Z' });
    });

    it('throws the Supabase error message on failure', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: { message: 'send failed' } });

      await expect(sendMatchMessage('match1', 'ciao', [])).rejects.toThrow('send failed');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile && npm test -- matchMessages.test.ts`
Expected: FAIL — `./matchMessages` does not exist yet.

- [ ] **Step 3: Implement `src/api/matchMessages.ts`**

```ts
// mobile/src/api/matchMessages.ts
import { supabase } from './supabase';

export interface ChatMessage {
  id: string;
  match_id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

export interface SenderProfile {
  first_name: string;
  last_name: string;
  profile_image_url: string | null;
}

export interface ChatMessageWithSender extends ChatMessage {
  sender: SenderProfile;
}

export interface ChatParticipant {
  user_id: string;
  first_name: string;
  last_name: string;
  profile_image_url: string | null;
}

// user_public_profiles is a VIEW with no PostgREST-discoverable FK from
// match_messages.sender_id, so this is two queries + a client-side merge,
// not a single embedded select (see this plan's Global Constraints).
// Newest-first (created_at descending): the chat screen renders this in an
// inverted FlatList, which expects index 0 to be the newest message.
export async function fetchMatchMessages(matchId: string, limit = 50): Promise<ChatMessageWithSender[]> {
  const { data: rows, error: messagesError } = await supabase
    .from('match_messages')
    .select('id, match_id, sender_id, body, created_at')
    .eq('match_id', matchId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (messagesError) throw new Error(messagesError.message);
  if (!rows || rows.length === 0) return [];

  const senderIds = Array.from(new Set(rows.map((r) => r.sender_id)));
  const { data: profiles, error: profilesError } = await supabase
    .from('user_public_profiles')
    .select('id, first_name, last_name, profile_image_url')
    .in('id', senderIds);
  if (profilesError) throw new Error(profilesError.message);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  return rows.map((row) => {
    const profile = profileById.get(row.sender_id);
    return {
      ...row,
      sender: {
        first_name: profile?.first_name ?? '???',
        last_name: profile?.last_name ?? '',
        profile_image_url: profile?.profile_image_url ?? null,
      },
    };
  });
}

// Everyone currently eligible to send in this match's chat: the creator (who
// never has a match_participants row for their own match) plus every
// approved/active participant. Used both to populate the "@" mention picker
// and to resolve a Realtime-arriving message's sender profile (the raw
// postgres_changes payload only carries sender_id, not their name/photo).
export async function fetchChatParticipants(matchId: string): Promise<ChatParticipant[]> {
  const { data: match, error: matchError } = await supabase
    .from('matches')
    .select('creator_id')
    .eq('id', matchId)
    .single();
  if (matchError) throw new Error(matchError.message);

  const { data: participantRows, error: participantsError } = await supabase
    .from('match_participants')
    .select('user_id')
    .eq('match_id', matchId)
    .in('status', ['approved', 'active']);
  if (participantsError) throw new Error(participantsError.message);

  const userIds = Array.from(new Set([match!.creator_id, ...(participantRows ?? []).map((p) => p.user_id)]));
  const { data: profiles, error: profilesError } = await supabase
    .from('user_public_profiles')
    .select('id, first_name, last_name, profile_image_url')
    .in('id', userIds);
  if (profilesError) throw new Error(profilesError.message);

  return (profiles ?? []).map((p) => ({
    user_id: p.id,
    first_name: p.first_name,
    last_name: p.last_name,
    profile_image_url: p.profile_image_url,
  }));
}

export async function sendMatchMessage(matchId: string, body: string, mentionedUserIds: string[]): Promise<ChatMessage> {
  const { data, error } = await supabase.rpc('send_match_message', {
    p_match_id: matchId,
    p_body: body,
    p_mentions: mentionedUserIds,
  });
  if (error) throw new Error(error.message);
  return data as ChatMessage;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile && npm test -- matchMessages.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Run full suite and typecheck**

Run: `cd mobile && npm test && npm run typecheck`
Expected: all passing, no type errors.

- [ ] **Step 6: Commit**

```bash
cd "/Users/giovanni/Desktop/app calcio"
git add mobile/src/api/matchMessages.ts mobile/src/api/matchMessages.test.ts
git commit -m "feat: add match chat data layer"
```

---

### Task 5: `useMatchChat` hook — fetch, Realtime subscription, optimistic send

**Files:**
- Create: `mobile/src/hooks/useMatchChat.ts`
- Create: `mobile/src/hooks/useMatchChat.test.ts`

**Interfaces:**
- Consumes: `fetchMatchMessages`, `fetchChatParticipants`, `sendMatchMessage`,
  `ChatMessageWithSender`, `ChatParticipant` (Task 4's `src/api/matchMessages.ts`), `supabase`
  (for `.channel`/`.removeChannel`), `useSessionStore` (existing).
- Produces: `useMatchChat(matchId: string): { messages: ChatMessageWithSender[]; participants:
  ChatParticipant[]; loading: boolean; error: string | null; sending: boolean; sendError: string |
  null; send: (body: string, mentionedUserIds: string[]) => Promise<boolean>; refresh: () =>
  Promise<void> }` — consumed by Task 7 (`match/[id]/chat.tsx`).

- [ ] **Step 1: Write the failing test**

Create `mobile/src/hooks/useMatchChat.test.ts`:

```ts
// mobile/src/hooks/useMatchChat.test.ts
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useMatchChat } from './useMatchChat';
import { fetchMatchMessages, fetchChatParticipants, sendMatchMessage } from '@/api/matchMessages';
import { supabase } from '@/api/supabase';
import { useSessionStore } from '@/stores/sessionStore';

jest.mock('@/api/matchMessages', () => ({
  fetchMatchMessages: jest.fn(),
  fetchChatParticipants: jest.fn(),
  sendMatchMessage: jest.fn(),
}));

jest.mock('@/api/supabase', () => ({
  supabase: { channel: jest.fn(), removeChannel: jest.fn() },
}));

const ownProfile = { id: 'u1', first_name: 'Mario', last_name: 'Rossi', profile_image_url: null };
const otherParticipant = { user_id: 'u2', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null };

function mockChannel() {
  const channel = { on: jest.fn().mockReturnThis(), subscribe: jest.fn().mockReturnThis() };
  (supabase.channel as jest.Mock).mockReturnValue(channel);
  return channel;
}

describe('useMatchChat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSessionStore.setState({ session: { user: { id: 'u1' } } as never, profile: ownProfile as never, status: 'signed-in' });
    (fetchMatchMessages as jest.Mock).mockResolvedValue([]);
    (fetchChatParticipants as jest.Mock).mockResolvedValue([otherParticipant]);
  });

  it('fetches messages and participants on mount, and subscribes to the match channel', async () => {
    mockChannel();
    const { result } = await renderHook(() => useMatchChat('m1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMatchMessages).toHaveBeenCalledWith('m1');
    expect(fetchChatParticipants).toHaveBeenCalledWith('m1');
    expect(supabase.channel).toHaveBeenCalledWith('match_messages:m1');
  });

  it('unsubscribes on unmount', async () => {
    const channel = mockChannel();
    const { result, unmount } = await renderHook(() => useMatchChat('m1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    unmount();

    expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
  });

  it('prepends a new message from another sender received over Realtime', async () => {
    const channel = mockChannel();
    const { result } = await renderHook(() => useMatchChat('m1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const onInsert = channel.on.mock.calls[0][2];
    act(() => {
      onInsert({ new: { id: 'm2', match_id: 'm1', sender_id: 'u2', body: 'ciao', created_at: '2026-09-04T10:00:00Z' } });
    });

    expect(result.current.messages).toEqual([
      { id: 'm2', match_id: 'm1', sender_id: 'u2', body: 'ciao', created_at: '2026-09-04T10:00:00Z', sender: { first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null } },
    ]);
  });

  it('ignores a Realtime event for a message the current user sent themselves', async () => {
    const channel = mockChannel();
    const { result } = await renderHook(() => useMatchChat('m1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const onInsert = channel.on.mock.calls[0][2];
    act(() => {
      onInsert({ new: { id: 'm3', match_id: 'm1', sender_id: 'u1', body: 'mio', created_at: '2026-09-04T10:00:00Z' } });
    });

    expect(result.current.messages).toEqual([]);
  });

  it('send prepends an optimistic message, then reconciles it with the RPC result', async () => {
    mockChannel();
    (sendMatchMessage as jest.Mock).mockResolvedValue({ id: 'm4', match_id: 'm1', sender_id: 'u1', body: 'ciao a tutti', created_at: '2026-09-04T10:05:00Z' });

    const { result } = await renderHook(() => useMatchChat('m1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.send('ciao a tutti', ['u2']);
    });

    expect(sendMatchMessage).toHaveBeenCalledWith('m1', 'ciao a tutti', ['u2']);
    expect(success).toBe(true);
    expect(result.current.messages).toEqual([
      { id: 'm4', match_id: 'm1', sender_id: 'u1', body: 'ciao a tutti', created_at: '2026-09-04T10:05:00Z', sender: { first_name: 'Mario', last_name: 'Rossi', profile_image_url: null } },
    ]);
  });

  it('send removes the optimistic message and sets sendError on failure', async () => {
    mockChannel();
    (sendMatchMessage as jest.Mock).mockRejectedValue(new Error('send failed'));

    const { result } = await renderHook(() => useMatchChat('m1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.send('ciao', []);
    });

    expect(success).toBe(false);
    expect(result.current.sendError).toBe('send failed');
    expect(result.current.messages).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- useMatchChat.test.ts`
Expected: FAIL — `./useMatchChat` does not exist yet.

- [ ] **Step 3: Implement the hook**

```ts
// mobile/src/hooks/useMatchChat.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchMatchMessages,
  fetchChatParticipants,
  sendMatchMessage,
  type ChatMessageWithSender,
  type ChatParticipant,
} from '@/api/matchMessages';
import { supabase } from '@/api/supabase';
import { useSessionStore } from '@/stores/sessionStore';

interface RealtimeInsertPayload {
  new: { id: string; match_id: string; sender_id: string; body: string; created_at: string };
}

export function useMatchChat(matchId: string) {
  const userId = useSessionStore((s) => s.session?.user.id);
  const ownProfile = useSessionStore((s) => s.profile);
  const [messages, setMessages] = useState<ChatMessageWithSender[]>([]);
  const [participants, setParticipants] = useState<ChatParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Read inside the Realtime callback without re-subscribing the channel
  // every time the participant list changes.
  const participantsRef = useRef(participants);
  participantsRef.current = participants;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [messageResult, participantResult] = await Promise.all([
        fetchMatchMessages(matchId),
        fetchChatParticipants(matchId),
      ]);
      setMessages(messageResult);
      setParticipants(participantResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile caricare la chat.');
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel(`match_messages:${matchId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'match_messages', filter: `match_id=eq.${matchId}` },
        (payload: RealtimeInsertPayload) => {
          // Our own messages are reconciled directly from send()'s RPC
          // return value -- rendering them again here would duplicate them.
          if (payload.new.sender_id === userId) return;
          const profile = participantsRef.current.find((p) => p.user_id === payload.new.sender_id);
          setMessages((prev) => [
            {
              ...payload.new,
              sender: {
                first_name: profile?.first_name ?? '???',
                last_name: profile?.last_name ?? '',
                profile_image_url: profile?.profile_image_url ?? null,
              },
            },
            ...prev,
          ]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId, userId]);

  async function send(body: string, mentionedUserIds: string[]): Promise<boolean> {
    if (!userId || !ownProfile) {
      setSendError('Devi essere autenticato per scrivere.');
      return false;
    }
    const tempId = `local-${Date.now()}`;
    const ownSender = {
      first_name: ownProfile.first_name,
      last_name: ownProfile.last_name,
      profile_image_url: ownProfile.profile_image_url,
    };
    setMessages((prev) => [
      { id: tempId, match_id: matchId, sender_id: userId, body, created_at: new Date().toISOString(), sender: ownSender },
      ...prev,
    ]);
    setSendError(null);
    setSending(true);
    try {
      const created = await sendMatchMessage(matchId, body, mentionedUserIds);
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...created, sender: ownSender } : m)));
      return true;
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setSendError(err instanceof Error ? err.message : 'Impossibile inviare il messaggio.');
      return false;
    } finally {
      setSending(false);
    }
  }

  return { messages, participants, loading, error, sending, sendError, send, refresh: load };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- useMatchChat.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Run full suite and typecheck, then commit**

```bash
cd "/Users/giovanni/Desktop/app calcio/mobile" && npm test && npm run typecheck
cd "/Users/giovanni/Desktop/app calcio"
git add mobile/src/hooks/useMatchChat.ts mobile/src/hooks/useMatchChat.test.ts
git commit -m "feat: add useMatchChat hook (fetch, Realtime subscription, optimistic send)"
```

---

### Task 6: Route restructure — `match/[id].tsx` becomes `match/[id]/index.tsx`, add the Chat button

Expo Router can't have both a `match/[id].tsx` file and a `match/[id]/` directory — the existing
detail screen must move into the folder before `chat.tsx` (Task 7) can live alongside it as a
sibling route. This task is a pure rename (see Global Constraints) plus one small addition: a
"Chat" button, visible to the creator and to any approved/active/completed participant.

**Files:**
- Create: `mobile/app/(tabs)/home/match/[id]/index.tsx` (moved from `match/[id].tsx`, plus the
  Chat button)
- Delete: `mobile/app/(tabs)/home/match/[id].tsx`

**Interfaces:**
- Consumes: everything the existing screen already consumes (`useMatchDetail`,
  `useMyParticipation`, `useMatchRoster`, `useSessionStore`, `MatchForm`, `ParticipantRow`) —
  unchanged.
- Produces: same screen at the same route (`/(tabs)/home/match/[id]`) — the four existing
  `router.push`/`router.replace` call sites elsewhere in the app need no changes. Adds a "Chat"
  button that navigates to `/(tabs)/home/match/[id]/chat` (Task 7).

- [ ] **Step 1: Create the new file with the existing content plus the Chat button**

Create `mobile/app/(tabs)/home/match/[id]/index.tsx` with the exact content of the current
`mobile/app/(tabs)/home/match/[id].tsx`, with two changes: update the header comment path, and
insert a "Chat" button right after the `{roster.error && ...}` line and before the
`{isCreator && (...)}` actions block:

```tsx
// mobile/app/(tabs)/home/match/[id]/index.tsx
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

  // Capacity is not enforced here: RLS means a non-participant viewer never
  // sees an accurate approvedParticipants count for this match (it's always
  // empty for them), so a real "match is full" check would need a new
  // backend RPC. Accepted as a known MVP limitation rather than shipping a
  // check that silently never fires for the one viewer it's meant to protect.
  const canRequest = match.status === 'open';
  const canAccessChat =
    isCreator || ['approved', 'active', 'completed'].includes(myParticipation.participation?.status ?? '');

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
      {roster.error && <Text style={styles.error}>{roster.error}</Text>}

      {canAccessChat && (
        <Pressable
          style={styles.chatButton}
          onPress={() => router.push({ pathname: '/(tabs)/home/match/[id]/chat', params: { id } })}
        >
          <Text style={styles.chatButtonText}>💬 Chat</Text>
        </Pressable>
      )}

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
          {!myParticipation.loading && !myParticipation.participation && canRequest && (
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
              {myParticipation.participation.leave_count < 2 && canRequest && (
                <Pressable style={styles.requestButton} disabled={myParticipation.actionLoading} onPress={() => myParticipation.requestAgain()}>
                  {myParticipation.actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.requestButtonText}>Richiedi di nuovo</Text>}
                </Pressable>
              )}
            </View>
          )}
          {myParticipation.participation?.status === 'completed' && (
            <Text style={styles.statusText}>Questa partita è terminata</Text>
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
  meta: { color: '#444', fontSize: 15 },
  description: { color: '#444', fontSize: 15, marginTop: 4 },
  error: { color: '#c0392b' },
  chatButton: { backgroundColor: '#1a7f37', borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  chatButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  editButton: { flex: 1, backgroundColor: '#1a7f37', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  editButtonText: { color: '#fff', fontWeight: '600' },
  deleteButton: { flex: 1, backgroundColor: '#c0392b', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  deleteButtonText: { color: '#fff', fontWeight: '600' },
  section: { marginTop: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  requestActions: { flexDirection: 'row', gap: 8 },
  approveButton: { backgroundColor: '#1a7f37', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 12 },
  approveButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  rejectButton: { backgroundColor: '#c0392b', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 12 },
  rejectButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  requestButton: { backgroundColor: '#1a7f37', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  requestButtonText: { color: '#fff', fontWeight: '600' },
  leaveButton: { backgroundColor: '#c0392b', borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  leaveButtonText: { color: '#fff', fontWeight: '600' },
  statusText: { color: '#444', fontSize: 15 },
  statusTextSuccess: { color: '#1a7f37', fontSize: 16, fontWeight: '600' },
});
```

> **Note for the implementer:** the `styles` object above is reproduced in full from the current
> `match/[id].tsx` with only `chatButton`/`chatButtonText` added — if the actual file on disk has
> diverged from what's shown here (check `git log` for that file first), preserve whatever is
> currently there and only add the two new style keys and the `chatButton` JSX block in the
> matching place.

- [ ] **Step 2: Delete the old file**

```bash
rm "mobile/app/(tabs)/home/match/[id].tsx"
```

- [ ] **Step 3: Typecheck to confirm the route rename didn't break any call site**

Run: `cd mobile && npm run typecheck`
Expected: no errors — this proves all four existing `router.push`/`router.replace` calls using
`'/(tabs)/home/match/[id]'` still resolve correctly against the new file location (see Global
Constraints).

- [ ] **Step 4: Run the full test suite**

Run: `cd mobile && npm test`
Expected: all passing (no test imports this screen file directly — see Global Constraints on
screen-level tests — so this step is confirming nothing else regressed).

- [ ] **Step 5: Commit**

```bash
cd "/Users/giovanni/Desktop/app calcio"
git add "mobile/app/(tabs)/home/match/[id]"
git rm "mobile/app/(tabs)/home/match/[id].tsx"
git commit -m "refactor: move match detail into match/[id]/index.tsx, add Chat button"
```

---

### Task 7: Chat screen — `match/[id]/chat.tsx`

**Files:**
- Create: `mobile/app/(tabs)/home/match/[id]/chat.tsx`

**Interfaces:**
- Consumes: `useMatchChat` (Task 5), `useSessionStore` (existing).
- Produces: the route `/(tabs)/home/match/[id]/chat` — consumed by Task 6's Chat button and
  Task 8's notification navigation.

- [ ] **Step 1: Implement the screen**

Create `mobile/app/(tabs)/home/match/[id]/chat.tsx`:

```tsx
// mobile/app/(tabs)/home/match/[id]/chat.tsx
import { useState } from 'react';
import { View, Text, FlatList, TextInput, Pressable, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMatchChat } from '@/hooks/useMatchChat';
import { useSessionStore } from '@/stores/sessionStore';
import type { ChatMessageWithSender, ChatParticipant } from '@/api/matchMessages';

export default function MatchChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = useSessionStore((s) => s.session?.user.id);
  const chat = useMatchChat(id);
  const [inputText, setInputText] = useState('');
  const [mentionedIds, setMentionedIds] = useState<string[]>([]);

  // Only detects "@partial" at the very end of the current text -- typing an
  // "@" earlier in the message and continuing past it won't reopen the
  // picker. A reasonable MVP simplification, not a hidden bug: the picker is
  // only ever meant to help compose the mention you're actively typing.
  const mentionMatch = /@(\S*)$/.exec(inputText);
  const mentionQuery = mentionMatch?.[1]?.toLowerCase() ?? null;
  const mentionCandidates: ChatParticipant[] =
    mentionQuery === null
      ? []
      : chat.participants.filter(
          (p) => p.user_id !== userId && `${p.first_name} ${p.last_name}`.toLowerCase().includes(mentionQuery)
        );

  function selectMention(participant: ChatParticipant) {
    const fullName = `${participant.first_name} ${participant.last_name}`;
    setInputText((prev) => prev.replace(/@(\S*)$/, `@${fullName} `));
    // Deliberately not tracked further: if the "@Name " text is later
    // deleted by hand, this id stays queued and the person still gets
    // notified even though the visible mention is gone. Accepted MVP
    // limitation -- see the design spec's risks section.
    setMentionedIds((prev) => (prev.includes(participant.user_id) ? prev : [...prev, participant.user_id]));
  }

  async function handleSend() {
    const body = inputText.trim();
    if (!body) return;
    const success = await chat.send(body, mentionedIds);
    if (success) {
      setInputText('');
      setMentionedIds([]);
    }
  }

  if (chat.loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top}
    >
      <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.backLink}>← Torna alla partita</Text>
        </Pressable>
        <Text style={styles.header}>Chat</Text>
        {chat.error && <Text style={styles.error}>{chat.error}</Text>}

        <FlatList
          data={chat.messages}
          inverted
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <MessageBubble message={item} isOwn={item.sender_id === userId} />}
          contentContainerStyle={styles.messageList}
          style={{ flex: 1 }}
        />

        {mentionCandidates.length > 0 && (
          <View style={styles.mentionList}>
            {mentionCandidates.map((p) => (
              <Pressable key={p.user_id} style={styles.mentionItem} onPress={() => selectMention(p)}>
                <Text style={styles.mentionItemText}>{p.first_name} {p.last_name}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {chat.sendError && <Text style={styles.error}>{chat.sendError}</Text>}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Scrivi un messaggio..."
            multiline
          />
          <Pressable style={styles.sendButton} disabled={chat.sending || !inputText.trim()} onPress={handleSend}>
            {chat.sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendButtonText}>Invia</Text>}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageBubble({ message, isOwn }: { message: ChatMessageWithSender; isOwn: boolean }) {
  return (
    <View style={[styles.bubbleRow, isOwn ? styles.bubbleRowOwn : styles.bubbleRowOther]}>
      <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
        {!isOwn && <Text style={styles.senderName}>{message.sender.first_name} {message.sender.last_name}</Text>}
        <Text style={isOwn ? styles.bubbleTextOwn : styles.bubbleTextOther}>{message.body}</Text>
        <Text style={styles.timestamp}>{new Date(message.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  backLink: { color: '#1a7f37', marginBottom: 8 },
  header: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  error: { color: '#c0392b', marginBottom: 8 },
  messageList: { paddingVertical: 8, gap: 8 },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowOwn: { justifyContent: 'flex-end' },
  bubbleRowOther: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleOwn: { backgroundColor: '#1a7f37' },
  bubbleOther: { backgroundColor: '#eee' },
  senderName: { fontSize: 12, fontWeight: '600', color: '#666', marginBottom: 2 },
  bubbleTextOwn: { color: '#fff', fontSize: 15 },
  bubbleTextOther: { color: '#222', fontSize: 15 },
  timestamp: { fontSize: 10, color: '#ccc', marginTop: 4, alignSelf: 'flex-end' },
  mentionList: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#eee', borderRadius: 8, marginBottom: 4, maxHeight: 160 },
  mentionItem: { paddingVertical: 8, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  mentionItemText: { fontSize: 15 },
  inputRow: { flexDirection: 'row', gap: 8, paddingVertical: 8, alignItems: 'flex-end' },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, maxHeight: 100 },
  sendButton: { backgroundColor: '#1a7f37', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, justifyContent: 'center' },
  sendButtonText: { color: '#fff', fontWeight: '600' },
});
```

- [ ] **Step 2: Typecheck**

Run: `cd mobile && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Run the full test suite**

Run: `cd mobile && npm test`
Expected: all passing (no dedicated test file for this screen — see Global Constraints).

- [ ] **Step 4: Commit**

```bash
cd "/Users/giovanni/Desktop/app calcio"
git add "mobile/app/(tabs)/home/match/[id]/chat.tsx"
git commit -m "feat: add match room chat screen"
```

---

### Task 8: Route chat notifications directly to the chat screen

**Files:**
- Modify: `mobile/app/(tabs)/home/notifications.tsx`

**Interfaces:**
- Consumes: `AppNotification` (existing, `src/api/notifications.ts`), the new
  `/(tabs)/home/match/[id]/chat` route (Task 7).
- Produces: updated notification tap behavior — no change to any other file.

- [ ] **Step 1: Modify `handlePress`**

In `mobile/app/(tabs)/home/notifications.tsx`, replace:

```tsx
  function handlePress(notification: AppNotification) {
    if (!notification.read_at) markRead(notification.id);
    if (notification.payload.match_id) {
      router.push({ pathname: '/(tabs)/home/match/[id]', params: { id: notification.payload.match_id } });
    }
  }
```

with:

```tsx
  function handlePress(notification: AppNotification) {
    if (!notification.read_at) markRead(notification.id);
    if (!notification.payload.match_id) return;
    const id = notification.payload.match_id;
    if (notification.type === 'match_message' || notification.type === 'match_message_mention') {
      router.push({ pathname: '/(tabs)/home/match/[id]/chat', params: { id } });
    } else {
      router.push({ pathname: '/(tabs)/home/match/[id]', params: { id } });
    }
  }
```

- [ ] **Step 2: Typecheck**

Run: `cd mobile && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd "/Users/giovanni/Desktop/app calcio"
git add mobile/app/\(tabs\)/home/notifications.tsx
git commit -m "feat: route chat notifications directly to the match chat screen"
```

---

### Task 9: Manual end-to-end verification in the simulator

**Files:** none (verification only).

- [ ] **Step 1: Confirm the environment**

Before starting, apply the standard readiness checklist from
`[[project-ios-simulator-devclient-freeze]]` in project memory: `export LANG=en_US.UTF-8
LC_ALL=en_US.UTF-8`, Metro on the **default port** (no `--port` flag, or `--port 8081` — never a
non-default port), `node_modules`/`ios` relocated out of `~/Desktop`'s iCloud sync if not already,
Docker clock drift checked (`docker exec <supabase-container> date` vs. host `date`, fix with
`docker run --rm --privileged alpine hwclock -s` if they've drifted).

- [ ] **Step 2: Two-user walkthrough**

Using the existing test users (Mario Rossi `+390000000101`, Luca Bianchi `+390000000102`,
password `TestPass123!`) and a match both have access to (Mario as creator, Luca as an approved
participant — reuse or recreate via direct SQL insert as done in prior sessions' verifications):

1. As Mario (creator, no `match_participants` row for this match): open the match detail, confirm
   the **Chat** button is visible, tap it, confirm the chat screen loads with no error — this is
   the direct proof of Task 1's RLS fix.
2. As Mario, send a plain message with no mention. Confirm it appears immediately (optimistic).
3. Switch to Luca: open the same match's chat. Confirm Mario's message is visible, and confirm a
   `match_message` notification exists for Luca (check the Notifiche screen, or query
   `public.notifications` directly).
4. As Luca, type `@` in the input, confirm the picker shows Mario as a candidate, select him, send
   the message. Confirm the mention text (`@Mario Rossi`) appears in the sent bubble.
5. Switch back to Mario, with the chat screen already open: confirm Luca's message appears
   **without a manual refresh** (this is the Realtime subscription working, not a cache/refetch
   artifact — the decisive test is that no navigation or pull-to-refresh happened between Luca's
   send and Mario's screen updating).
6. Check Mario's notifications: confirm a `match_message_mention` notification exists (not a plain
   `match_message`), and that tapping it navigates directly to the chat screen (Task 8), not the
   match detail screen.
7. Query the database directly to double-check what the UI showed:
   ```bash
   DOCKER="/Applications/Docker.app/Contents/Resources/bin/docker"
   $DOCKER exec supabase_db_backend-foundation psql -U postgres -d postgres -c "
   SELECT type, payload->>'message' AS message FROM public.notifications
   WHERE user_id = (SELECT id FROM public.users WHERE phone = '+390000000101')
   ORDER BY created_at DESC LIMIT 3;
   "
   ```
   Expected: the most recent row has `type = 'match_message_mention'`.

- [ ] **Step 3: Clean up test data**

Delete any match/messages created solely for this verification (matching the established
practice from prior sessions' manual verifications — leave no scratch data behind):
```bash
DOCKER="/Applications/Docker.app/Contents/Resources/bin/docker"
$DOCKER exec supabase_db_backend-foundation psql -U postgres -d postgres -c "
DELETE FROM public.matches WHERE field_name = '<the test match's field_name>';
"
```

- [ ] **Step 4: Update project memory**

Record in `project_app_calcio_state.md` (via the memory system) that the match-room-chat plan is
done and merged, following the same style as the match-participation and match-creation entries
already there — what was verified live vs. only by automated tests, and any new gotchas
encountered (if the intermittent stuck-tap automation issue recurs, note it as already documented
rather than re-describing it from scratch).
