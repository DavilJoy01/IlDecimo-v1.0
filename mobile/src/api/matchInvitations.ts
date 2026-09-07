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
