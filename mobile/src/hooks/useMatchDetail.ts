import { useCallback, useEffect, useState } from 'react';
import { fetchMatchById, updateMatch, deleteMatch, type Match, type MatchEditableFields } from '@/api/matches';

export function useMatchDetail(matchId: string) {
  const [match, setMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchMatchById(matchId);
      setMatch(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile caricare la partita.');
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    load();
  }, [load]);

  async function update(input: MatchEditableFields): Promise<boolean> {
    setError(null);
    try {
      const result = await updateMatch(matchId, input);
      setMatch(result);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile aggiornare la partita.');
      return false;
    }
  }

  async function remove(): Promise<boolean> {
    setError(null);
    try {
      await deleteMatch(matchId);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile cancellare la partita.');
      return false;
    }
  }

  return { match, loading, error, refresh: load, update, remove };
}
