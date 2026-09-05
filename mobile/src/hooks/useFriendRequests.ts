// mobile/src/hooks/useFriendRequests.ts
import { useCallback, useEffect, useState } from 'react';
import {
  fetchFriendRequests,
  respondToFriendRequest,
  cancelFriendRequest,
  type FriendRequest,
} from '@/api/friendships';
import { useSessionStore } from '@/stores/sessionStore';

export function useFriendRequests() {
  const userId = useSessionStore((s) => s.session?.user.id);
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
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
      const result = await fetchFriendRequests(userId);
      setIncoming(result.incoming);
      setOutgoing(result.outgoing);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile caricare le richieste di amicizia.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function respond(friendshipId: string, accept: boolean): Promise<boolean> {
    try {
      await respondToFriendRequest(friendshipId, accept);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile rispondere alla richiesta.');
      return false;
    }
  }

  async function cancel(friendshipId: string): Promise<boolean> {
    try {
      await cancelFriendRequest(friendshipId);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile annullare la richiesta.');
      return false;
    }
  }

  return {
    incoming,
    outgoing,
    loading,
    error,
    accept: (friendshipId: string) => respond(friendshipId, true),
    reject: (friendshipId: string) => respond(friendshipId, false),
    cancel,
    refresh: load,
  };
}
