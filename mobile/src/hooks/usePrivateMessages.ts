// mobile/src/hooks/usePrivateMessages.ts
import { useCallback, useEffect, useState } from 'react';
import {
  fetchMessages,
  sendPrivateMessage,
  markConversationRead,
  type PrivateMessage,
} from '@/api/privateMessages';
import { supabase } from '@/api/supabase';
import { useSessionStore } from '@/stores/sessionStore';

interface RealtimeInsertPayload {
  new: { id: string; conversation_id: string; sender_id: string; body: string; read_at: string | null; created_at: string };
}

interface OtherUser {
  user_id: string;
  first_name: string;
  last_name: string;
  profile_image_url: string | null;
}

export function usePrivateMessages(conversationId: string) {
  const userId = useSessionStore((s) => s.session?.user.id);
  const [messages, setMessages] = useState<PrivateMessage[]>([]);
  const [otherUser, setOtherUser] = useState<OtherUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [{ data: conversation, error: convError }, messageResult] = await Promise.all([
        supabase.from('private_conversations').select('user_a_id, user_b_id').eq('id', conversationId).single(),
        fetchMessages(conversationId),
      ]);
      if (convError) throw new Error(convError.message);
      const otherId = conversation.user_a_id === userId ? conversation.user_b_id : conversation.user_a_id;

      const { data: profile, error: profileError } = await supabase
        .from('user_public_profiles')
        .select('id, first_name, last_name, profile_image_url')
        .eq('id', otherId)
        .single();
      if (profileError) throw new Error(profileError.message);

      setOtherUser({ user_id: profile.id, first_name: profile.first_name, last_name: profile.last_name, profile_image_url: profile.profile_image_url });
      setMessages(messageResult);
      // Best-effort: a failed mark-as-read isn't worth surfacing as a
      // user-facing error -- messages just stay unread until the next
      // successful load (e.g. the screen regaining focus).
      markConversationRead(conversationId, userId).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile caricare la chat.');
    } finally {
      setLoading(false);
    }
  }, [conversationId, userId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel(`private_messages:${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'private_messages', filter: `conversation_id=eq.${conversationId}` },
        (payload: RealtimeInsertPayload) => {
          // Our own messages are reconciled directly from send()'s own
          // return value -- rendering them again here would duplicate them.
          if (payload.new.sender_id === userId) return;
          setMessages((prev) => [payload.new, ...prev]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, userId]);

  async function send(body: string): Promise<boolean> {
    if (!userId) {
      setSendError('Devi essere autenticato per scrivere.');
      return false;
    }
    const tempId = `local-${Date.now()}`;
    setMessages((prev) => [
      { id: tempId, conversation_id: conversationId, sender_id: userId, body, read_at: null, created_at: new Date().toISOString() },
      ...prev,
    ]);
    setSendError(null);
    setSending(true);
    try {
      const created = await sendPrivateMessage(conversationId, userId, body);
      setMessages((prev) => prev.map((m) => (m.id === tempId ? created : m)));
      return true;
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setSendError(err instanceof Error ? err.message : 'Impossibile inviare il messaggio.');
      return false;
    } finally {
      setSending(false);
    }
  }

  return { messages, otherUser, loading, error, sending, sendError, send, refresh: load };
}
