import { useCallback, useEffect, useState } from 'react';
import { fetchUserMatchHistory, type MatchHistoryEntry } from '@/api/users';

const PAGE_SIZE = 20;

export function useUserMatchHistory(targetId: string) {
  const [matches, setMatches] = useState<MatchHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchUserMatchHistory(targetId, null, PAGE_SIZE);
      setMatches(page);
      setHasMore(page.length === PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile caricare lo storico.');
    } finally {
      setLoading(false);
    }
  }, [targetId]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || matches.length === 0) return;
    setLoadingMore(true);
    setError(null);
    try {
      const last = matches[matches.length - 1];
      const page = await fetchUserMatchHistory(
        targetId,
        { date: last.match_date, time: last.start_time, id: last.match_id },
        PAGE_SIZE
      );
      setMatches((prev) => [...prev, ...page]);
      setHasMore(page.length === PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile caricare altre partite.');
    } finally {
      setLoadingMore(false);
    }
  }, [targetId, matches, loadingMore, hasMore]);

  useEffect(() => {
    load();
  }, [load]);

  return { matches, loading, loadingMore, error, hasMore, loadMore, retry: load };
}
