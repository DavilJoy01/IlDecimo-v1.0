import { useState } from 'react';
import { signInWithPassword, deleteOwnAccount } from '@/api/auth';
import { deleteAllProfileImages } from '@/api/users';
import { supabase } from '@/api/supabase';
import { useSessionStore } from '@/stores/sessionStore';

export function useDeleteAccount() {
  const profile = useSessionStore((s) => s.profile);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteAccount(password: string): Promise<boolean> {
    if (!profile) return false;
    setLoading(true);
    setError(null);
    try {
      await signInWithPassword(profile.phone, password);
      await deleteAllProfileImages(profile.id);
      await deleteOwnAccount();
      await supabase.auth.signOut();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossibile eliminare l'account.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  return { deleteAccount, loading, error };
}
