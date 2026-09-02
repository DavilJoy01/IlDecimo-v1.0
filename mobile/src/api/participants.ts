import { supabase } from './supabase';
import type { Match } from './matches';

export type ParticipantStatus = 'requested' | 'approved' | 'rejected' | 'active' | 'left' | 'completed';

export interface MyParticipation {
  id: string;
  status: ParticipantStatus;
  leave_count: number;
}

export interface ParticipantProfile {
  participant_id: string;
  user_id: string;
  status: ParticipantStatus;
  first_name: string;
  last_name: string;
  profile_image_url: string | null;
  unique_user_id: string;
  player_role: 'player' | 'goalkeeper' | 'both';
  preferred_foot: 'left' | 'right' | 'both';
}

export interface MyMatchParticipation {
  match: Match;
  status: ParticipantStatus;
}

export async function requestToJoin(matchId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('match_participants')
    .insert([{ match_id: matchId, user_id: userId, status: 'requested' }]);
  if (error) throw new Error(error.message);
}

export async function reRequestToJoin(participantId: string): Promise<void> {
  const { error } = await supabase.from('match_participants').update({ status: 'requested' }).eq('id', participantId);
  if (error) throw new Error(error.message);
}

export async function leaveMatch(participantId: string): Promise<void> {
  const { error } = await supabase.from('match_participants').update({ status: 'left' }).eq('id', participantId);
  if (error) throw new Error(error.message);
}

export async function approveParticipant(participantId: string): Promise<void> {
  const { error } = await supabase.from('match_participants').update({ status: 'approved' }).eq('id', participantId);
  if (error) throw new Error(error.message);
}

export async function rejectParticipant(participantId: string): Promise<void> {
  const { error } = await supabase.from('match_participants').update({ status: 'rejected' }).eq('id', participantId);
  if (error) throw new Error(error.message);
}

export async function fetchMyParticipation(matchId: string, userId: string): Promise<MyParticipation | null> {
  const { data, error } = await supabase
    .from('match_participants')
    .select('id, status, leave_count')
    .eq('match_id', matchId)
    .eq('user_id', userId)
    .single();
  // PGRST116 = "no rows returned" -- expected when this user has never
  // interacted with this match, not a real error.
  if (error && error.code !== 'PGRST116') throw new Error(error.message);
  return (data as MyParticipation) ?? null;
}

// user_public_profiles is a VIEW with no PostgREST-discoverable FK from
// match_participants.user_id, so this is two queries + a client-side merge,
// not a single embedded select (see this plan's Global Constraints).
export async function fetchMatchParticipantProfiles(matchId: string): Promise<ParticipantProfile[]> {
  const { data: participants, error: participantsError } = await supabase
    .from('match_participants')
    .select('id, user_id, status')
    .eq('match_id', matchId);
  if (participantsError) throw new Error(participantsError.message);
  if (!participants || participants.length === 0) return [];

  const userIds = participants.map((p) => p.user_id);
  const { data: profiles, error: profilesError } = await supabase
    .from('user_public_profiles')
    .select('id, first_name, last_name, profile_image_url, unique_user_id, player_role, preferred_foot')
    .in('id', userIds);
  if (profilesError) throw new Error(profilesError.message);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const result: ParticipantProfile[] = [];
  for (const p of participants) {
    const profile = profileById.get(p.user_id);
    if (!profile) continue;
    result.push({
      participant_id: p.id,
      user_id: p.user_id,
      status: p.status as ParticipantStatus,
      first_name: profile.first_name,
      last_name: profile.last_name,
      profile_image_url: profile.profile_image_url,
      unique_user_id: profile.unique_user_id,
      player_role: profile.player_role,
      preferred_foot: profile.preferred_foot,
    });
  }
  return result;
}

// match_participants.match_id really does have a FK to matches(id), so this
// one CAN be a single embedded select -- unlike fetchMatchParticipantProfiles
// above, which cannot (see this plan's Global Constraints).
export async function fetchMyParticipatingMatches(userId: string): Promise<MyMatchParticipation[]> {
  const { data, error } = await supabase
    .from('match_participants')
    .select('status, matches(*)')
    .eq('user_id', userId)
    .in('status', ['requested', 'approved', 'active']);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ match: row.matches as unknown as Match, status: row.status as ParticipantStatus }));
}
