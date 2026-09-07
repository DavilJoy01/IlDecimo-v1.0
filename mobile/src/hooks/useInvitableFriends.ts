import { useCallback, useEffect, useState } from 'react';
import { fetchInvitableFriends, sendMatchInvitation, type InvitableFriend } from '@/api/matchInvitations';
import { useSessionStore } from '@/stores/sessionStore';

export function useInvitableFriends(matchId: string) {
  const userId = useSessionStore((s) => s.session?.user.id);
  const [friends, setFriends] = useState<InvitableFriend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetchInvitableFriends(userId, matchId);
      setFriends(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile caricare gli amici invitabili.');
    } finally {
      setLoading(false);
    }
  }, [userId, matchId]);

  useEffect(() => {
    load();
  }, [load]);

  // Re-fetches rather than splicing local state by hand on success --
  // matches this codebase's established hook-mutation convention (see
  // useFriendRequests.respond/.cancel).
  async function invite(inviteeId: string): Promise<boolean> {
    if (!userId) return false;
    setInviting(true);
    setError(null);
    try {
      await sendMatchInvitation(matchId, userId, inviteeId);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile inviare l’invito.');
      return false;
    } finally {
      setInviting(false);
    }
  }

  return { friends, loading, error, invite, inviting, refresh: load };
}
