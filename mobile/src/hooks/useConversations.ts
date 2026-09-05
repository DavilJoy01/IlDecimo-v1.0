// mobile/src/hooks/useConversations.ts
import { useCallback, useEffect, useState } from 'react';
import { fetchConversations, type ConversationSummary } from '@/api/privateMessages';
import { useSessionStore } from '@/stores/sessionStore';

export function useConversations() {
  const userId = useSessionStore((s) => s.session?.user.id);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetchConversations(userId);
      setConversations(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile caricare i messaggi.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  return { conversations, loading, error, refresh: load };
}
