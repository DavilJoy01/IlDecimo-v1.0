import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

type UserProfile = Database['public']['Tables']['users']['Row'];

export type SessionStatus = 'loading' | 'signed-out' | 'needs-profile' | 'signed-in';

interface SessionState {
  session: Session | null;
  profile: UserProfile | null;
  status: SessionStatus;
  setSession: (session: Session | null) => void;
  setProfile: (profile: UserProfile | null) => void;
}

function computeStatus(session: Session | null, profile: UserProfile | null): SessionStatus {
  if (!session) return 'signed-out';
  if (!profile) return 'needs-profile';
  return 'signed-in';
}

export const useSessionStore = create<SessionState>((set, get) => ({
  session: null,
  profile: null,
  status: 'loading',
  setSession: (session) => set({ session, status: computeStatus(session, get().profile) }),
  setProfile: (profile) => set({ profile, status: computeStatus(get().session, profile) }),
}));
