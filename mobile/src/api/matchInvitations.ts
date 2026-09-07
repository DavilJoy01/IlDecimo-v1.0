import { supabase } from './supabase';
import { fetchFriends } from './friendships';

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
  if (code === '23505') return 'Questo utente è già stato invitato a questa partita.';
  return message;
}

// Friends lookup delegates to friendships.ts's own fetchFriends rather than
// duplicating its two-query merge -- FriendProfile carries an extra
// unique_user_id field InvitableFriend doesn't need, dropped in the map
// below. The exclusion queries (existing participants, existing invitees
// for this match) run in parallel and are reduced to exclusion sets
// client-side -- the same multi-query-merge pattern already established in
// messaggi's fetchConversations and persone's fetchFriends, not a new
// approach.
export async function fetchInvitableFriends(userId: string, matchId: string): Promise<InvitableFriend[]> {
  const friends = await fetchFriends(userId);
  if (friends.length === 0) return [];

  const [
    { data: participantRows, error: participantsError },
    { data: invitationRows, error: invitationsError },
  ] = await Promise.all([
    supabase.from('match_participants').select('user_id').eq('match_id', matchId),
    supabase.from('match_invitations').select('invitee_id').eq('match_id', matchId),
  ]);
  if (participantsError) throw new Error(participantsError.message);
  if (invitationsError) throw new Error(invitationsError.message);

  // Excludes ANY existing state (any participant status, any invitation
  // status) -- not just "active" ones. Keeps this exclusion simple and
  // guarantees sendMatchInvitation, called only against this list, never
  // hits the (match_id, invitee_id) unique constraint.
  const excluded = new Set<string>([
    ...(participantRows ?? []).map((r) => r.user_id),
    ...(invitationRows ?? []).map((r) => r.invitee_id),
  ]);

  return friends
    .filter((f) => !excluded.has(f.user_id))
    .map((f) => ({
      user_id: f.user_id,
      first_name: f.first_name,
      last_name: f.last_name,
      profile_image_url: f.profile_image_url,
    }));
}

// fetchInvitableFriends's exclusion query for existing invitations is
// RLS-scoped (match_invitations_select_participants: auth.uid() =
// inviter_id or auth.uid() = invitee_id), so it only sees invitations the
// CURRENT caller sent or received -- not every invitation for this match.
// If a DIFFERENT inviter already invited this friend, the current caller's
// exclusion list won't know about it, and their own insert can still hit
// the (match_id, invitee_id) unique constraint (23505). That case, plus a
// genuine double-tap race on the same friend, are both reachable here --
// translateInvitationError now maps 23505 to a neutral message instead of
// throwing the raw Postgres string.
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
