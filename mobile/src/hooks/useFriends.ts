// mobile/src/hooks/useFriends.ts
import { useCallback, useEffect, useState } from 'react';
import { fetchFriends, type FriendProfile } from '@/api/friendships';
import { useSessionStore } from '@/stores/sessionStore';

export function useFriends() {
  const userId = useSessionStore((s) => s.session?.user.id);
  const [friends, setFriends] = useState<FriendProfile[]>([]);
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
      const result = await fetchFriends(userId);
      setFriends(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile caricare gli amici.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  return { friends, loading, error, refresh: load };
}
