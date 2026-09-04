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
