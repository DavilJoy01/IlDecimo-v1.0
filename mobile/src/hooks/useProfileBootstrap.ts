import { useEffect } from 'react';
import { fetchOwnProfile } from '@/api/users';
import { useSessionStore } from '@/stores/sessionStore';

// Runs once per session change: if we have a session but haven't loaded (or
// created) a profile row yet, try to fetch one. Covers the "app restarted
// with a valid session from a previous, completed registration" case, which
// the registration flow itself (Task 5) never exercises.
export function useProfileBootstrap() {
  const session = useSessionStore((s) => s.session);
  const profile = useSessionStore((s) => s.profile);
  const setProfile = useSessionStore((s) => s.setProfile);

  useEffect(() => {
    if (!session || profile) return;
    let cancelled = false;
    fetchOwnProfile(session.user.id).then((fetched) => {
      if (!cancelled && fetched) setProfile(fetched);
    });
    return () => {
      cancelled = true;
    };
  }, [session, profile, setProfile]);
}
