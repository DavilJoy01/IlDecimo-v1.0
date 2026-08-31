import { useState } from 'react';
import { signInWithPassword } from '@/api/auth';

export function useLogin() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function login(phone: string, password: string) {
    setLoading(true);
    setError(null);
    try {
      await signInWithPassword(phone, password);
      // No navigation here: the root layout's auth-state listener (Task 3)
      // reacts to the resulting session change and redirects.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Accesso non riuscito.');
    } finally {
      setLoading(false);
    }
  }

  return { login, loading, error };
}
