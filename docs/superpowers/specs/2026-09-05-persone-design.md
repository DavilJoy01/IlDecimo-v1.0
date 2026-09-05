# Persone (Friends & Profiles) — Design Spec

## 1. Context and goal

The "Persone" tab (`mobile/app/(tabs)/people/index.tsx`) is currently a bare
`<ScreenPlaceholder title="Persone" />`. The backend it needs already exists in
full from the `backend-foundation` plan — the `friendships` table (RLS,
state-machine trigger, notify-on-request trigger), `user_blocks`, `reports`,
and the `unique_user_id` ("FC-XXXXXX") code on every user — but no mobile
screen or API code uses any of it yet. This plan builds that mobile slice:
search a person by their code, send/accept/reject/cancel/remove friend
requests, a friends list, a navigable profile for any other user (mirroring
the existing own-profile screen), and Segnala/Blocca (report/block) actions
on that profile.

This follows the exact pattern the match-room-chat plan just followed:
backend already built, mobile catches up.

**Explicitly out of scope, deferred to separate follow-ups:**
- Editing your own profile ("Modifica profilo") — functionally unrelated to
  friendships, a small independent task.
- A "Messaggio" button on the navigable profile screen, and the private
  messaging feature itself (`private_conversations`/`private_messages`) —
  its own sub-project, immediately next after this one. Not adding a button
  to a route that doesn't exist yet avoids a dead link.
- Any admin/moderation UI for reviewing `reports` rows — the spec already
  states this is manual, via Supabase Studio.

## 2. Scope

**In scope:**
- Search for a user by their `FC-XXXXXX` code (server-side, block-aware).
- Send, cancel (withdraw), accept, reject, and remove (unfriend) a friend
  request/friendship.
- A friends list.
- A navigable profile screen for any other user, with a context-dependent
  action button and Segnala/Blocca actions.
- Notifications for: request received (already existed), request accepted,
  request rejected (both new).
- Blocking someone deletes any existing friendship between the two users.

**Out of scope:** see above.

## 3. Backend changes

One new migration,
`supabase/migrations/20260906000000_friend_response_notifications_and_search.sql`,
with three additions. All follow patterns already established elsewhere in
this codebase.

### 3.1 Friend-response notifications

Add `'friend_request_approved'` and `'friend_request_rejected'` to the
`notifications.type` check constraint (`alter table ... drop constraint
notifications_type_check; alter table ... add constraint ...` — the same
technique Task 3 of match-room-chat used to add
`match_message_mention`).

Add an `AFTER UPDATE ON public.friendships` trigger,
`notify_on_friend_response`, mirroring the shape of the existing
`notify_on_participant_change` trigger for match participation:

```sql
create or replace function public.notify_on_friend_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receiver_name text;
begin
  if old.status = 'pending' and new.status in ('accepted','rejected') then
    select first_name into v_receiver_name from public.users where id = new.receiver_id;

    insert into public.notifications (user_id, type, payload)
    values (
      new.requester_id,
      case when new.status = 'accepted' then 'friend_request_approved' else 'friend_request_rejected' end,
      jsonb_build_object(
        'message',
        case when new.status = 'accepted'
          then v_receiver_name || ' ha accettato la tua richiesta di amicizia'
          else v_receiver_name || ' ha rifiutato la tua richiesta di amicizia'
        end,
        'friendship_id', new.id,
        'user_id', new.receiver_id
      )
    );
  end if;
  return new;
end;
$$;

create trigger trg_notify_on_friend_response
  after update on public.friendships
  for each row execute function public.notify_on_friend_response();
```

The existing `enforce_friendship_transition` trigger (`BEFORE UPDATE`) already
guarantees `old.status = 'pending'` and `new.status in ('accepted','rejected')`
whenever an update is even allowed through — the `if` above is a defensive
restatement, not new validation logic, matching how the codebase's other
`AFTER` triggers don't re-derive invariants their sibling `BEFORE` trigger
already enforces, but this one is cheap and makes the trigger correct even if
someone ever removes the `BEFORE` trigger later.

The `payload.user_id` field (the receiver's id) is new relative to how other
notification payloads look — it exists so the mobile client can route a tap
on this notification straight to that user's profile (`user/[id].tsx`)
without an extra lookup through `friendship_id`.

### 3.2 Block deletes an existing friendship

```sql
create or replace function public.delete_friendship_on_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.friendships
  where least(requester_id, receiver_id) = least(new.blocker_id, new.blocked_id)
    and greatest(requester_id, receiver_id) = greatest(new.blocker_id, new.blocked_id);
  return new;
end;
$$;

create trigger trg_delete_friendship_on_block
  after insert on public.user_blocks
  for each row execute function public.delete_friendship_on_block();
```

Deletes the friendship row regardless of its status (`pending`, `accepted`,
or `rejected`) — blocking someone should clear any trace of a prior
relationship, not just accepted ones.

### 3.3 `search_user_by_code` RPC

`user_public_profiles` is a plain view (`security_invoker = false`) with a
`select` grant for `authenticated` but no RLS of its own — any authenticated
user querying it directly, including one filtering by `unique_user_id`,
would see blocked users too. That violates both this spec's own requirement
(a blocked user must not appear in search) and this codebase's stated
invariant that no business rule is ever trusted to the client. A single RPC
closes this the same way `send_match_message` closed a similar gap for chat:

```sql
create or replace function public.search_user_by_code(p_code text)
returns public.user_public_profiles
language sql
security definer
set search_path = ''
stable
as $$
  select p.*
  from public.user_public_profiles p
  where p.unique_user_id = p_code
    and p.id <> auth.uid()
    and not public.users_have_mutual_block(auth.uid(), p.id)
  limit 1;
$$;

grant execute on function public.search_user_by_code(text) to authenticated;
revoke execute on function public.search_user_by_code(text) from public, anon;
```

Returns zero rows (not an error) for: no such code, the caller's own code, or
a code belonging to someone with a mutual block against the caller — the
mobile layer treats all three identically ("nessun utente trovato"), so a
blocked user's existence is never distinguishable from a typo. Reuses the
existing `users_have_mutual_block()` helper (already used by `friendships`,
`match_invitations`, and `private_messages`' own insert policies).

Everything else this feature needs — send/cancel/accept/reject a friend
request, block, report — stays as direct `insert`/`update`/`delete` calls
against `friendships`/`user_blocks`/`reports` from the mobile client, relying
on the RLS policies that already exist. An RPC is introduced only here,
where server-side cross-cutting logic (the block check) is unavoidable —
consistent with how `send_match_message` was the one RPC match-room-chat
needed, not a blanket "everything goes through an RPC" policy.

## 4. Mobile data layer

### 4.1 `mobile/src/api/friendships.ts`

Types:
```ts
export interface FriendProfile {
  user_id: string;
  unique_user_id: string;
  first_name: string;
  last_name: string;
  profile_image_url: string | null;
}

export interface FriendRequest {
  id: string; // friendships.id
  user: FriendProfile; // the OTHER party (requester for incoming, receiver for outgoing)
  created_at: string;
}

export type FriendshipStatus =
  | { kind: 'none' }
  | { kind: 'pending_incoming'; friendshipId: string }
  | { kind: 'pending_outgoing'; friendshipId: string }
  | { kind: 'friends'; friendshipId: string }
  | { kind: 'blocked_by_me' };
```

Functions (one per query/RPC, matching this codebase's established
one-function-per-operation rule):
- `searchUserByCode(code: string): Promise<FriendProfile | null>` — wraps
  `search_user_by_code`; `null` on no match (never throws for "not found").
- `fetchFriends(userId: string): Promise<FriendProfile[]>` — accepted
  friendships involving `userId`, two-query-merge against
  `user_public_profiles` (the established pattern from `matchMessages.ts`/
  `participants.ts`, since `friendships` has no PostgREST-discoverable FK
  into the view).
- `fetchFriendRequests(userId: string): Promise<{ incoming: FriendRequest[];
  outgoing: FriendRequest[] }>` — pending friendships split by direction.
- `fetchFriendshipStatus(userId: string, otherUserId: string):
  Promise<FriendshipStatus>` — single lookup, used by `user/[id].tsx`; also
  checks `user_blocks` for `blocked_by_me` (RLS only lets you see blocks
  *you* made, matching the existing `user_blocks_select_own` policy, so
  "blocked by the other person" is indistinguishable from "not blocked" from
  the caller's own side — this is intentional, mirroring how
  `search_user_by_code` also can't reveal that).
- `sendFriendRequest(otherUserId: string): Promise<void>` — insert into
  `friendships` (no explicit `status`; the column's own default is
  `'pending'` — unlike `match_participants`, which uses `'requested'`).
- `respondToFriendRequest(friendshipId: string, accept: boolean):
  Promise<void>` — update `status` to `'accepted'`/`'rejected'`.
- `cancelFriendRequest(friendshipId: string): Promise<void>` — delete (you
  are the requester, still `pending`).
- `removeFriend(friendshipId: string): Promise<void>` — delete (status
  `accepted`).
- `blockUser(otherUserId: string): Promise<void>` — insert into
  `user_blocks`.
- `unblockUser(otherUserId: string): Promise<void>` — delete from
  `user_blocks` (`blocker_id = auth.uid()`).
- `reportUser(otherUserId: string, reason: string): Promise<void>` — insert
  into `reports` with `reported_user_id` set, `reported_match_id` null.

All error handling follows the established `if (error) throw new
Error(error.message)` convention; known backend-internal strings from
triggers (e.g. `enforce_friendship_transition`'s `'a friendship decision
cannot be changed once made'`, `'only the receiver can accept or reject a
friend request'`) get translated to Italian at this API boundary, same
pattern as `matchMessages.ts`'s `RPC_ERROR_TRANSLATIONS`.

One case has no specific trigger message to translate: if the *other* user
has blocked the caller (not the reverse), `fetchFriendshipStatus` can't see
that block (§4.1 above) and would report `none`, so `user/[id].tsx` still
offers "Invia richiesta". Submitting it then fails the
`friendships_insert_as_requester` RLS policy's `users_have_mutual_block`
check with Postgres's generic, unhelpful "new row violates row-level
security policy" text — never a custom message, since RLS `with check`
failures don't carry one. `sendFriendRequest` catches this by matching on
`error.code === '42501'` (the standard Postgres insufficient-privilege /
RLS-denial code) and translates it to a generic "Non è possibile inviare una
richiesta a questo utente." — deliberately as uninformative as the block
itself is meant to be; the caller must never learn a block is the reason.

### 4.2 Hooks

- `useFriends()` — loads the current user's friends list on mount, exposes
  `removeFriend(friendshipId)`, matches `useMyMatches`'s shape
  (`{ friends, loading, error, refresh }`).
- `useFriendRequests()` — loads incoming/outgoing pending requests, exposes
  `accept`, `reject`, `cancel`.
- `useUserProfile(userId: string)` — loads the target user's
  `user_public_profiles` row plus `fetchFriendshipStatus`, exposes
  `sendRequest`, `cancelRequest`, `respondToRequest`, `removeFriend`,
  `block`, `unblock`, `report` — one hook backing the whole `user/[id].tsx`
  screen, re-fetching status after any action so the button updates.
- `useUserSearch()` — holds `query`/`result`/`loading`/`error`/`notFound`
  state for `people/index.tsx`'s search box; search fires on submit, not on
  every keystroke (matching this codebase's existing preference for
  explicit actions over live-filtering, e.g. matches search).

## 5. Screens

### 5.1 `people/index.tsx`

Replaces the placeholder. Layout, top to bottom:
- Search box (`TextInput` + "Cerca" button) for an `FC-XXXXXX` code.
  Submitting calls `useUserSearch`. Result: one profile card (name, code,
  small "Vedi profilo" link into `user/[id].tsx`) or "Nessun utente
  trovato." if `null`.
- A link/badge into `friend-requests.tsx`, showing a count when there's at
  least one pending incoming request.
- "I tuoi amici" section: the friends list from `useFriends`, each row
  tappable into `user/[id].tsx`. Empty state: "Non hai ancora amici."

### 5.2 `people/friend-requests.tsx`

Two sections from `useFriendRequests()`:
- "Ricevute" — each row has Accetta/Rifiuta buttons.
- "Inviate" — each row has an Annulla button.
Both empty states get their own short Italian message.

### 5.3 `people/user/[id].tsx`

Mirrors `profile/index.tsx`'s stat display exactly (age computed from
`birth_date`, height, `FOOT_LABELS`, `ROLE_LABELS`, giocate/completate
counts) — the age/label helpers get extracted out of `profile/index.tsx`
into a shared location (e.g. `mobile/src/utils/profileDisplay.ts`) so both
screens use the identical logic rather than duplicating it.

Self-navigation guard: if the route's `id` param equals the signed-in user's
own id, `router.replace` back to `profile/index.tsx` immediately (no
navigable self-profile).

Action area, driven by `FriendshipStatus`:
| status | shown |
|---|---|
| `none` | "Invia richiesta" button |
| `pending_outgoing` | "Richiesta inviata" (disabled) + "Annulla" |
| `pending_incoming` | "Accetta" + "Rifiuta" |
| `friends` | "Amici ✓" + "Rimuovi amicizia" (confirm dialog, same `Alert.alert` pattern as match detail's leave/delete confirmations) |
| `blocked_by_me` | "Sblocca" only — Segnala/Blocca hidden (redundant once blocked) |

Below the action area (except when `blocked_by_me`): "Segnala" (opens a
small form: one multiline text input, 1-1000 chars, "Invia segnalazione"
button) and "Blocca" (confirm dialog, then `blockUser` — which also clears
any friendship per §3.2, so the screen re-fetches status afterward and shows
`blocked_by_me`).

## 6. Notifications

`mobile/app/(tabs)/home/notifications.tsx`'s `handlePress` gains two new
branches:
- `friend_request_received` → `people/friend-requests.tsx`.
- `friend_request_approved` / `friend_request_rejected` → `people/user/[id].tsx`
  with `id` taken from the new `payload.user_id` field (§3.1).

## 7. Testing

Same conventions as match-room-chat: Jest for the API layer and hooks
(Supabase client mocked per this codebase's established chainable-mock
style), pgTAP for the new migration (notification-on-response trigger,
block-deletes-friendship trigger, `search_user_by_code`'s block-exclusion
and self-exclusion behavior), no screen-level automated tests, one live
iOS Simulator walkthrough as the final task (two test users: search,
friend request, accept, notification, block, verify friendship gone and
search hidden).

## 8. Risks / open decisions

- `fetchFriendshipStatus`'s inability to distinguish "not blocked" from
  "blocked by the other person" is deliberate (matches what RLS actually
  lets the caller see) — flagging here so it isn't mistaken for a bug during
  review.
- `search_user_by_code`'s `security definer` follows the same shape as
  `send_match_message` and inherits the same review scrutiny that function
  got — its `where` clause is the entire security surface (self-exclusion,
  block-exclusion), so it should be traced by hand during implementation
  review the same way, not assumed correct from the SQL alone.
- Sending a friend request to someone who has blocked *you* (not the
  reverse) surfaces as a generic RLS-denial error the client can't
  distinguish from any other insert failure — see §4.1's error-code-42501
  handling. This is deliberate (never reveal a block to the blocked party),
  not a gap to close.
