# Messaggi (Private 1-to-1 Messaging) — Design Spec

## 1. Context and goal

The "Messaggi" tab (`mobile/app/(tabs)/messages/index.tsx`) is currently a bare
`<ScreenPlaceholder title="Messaggi" />`. The backend it needs already exists
in full from the `backend-foundation` plan — `private_conversations`,
`private_messages`, their RLS (block-gated inserts, participant-only reads),
an immutable-fields trigger, and a `notify_on_private_message` trigger — but
no mobile screen or API code uses any of it yet. This plan builds that
mobile slice: a conversation list, a 1-to-1 chat screen (reusing the
Realtime-chat pattern proven in the `match-room-chat` plan), and a
"Messaggio" button on the navigable other-user profile screen
(`people/user/[id].tsx`, deliberately left out of the just-merged `persone`
plan for exactly this reason).

This is the third feature in a row to follow the same pattern: backend
already built, mobile catches up.

## 2. Scope

**In scope:**
- A conversation list screen, each row showing the other participant, a
  last-message preview, a relative timestamp, and an unread indicator.
- A 1-to-1 chat screen: fetch history, Realtime-subscribe to new messages,
  optimistic send, mark-as-read on open.
- Finding or starting a conversation from a user's profile screen.
- Hiding a conversation (from the blocker's own view only) when either
  party blocks the other, and un-hiding it on unblock.
- Routing `private_message` notifications directly to the relevant chat.

**Out of scope:**
- A general user-facing "archive conversation" feature — hiding is driven
  only by block/unblock, not a standalone action, to avoid scope creep
  beyond what was asked.
- An aggregate unread-count badge on the Messaggi tab itself — each
  conversation row gets a visual (bold/highlighted) unread indicator only.
- Group conversations, message editing/deletion, attachments, typing
  indicators — none of these exist in the backend and none are requested.

## 3. Backend changes

One new migration,
`supabase/migrations/20260907000000_hide_conversation_on_block.sql`.

### 3.1 Hidden-for columns

```sql
alter table public.private_conversations
  add column hidden_for_a_at timestamptz,
  add column hidden_for_b_at timestamptz;
```

These are written only by the two triggers below — never directly by the
client (no grant, no RLS policy allows a client `update` on them). This is
deliberately narrower than a general-purpose "archive" feature: the only
way a conversation becomes hidden is through blocking, and the only way it
un-hides is through unblocking, matching exactly what was asked.

### 3.2 Hide on block, un-hide on unblock

```sql
create or replace function public.hide_conversation_on_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.private_conversations
  set hidden_for_a_at = case when user_a_id = new.blocker_id then now() else hidden_for_a_at end,
      hidden_for_b_at = case when user_b_id = new.blocker_id then now() else hidden_for_b_at end
  where (user_a_id = new.blocker_id and user_b_id = new.blocked_id)
     or (user_a_id = new.blocked_id and user_b_id = new.blocker_id);
  return new;
end;
$$;

create trigger trg_hide_conversation_on_block
  after insert on public.user_blocks
  for each row execute function public.hide_conversation_on_block();

create or replace function public.unhide_conversation_on_unblock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.private_conversations
  set hidden_for_a_at = case when user_a_id = old.blocker_id then null else hidden_for_a_at end,
      hidden_for_b_at = case when user_b_id = old.blocker_id then null else hidden_for_b_at end
  where (user_a_id = old.blocker_id and user_b_id = old.blocked_id)
     or (user_a_id = old.blocked_id and user_b_id = old.blocker_id);
  return old;
end;
$$;

create trigger trg_unhide_conversation_on_unblock
  after delete on public.user_blocks
  for each row execute function public.unhide_conversation_on_unblock();
```

Only the blocker's own side is ever hidden — mirroring the friends system's
"never reveal a block to the blocked party" principle: the blocked user's
own view of the conversation (if they still have it open) is unaffected,
and since a mutual block also prevents either side from sending new
messages (the pre-existing `private_messages_insert_participant_no_block`
policy checks the block in both directions), the conversation cannot "wake
back up" with new activity while blocked — it stays correctly hidden for
the blocker until they unblock, with no separate reconciliation needed.

**No RPC for finding/creating a conversation.** Unlike `search_user_by_code`
(needed because `user_public_profiles` has no RLS of its own),
`private_conversations` already has correct RLS — `insert` already checks
`(auth.uid() = user_a_id or auth.uid() = user_b_id) and not
users_have_mutual_block(...)`. A plain client-side "query for the pair,
insert if missing" is safe and consistent with this codebase's established
rule: introduce an RPC only where RLS genuinely cannot enforce something,
not as a blanket policy.

## 4. Mobile data layer

### 4.1 `mobile/src/api/privateMessages.ts`

Types:
```ts
export interface PrivateMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

export interface ConversationSummary {
  conversation_id: string;
  other_user: { user_id: string; first_name: string; last_name: string; profile_image_url: string | null };
  last_message: { body: string; created_at: string; sender_id: string } | null;
  unread: boolean;
}
```

Functions:
- `fetchConversations(userId: string): Promise<ConversationSummary[]>` —
  fetches every `private_conversations` row involving `userId` where the
  caller's own `hidden_for_<a|b>_at` is null, two-query-merges the other
  party's profile from `user_public_profiles`, then a second query for the
  most recent message per conversation (`private_messages` filtered by
  `conversation_id in (...)`, ordered `created_at desc` — reduced
  client-side to the first row per `conversation_id`, the same
  merge-in-JS approach `matchMessages.ts` already uses for its own
  cross-table joins), and computes `unread` as `true` if any fetched
  message for that conversation has `sender_id !== userId && read_at ===
  null` (a single extra query, `.eq('read_at', null).neq('sender_id',
  userId)`, existence-checked per conversation via the same id list).
- `findOrCreateConversation(userId: string, otherUserId: string):
  Promise<string>` — selects the existing pair (ordered-pair match via
  `.or(...)`, mirroring `fetchFriendshipStatus`'s own pattern), returns its
  id if found; otherwise inserts `{ user_a_id: userId, user_b_id:
  otherUserId }` and returns the new id. A safe race exists (two rapid
  taps could both miss the select and both attempt an insert) — the
  existing unique pair index turns the loser into a `23505`, which this
  function catches and re-selects to recover the winning row's id rather
  than surfacing an error for what is, from the user's perspective, a
  no-op.
- `fetchMessages(conversationId: string, limit = 50):
  Promise<PrivateMessage[]>` — newest-first, same shape/reasoning as
  `fetchMatchMessages` (no sender-profile merge needed here — the chat
  screen already knows both participants' identities from the
  conversation itself, unlike a multi-participant match room).
- `sendPrivateMessage(conversationId: string, senderId: string, body:
  string): Promise<PrivateMessage>` — plain insert returning the created
  row; no RPC needed (unlike `send_match_message`, there is no
  cross-user notification-writing left to do here — the pre-existing
  `notify_on_private_message` trigger already handles it entirely
  server-side).
- `markConversationRead(conversationId: string, userId: string):
  Promise<void>` — `update private_messages set read_at = now() where
  conversation_id = ? and sender_id <> ? and read_at is null`.

### 4.2 Hooks

- `usePrivateMessages(conversationId: string)` — mirrors `useMatchChat`
  almost exactly: fetch on mount, Realtime-subscribe to
  `postgres_changes` INSERT on `private_messages` filtered by
  `conversation_id=eq.<id>`, optimistic send reconciled from
  `sendPrivateMessage`'s own return value, own-message Realtime echo
  suppressed by `sender_id === userId` (the same proven pattern, no design
  changes needed) — plus calls `markConversationRead` once on mount.
  Returns `{ messages, loading, error, sending, sendError, send, refresh }`.
- `useConversations()` — loads the list on mount, exposes `refresh`.
  `{ conversations, loading, error, refresh }`.

## 5. Screens

### 5.1 `messages/index.tsx`

Replaces the placeholder. A `FlatList` of `useConversations()`'s
`conversations`, each row: other party's name, last message's body
(truncated) or "Nessun messaggio ancora." if `last_message` is null,
relative timestamp (reuse the existing `toLocaleString('it-IT')` /
`toLocaleTimeString` conventions from `notifications.tsx`/`chat.tsx`), bold
text when `unread`. Tap → `messages/[id]`. Empty state (no conversations at
all): "Nessun messaggio ancora."

### 5.2 `messages/[id].tsx`

Structurally identical to `match/[id]/chat.tsx` (inverted `FlatList`,
`KeyboardAvoidingView`, send box) minus the `@`-mention picker (not
applicable to a 1-to-1 chat) and minus per-message sender-name labels
(since there's only ever one other participant, redundant to repeat their
name on every bubble — shown once in the screen header instead, fetched
via a lightweight `user_public_profiles` lookup by the conversation's other
`user_id`, resolved from the route param plus `useSessionStore`). Calls
`markConversationRead` once on mount (and again each time the screen
regains focus, via `useFocusEffect`, so messages received while the user
was on a different tab get marked read on return).

### 5.3 `people/user/[id].tsx`

One addition: a "Messaggio" button, positioned between the existing
friendship action row and the Segnala/Blocca section, hidden exactly when
`status.kind === 'blocked_by_me'` (same condition already used to hide
Segnala/Blocca). `onPress`: calls `findOrCreateConversation`, then
`router.push` to `messages/[id]` with the returned conversation id.

## 6. Notifications

`mobile/app/(tabs)/home/notifications.tsx`'s `handlePress` gains one new
branch: `private_message` → `messages/[id]`, with `id` taken from
`payload.conversation_id` (already present in the existing
`notify_on_private_message` trigger's payload — no backend change needed
for this).

## 7. Testing

Same conventions as match-room-chat and persone: Jest for the API layer and
both hooks (Supabase client mocked, chainable per this codebase's
established style; the Realtime-channel mock pattern from
`useMatchChat.test.ts` reused as-is for `usePrivateMessages`), pgTAP for the
new migration (hide-on-block in both directions/both roles, unhide-on-
unblock, and confirming a mutual block still fully blocks new messages in
either direction — already covered by the pre-existing `010_private_
messaging.test.sql`, just re-confirmed here since it's directly relevant),
no screen-level automated tests, one live iOS Simulator walkthrough as the
final task (two test users: start a conversation from a profile, send a
message each way, confirm Realtime delivery and read-receipt marking,
confirm notification routing, block, confirm the conversation disappears
from the blocker's list, unblock, confirm it reappears).

## 8. Risks / open decisions

- `findOrCreateConversation`'s select-then-insert has a real (if narrow)
  race window; the plan above resolves it by catching `23505` and
  re-selecting rather than trying to make the whole operation atomic — an
  RPC could close this more tightly, but the race's only user-visible
  effect (worst case) is one extra round-trip, never a duplicate
  conversation (the unique index prevents that at the database level
  regardless of how many clients race), so the added RPC complexity isn't
  justified.
- `fetchConversations`'s "most recent message per conversation" step is a
  client-side reduction over a flat, unordered-by-conversation result set
  rather than a real "top-1-per-group" SQL query — acceptable at this
  codebase's current data volumes (mirrors how `matchMessages.ts` already
  avoids embedded selects for view-backed joins), but would need a real
  view or RPC if a user's conversation/message volume ever grows large
  enough to make this multi-query approach slow.
- Mirrors `persone`'s own documented, deliberately-accepted gap: nothing
  in this plan adds block-awareness to any DIRECT `user_public_profiles`
  read (e.g. the chat header's other-party lookup) — consistent with
  `persone`'s own final-review finding that this is a pre-existing,
  broader gap (the view has no RLS at all for any authenticated reader),
  not something this plan should attempt to close on its own.
