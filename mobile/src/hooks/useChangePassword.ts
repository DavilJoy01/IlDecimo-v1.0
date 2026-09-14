import { useState } from 'react';
import { signInWithPassword, setPassword } from '@/api/auth';
import { useSessionStore } from '@/stores/sessionStore';

export function useChangePassword() {
  const profile = useSessionStore((s) => s.profile);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changePassword(currentPassword: string, newPassword: string): Promise<boolean> {
    if (!profile) return false;
    setLoading(true);
    setError(null);
    try {
      await signInWithPassword(profile.phone, currentPassword);
      await setPassword(newPassword);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile cambiare la password.');
      return false;
    } finally {
      setLoading(false);
    }
  }

  return { changePassword, loading, error };
}
