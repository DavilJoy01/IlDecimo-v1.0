import { supabase } from './supabase';

// Errors surfaced here are backend-internal English strings (a raw RLS-
// denial error), never shown verbatim in this all-Italian UI.
function translateMessagingError(message: string, code?: string): string {
  // 42501 = Postgres insufficient_privilege, the code an RLS `with check`
  // denial surfaces as -- covers the case where the OTHER user has blocked
  // the caller (invisible to the caller, so no specific message is safe to
  // show; mirrors friendships.ts's translateFriendshipError and its own
  // comment on the identical 42501 case).
  if (code === '42501') return 'Non è possibile inviare un messaggio a questo utente.';
  return message;
}

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

// user_public_profiles is a VIEW with no PostgREST-discoverable FK from
// private_conversations.user_a_id/user_b_id, so this is two queries + a
// client-side merge, not a single embedded select (see this plan's Global
// Constraints). The "most recent message per conversation" step is a
// third query reduced client-side (not a real top-1-per-group SQL query)
// -- acceptable at this codebase's data volumes, matching how
// matchMessages.ts/friendships.ts already avoid embedded selects for
// view-backed joins.
export async function fetchConversations(userId: string): Promise<ConversationSummary[]> {
  const { data: rows, error: convError } = await supabase
    .from('private_conversations')
    .select('id, user_a_id, user_b_id')
    .or(`and(user_a_id.eq.${userId},hidden_for_a_at.is.null),and(user_b_id.eq.${userId},hidden_for_b_at.is.null)`);
  if (convError) throw new Error(convError.message);
  if (!rows || rows.length === 0) return [];

  const otherIds = rows.map((r) => (r.user_a_id === userId ? r.user_b_id : r.user_a_id));
  const conversationIds = rows.map((r) => r.id);

  const { data: profiles, error: profilesError } = await supabase
    .from('user_public_profiles')
    .select('id, first_name, last_name, profile_image_url')
    .in('id', otherIds);
  if (profilesError) throw new Error(profilesError.message);

  const { data: messages, error: messagesError } = await supabase
    .from('private_messages')
    .select('conversation_id, sender_id, body, read_at, created_at')
    .in('conversation_id', conversationIds)
    .order('created_at', { ascending: false });
  if (messagesError) throw new Error(messagesError.message);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const latestByConversation = new Map<string, { body: string; created_at: string; sender_id: string }>();
  const unreadConversations = new Set<string>();
  for (const m of messages ?? []) {
    // Rows arrive newest-first overall, so the first time we see a given
    // conversation_id it IS that conversation's most recent message.
    if (!latestByConversation.has(m.conversation_id)) {
      latestByConversation.set(m.conversation_id, { body: m.body, created_at: m.created_at, sender_id: m.sender_id });
    }
    if (m.sender_id !== userId && m.read_at === null) {
      unreadConversations.add(m.conversation_id);
    }
  }

  return rows.map((row) => {
    const otherId = row.user_a_id === userId ? row.user_b_id : row.user_a_id;
    const profile = profileById.get(otherId);
    return {
      conversation_id: row.id,
      other_user: {
        user_id: otherId,
        first_name: profile?.first_name ?? '???',
        last_name: profile?.last_name ?? '',
        profile_image_url: profile?.profile_image_url ?? null,
      },
      last_message: latestByConversation.get(row.id) ?? null,
      unread: unreadConversations.has(row.id),
    };
  });
}

// private_conversations already has correct RLS (participant-only insert,
// no-mutual-block check) -- unlike search_user_by_code in the persone plan,
// no RPC is needed here. A concurrent race (two rapid taps both missing the
// select before either insert lands) is handled by catching the unique
// constraint's 23505 and re-selecting to recover the winning row, rather
// than surfacing an error for what is, from the user's perspective, a
// no-op -- the unique index guarantees only one conversation ever exists
// for the pair regardless of how many clients race.
export async function findOrCreateConversation(userId: string, otherUserId: string): Promise<string> {
  const pairFilter = `and(user_a_id.eq.${userId},user_b_id.eq.${otherUserId}),and(user_a_id.eq.${otherUserId},user_b_id.eq.${userId})`;

  const { data: existing, error: selectError } = await supabase
    .from('private_conversations')
    .select('id')
    .or(pairFilter)
    .maybeSingle();
  if (selectError) throw new Error(selectError.message);
  if (existing) return existing.id;

  const { data: created, error: insertError } = await supabase
    .from('private_conversations')
    .insert([{ user_a_id: userId, user_b_id: otherUserId }])
    .select('id')
    .single();
  if (insertError) {
    if (insertError.code === '23505') {
      const { data: recovered, error: recoverError } = await supabase
        .from('private_conversations')
        .select('id')
        .or(pairFilter)
        .single();
      if (recoverError) throw new Error(translateMessagingError(recoverError.message, recoverError.code));
      return recovered.id;
    }
    throw new Error(translateMessagingError(insertError.message, insertError.code));
  }
  return created.id;
}

// Newest-first (created_at descending): the chat screen renders this in an
// inverted FlatList, which expects index 0 to be the newest message. No
// sender-profile merge needed here -- unlike a multi-participant match
// room, the chat screen already knows both participants' identities from
// the conversation itself.
export async function fetchMessages(conversationId: string, limit = 50): Promise<PrivateMessage[]> {
  const { data, error } = await supabase
    .from('private_messages')
    .select('id, conversation_id, sender_id, body, read_at, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as PrivateMessage[];
}

export async function sendPrivateMessage(conversationId: string, senderId: string, body: string): Promise<PrivateMessage> {
  const { data, error } = await supabase
    .from('private_messages')
    .insert([{ conversation_id: conversationId, sender_id: senderId, body }])
    .select('id, conversation_id, sender_id, body, read_at, created_at')
    .single();
  if (error) throw new Error(translateMessagingError(error.message, error.code));
  return data as PrivateMessage;
}

export async function markConversationRead(conversationId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('private_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .neq('sender_id', userId)
    .is('read_at', null);
  if (error) throw new Error(error.message);
}
