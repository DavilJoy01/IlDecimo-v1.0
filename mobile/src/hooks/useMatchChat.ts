import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchMatchMessages,
  fetchChatParticipants,
  sendMatchMessage,
  type ChatMessageWithSender,
  type ChatParticipant,
} from '@/api/matchMessages';
import { supabase } from '@/api/supabase';
import { useSessionStore } from '@/stores/sessionStore';

interface RealtimeInsertPayload {
  new: { id: string; match_id: string; sender_id: string; body: string; created_at: string };
}

export function useMatchChat(matchId: string) {
  const userId = useSessionStore((s) => s.session?.user.id);
  const ownProfile = useSessionStore((s) => s.profile);
  const [messages, setMessages] = useState<ChatMessageWithSender[]>([]);
  const [participants, setParticipants] = useState<ChatParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Read inside the Realtime callback without re-subscribing the channel
  // every time the participant list changes.
  const participantsRef = useRef(participants);
  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [messageResult, participantResult] = await Promise.all([
        fetchMatchMessages(matchId),
        fetchChatParticipants(matchId),
      ]);
      setMessages(messageResult);
      setParticipants(participantResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile caricare la chat.');
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel(`match_messages:${matchId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'match_messages', filter: `match_id=eq.${matchId}` },
        (payload: RealtimeInsertPayload) => {
          // Our own messages are reconciled directly from send()'s RPC
          // return value -- rendering them again here would duplicate them.
          if (payload.new.sender_id === userId) return;
          const profile = participantsRef.current.find((p) => p.user_id === payload.new.sender_id);
          setMessages((prev) => [
            {
              ...payload.new,
              sender: {
                first_name: profile?.first_name ?? '???',
                last_name: profile?.last_name ?? '',
                profile_image_url: profile?.profile_image_url ?? null,
              },
            },
            ...prev,
          ]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId, userId]);

  async function send(body: string, mentionedUserIds: string[]): Promise<boolean> {
    if (!userId || !ownProfile) {
      setSendError('Devi essere autenticato per scrivere.');
      return false;
    }
    const tempId = `local-${Date.now()}`;
    const ownSender = {
      first_name: ownProfile.first_name,
      last_name: ownProfile.last_name,
      profile_image_url: ownProfile.profile_image_url,
    };
    setMessages((prev) => [
      { id: tempId, match_id: matchId, sender_id: userId, body, created_at: new Date().toISOString(), sender: ownSender },
      ...prev,
    ]);
    setSendError(null);
    setSending(true);
    try {
      const created = await sendMatchMessage(matchId, body, mentionedUserIds);
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...created, sender: ownSender } : m)));
      return true;
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setSendError(err instanceof Error ? err.message : 'Impossibile inviare il messaggio.');
      return false;
    } finally {
      setSending(false);
    }
  }

  return { messages, participants, loading, error, sending, sendError, send, refresh: load };
}
