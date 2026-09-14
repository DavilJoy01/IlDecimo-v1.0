// mobile/src/hooks/useBlockedUsers.ts
import { useCallback, useEffect, useState } from 'react';
import { fetchBlockedUsers, unblockUser, type FriendProfile } from '@/api/friendships';
import { useSessionStore } from '@/stores/sessionStore';

export function useBlockedUsers() {
  const userId = useSessionStore((s) => s.session?.user.id);
  const [blockedUsers, setBlockedUsers] = useState<FriendProfile[]>([]);
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
      const result = await fetchBlockedUsers(userId);
      setBlockedUsers(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile caricare gli utenti bloccati.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function unblock(otherUserId: string): Promise<boolean> {
    if (!userId) return false;
    try {
      await unblockUser(userId, otherUserId);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile sbloccare l\'utente.');
      return false;
    }
  }

  return { blockedUsers, loading, error, unblock };
}
