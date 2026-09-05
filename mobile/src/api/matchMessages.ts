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
// approved/active/completed participant -- matches the backend's chat
// access grant exactly (see match_messages RLS and send_match_message's own
// authorization check). 'completed' is included deliberately: the periodic
// cron (transition_match_statuses) flips every approved/active participant
// to completed shortly after a match ends, so it's the steady state of any
// past match's chat, not a rare edge case -- excluding it would silently
// break the @-mention picker and Realtime sender-name resolution for every
// match that has already been played. Used both to populate the "@" mention
// picker and to resolve a Realtime-arriving message's sender profile (the
// raw postgres_changes payload only carries sender_id, not their name/photo).
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
    .in('status', ['approved', 'active', 'completed']);
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

// send_match_message's own errors are backend-internal strings (its RLS-
// equivalent authorization checks, and the mention-validity trigger it
// still goes through) -- never shown to a user verbatim elsewhere in this
// app's otherwise all-Italian UI, so known cases get translated here at the
// API boundary rather than in the screen that displays them.
const RPC_ERROR_TRANSLATIONS: Record<string, string> = {
  'not authorized to post in this match room': 'Non sei autorizzato a scrivere in questa chat.',
  'cannot mention yourself': 'Non puoi menzionare te stesso.',
  'cannot mention a user who is not the creator or an approved/active/completed participant of this match':
    'Non puoi menzionare questa persona.',
};

function translateSendMatchMessageError(message: string): string {
  if (RPC_ERROR_TRANSLATIONS[message]) return RPC_ERROR_TRANSLATIONS[message];
  if (message.includes('match_messages_body_check')) return 'Il messaggio è troppo lungo (massimo 2000 caratteri).';
  return message;
}

export async function sendMatchMessage(matchId: string, body: string, mentionedUserIds: string[]): Promise<ChatMessage> {
  const { data, error } = await supabase.rpc('send_match_message', {
    p_match_id: matchId,
    p_body: body,
    p_mentions: mentionedUserIds,
  });
  if (error) throw new Error(translateSendMatchMessageError(error.message));
  return data as ChatMessage;
}
