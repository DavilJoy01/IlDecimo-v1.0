// mobile/src/api/friendships.ts
import { supabase } from './supabase';

export interface FriendProfile {
  user_id: string;
  unique_user_id: string;
  first_name: string;
  last_name: string;
  profile_image_url: string | null;
}

export interface FriendRequest {
  id: string;
  user: FriendProfile;
  created_at: string;
}

export type FriendshipStatus =
  | { kind: 'none' }
  | { kind: 'pending_incoming'; friendshipId: string }
  | { kind: 'pending_outgoing'; friendshipId: string }
  | { kind: 'friends'; friendshipId: string }
  | { kind: 'blocked_by_me' };

// Errors surfaced here are backend-internal English strings (from
// enforce_friendship_transition's raised exceptions, or a raw RLS-denial
// error), never shown verbatim in this all-Italian UI.
const RPC_ERROR_TRANSLATIONS: Record<string, string> = {
  'a friendship decision cannot be changed once made': 'Questa richiesta ha già ricevuto una risposta.',
  'only the receiver can accept or reject a friend request': 'Solo chi ha ricevuto la richiesta può accettarla o rifiutarla.',
};

function translateFriendshipError(message: string, code?: string): string {
  if (RPC_ERROR_TRANSLATIONS[message]) return RPC_ERROR_TRANSLATIONS[message];
  // 42501 = Postgres insufficient_privilege, the code an RLS `with check`
  // denial surfaces as -- covers the case where the OTHER user has blocked
  // the caller (invisible to the caller, so no specific message is safe to
  // show; see this plan's design spec, section 4.1's "Risks" note).
  if (code === '42501') return 'Non è possibile inviare una richiesta a questo utente.';
  // 23505 = Postgres unique_violation -- friendships_unique_pair_idx is
  // status-agnostic, so this can still fire as a defensive fallback (e.g. a
  // second rapid tap racing sendFriendRequest's own delete-then-insert
  // below) even though the normal path clears a stale rejected row first.
  if (code === '23505') return 'Esiste già una richiesta o un’amicizia con questo utente.';
  return message;
}

export async function searchUserByCode(code: string): Promise<FriendProfile | null> {
  const { data, error } = await supabase.rpc('search_user_by_code', { p_code: code });
  if (error) throw new Error(error.message);
  // search_user_by_code RETURNs a single row, not SETOF -- a "not found"
  // call never comes back as `data: null` from PostgREST. It comes back as
  // one row with every column NULL (`{"id": null, ...}`), confirmed
  // empirically through the actual REST layer, not assumed. `!data` alone
  // would miss this and leak an all-null "result" into the UI.
  if (!data || data.id === null) return null;
  return {
    user_id: data.id,
    unique_user_id: data.unique_user_id,
    first_name: data.first_name,
    last_name: data.last_name,
    profile_image_url: data.profile_image_url,
  };
}

// user_public_profiles is a VIEW with no PostgREST-discoverable FK from
// friendships.requester_id/receiver_id, so this is two queries + a
// client-side merge, not a single embedded select (see this plan's Global
// Constraints).
export async function fetchFriends(userId: string): Promise<FriendProfile[]> {
  const { data: rows, error: friendshipsError } = await supabase
    .from('friendships')
    .select('requester_id, receiver_id')
    .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`)
    .eq('status', 'accepted');
  if (friendshipsError) throw new Error(friendshipsError.message);
  if (!rows || rows.length === 0) return [];

  const otherIds = rows.map((r) => (r.requester_id === userId ? r.receiver_id : r.requester_id));
  const { data: profiles, error: profilesError } = await supabase
    .from('user_public_profiles')
    .select('id, unique_user_id, first_name, last_name, profile_image_url')
    .in('id', otherIds);
  if (profilesError) throw new Error(profilesError.message);

  return (profiles ?? []).map((p) => ({
    user_id: p.id,
    unique_user_id: p.unique_user_id,
    first_name: p.first_name,
    last_name: p.last_name,
    profile_image_url: p.profile_image_url,
  }));
}

// Same two-query + client-side-merge shape as fetchFriends, for the same
// reason: user_public_profiles is a VIEW with no PostgREST-discoverable FK
// from user_blocks.blocked_id.
export async function fetchBlockedUsers(userId: string): Promise<FriendProfile[]> {
  const { data: rows, error: blocksError } = await supabase
    .from('user_blocks')
    .select('blocked_id')
    .eq('blocker_id', userId);
  if (blocksError) throw new Error(blocksError.message);
  if (!rows || rows.length === 0) return [];

  const blockedIds = rows.map((r) => r.blocked_id);
  const { data: profiles, error: profilesError } = await supabase
    .from('user_public_profiles')
    .select('id, unique_user_id, first_name, last_name, profile_image_url')
    .in('id', blockedIds);
  if (profilesError) throw new Error(profilesError.message);

  return (profiles ?? []).map((p) => ({
    user_id: p.id,
    unique_user_id: p.unique_user_id,
    first_name: p.first_name,
    last_name: p.last_name,
    profile_image_url: p.profile_image_url,
  }));
}

export async function fetchFriendRequests(userId: string): Promise<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }> {
  const { data: rows, error: friendshipsError } = await supabase
    .from('friendships')
    .select('id, requester_id, receiver_id, created_at')
    .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`)
    .eq('status', 'pending');
  if (friendshipsError) throw new Error(friendshipsError.message);
  if (!rows || rows.length === 0) return { incoming: [], outgoing: [] };

  const otherIds = rows.map((r) => (r.requester_id === userId ? r.receiver_id : r.requester_id));
  const { data: profiles, error: profilesError } = await supabase
    .from('user_public_profiles')
    .select('id, unique_user_id, first_name, last_name, profile_image_url')
    .in('id', otherIds);
  if (profilesError) throw new Error(profilesError.message);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const incoming: FriendRequest[] = [];
  const outgoing: FriendRequest[] = [];
  for (const row of rows) {
    const isIncoming = row.receiver_id === userId;
    const otherId = isIncoming ? row.requester_id : row.receiver_id;
    const profile = profileById.get(otherId);
    if (!profile) continue;
    const request: FriendRequest = {
      id: row.id,
      created_at: row.created_at,
      user: {
        user_id: profile.id,
        unique_user_id: profile.unique_user_id,
        first_name: profile.first_name,
        last_name: profile.last_name,
        profile_image_url: profile.profile_image_url,
      },
    };
    (isIncoming ? incoming : outgoing).push(request);
  }
  return { incoming, outgoing };
}

export async function fetchFriendshipStatus(userId: string, otherUserId: string): Promise<FriendshipStatus> {
  const { data: friendship, error: friendshipError } = await supabase
    .from('friendships')
    .select('id, requester_id, receiver_id, status')
    .or(`and(requester_id.eq.${userId},receiver_id.eq.${otherUserId}),and(requester_id.eq.${otherUserId},receiver_id.eq.${userId})`)
    .maybeSingle();
  if (friendshipError) throw new Error(friendshipError.message);

  if (friendship) {
    if (friendship.status === 'accepted') return { kind: 'friends', friendshipId: friendship.id };
    if (friendship.status === 'pending') {
      return friendship.requester_id === userId
        ? { kind: 'pending_outgoing', friendshipId: friendship.id }
        : { kind: 'pending_incoming', friendshipId: friendship.id };
    }
    // status === 'rejected': treated the same as no relationship at all --
    // the spec's own re-request flow is delete + re-insert, and a rejected
    // row that still exists (not yet deleted by either party) should not
    // block sending a fresh request.
  }

  // RLS (`user_blocks_select_own`) only lets the caller see blocks THEY
  // made -- this can only ever report 'blocked_by_me', never reveal a block
  // made by the other party (see this plan's design spec, risks section).
  const { data: block, error: blockError } = await supabase
    .from('user_blocks')
    .select('blocker_id')
    .eq('blocker_id', userId)
    .eq('blocked_id', otherUserId)
    .maybeSingle();
  if (blockError) throw new Error(blockError.message);
  if (block) return { kind: 'blocked_by_me' };

  return { kind: 'none' };
}

export async function sendFriendRequest(userId: string, otherUserId: string): Promise<void> {
  // friendships_unique_pair_idx is status-agnostic, so a previously-rejected
  // row between these two users would otherwise collide with this insert
  // (23505) forever -- a rejected friendship has no other in-app path to
  // deletion (see fetchFriendshipStatus's own comment: 'rejected' reports as
  // 'none', matching the spec's delete+re-insert re-request flow, but
  // nothing actually did the delete half until now). Either party may
  // delete any status via friendships_delete_participant, so clear a stale
  // rejected row first -- a no-op delete (nothing rejected exists) is safe
  // and cheap.
  await supabase
    .from('friendships')
    .delete()
    .eq('status', 'rejected')
    .or(`and(requester_id.eq.${userId},receiver_id.eq.${otherUserId}),and(requester_id.eq.${otherUserId},receiver_id.eq.${userId})`);

  const { error } = await supabase.from('friendships').insert([{ requester_id: userId, receiver_id: otherUserId }]);
  if (error) throw new Error(translateFriendshipError(error.message, error.code));
}

export async function respondToFriendRequest(friendshipId: string, accept: boolean): Promise<void> {
  const { error } = await supabase
    .from('friendships')
    .update({ status: accept ? 'accepted' : 'rejected' })
    .eq('id', friendshipId);
  if (error) throw new Error(translateFriendshipError(error.message, error.code));
}

export async function cancelFriendRequest(friendshipId: string): Promise<void> {
  const { error } = await supabase.from('friendships').delete().eq('id', friendshipId);
  if (error) throw new Error(error.message);
}

export async function removeFriend(friendshipId: string): Promise<void> {
  const { error } = await supabase.from('friendships').delete().eq('id', friendshipId);
  if (error) throw new Error(error.message);
}

export async function blockUser(userId: string, otherUserId: string): Promise<void> {
  const { error } = await supabase.from('user_blocks').insert([{ blocker_id: userId, blocked_id: otherUserId }]);
  if (error) throw new Error(error.message);
}

export async function unblockUser(userId: string, otherUserId: string): Promise<void> {
  const { error } = await supabase.from('user_blocks').delete().eq('blocker_id', userId).eq('blocked_id', otherUserId);
  if (error) throw new Error(error.message);
}

export async function reportUser(userId: string, otherUserId: string, reason: string): Promise<void> {
  const { error } = await supabase.from('reports').insert([{ reporter_id: userId, reported_user_id: otherUserId, reason }]);
  if (error) throw new Error(error.message);
}
