// mobile/src/hooks/useUserSearch.ts
import { useState } from 'react';
import { searchUserByCode, type FriendProfile } from '@/api/friendships';

export function useUserSearch() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<FriendProfile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(): Promise<void> {
    const trimmed = query.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      // unique_user_id codes are always stored upper-case ('FC-100002'); the
      // input's autoCapitalize doesn't cover paste or autofill, so normalize
      // here rather than silently reporting "not found" for a valid code.
      const found = await searchUserByCode(trimmed.toUpperCase());
      setResult(found);
      setNotFound(found === null);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : 'Impossibile completare la ricerca.');
    } finally {
      setLoading(false);
    }
  }

  return { query, setQuery, result, notFound, loading, error, search };
}
