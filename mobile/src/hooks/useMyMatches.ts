// mobile/src/hooks/useMyMatches.ts
import { useCallback, useEffect, useState } from 'react';
import { fetchMatchesByCreator, type Match } from '@/api/matches';
import { fetchMyParticipatingMatches, type MyMatchParticipation } from '@/api/participants';
import { useSessionStore } from '@/stores/sessionStore';

export function useMyMatches() {
  const userId = useSessionStore((s) => s.session?.user.id);
  const [created, setCreated] = useState<Match[]>([]);
  const [participating, setParticipating] = useState<MyMatchParticipation[]>([]);
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
      const [createdMatches, participatingMatches] = await Promise.all([
        fetchMatchesByCreator(userId),
        fetchMyParticipatingMatches(userId),
      ]);
      setCreated(createdMatches);
      setParticipating(participatingMatches);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile caricare le tue partite.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  return { created, participating, loading, error, refresh: load };
}
