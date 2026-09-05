// mobile/src/hooks/useUserProfile.ts
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/api/supabase';
import {
  fetchFriendshipStatus,
  sendFriendRequest,
  respondToFriendRequest,
  cancelFriendRequest,
  removeFriend as removeFriendApi,
  blockUser,
  unblockUser,
  reportUser,
  type FriendshipStatus,
} from '@/api/friendships';
import { useSessionStore } from '@/stores/sessionStore';

export interface TargetProfile {
  id: string;
  unique_user_id: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  height_cm: number;
  preferred_foot: 'left' | 'right' | 'both';
  player_role: 'player' | 'goalkeeper' | 'both';
  profile_image_url: string | null;
  matches_played_count: number;
  matches_completed_count: number;
}

export function useUserProfile(targetUserId: string) {
  const userId = useSessionStore((s) => s.session?.user.id);
  const [profile, setProfile] = useState<TargetProfile | null>(null);
  const [status, setStatus] = useState<FriendshipStatus>({ kind: 'none' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (!userId) return;
    const result = await fetchFriendshipStatus(userId, targetUserId);
    setStatus(result);
  }, [userId, targetUserId]);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data: profileRow, error: profileError } = await supabase
        .from('user_public_profiles')
        .select('*')
        .eq('id', targetUserId)
        .single();
      if (profileError) throw new Error(profileError.message);
      setProfile(profileRow as TargetProfile);
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile caricare il profilo.');
    } finally {
      setLoading(false);
    }
  }, [userId, targetUserId, refreshStatus]);

  useEffect(() => {
    load();
  }, [load]);

  async function runAction(action: () => Promise<void>): Promise<boolean> {
    if (!userId) return false;
    setActionLoading(true);
    setActionError(null);
    try {
      await action();
      await refreshStatus();
      return true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Impossibile completare l\'operazione.');
      return false;
    } finally {
      setActionLoading(false);
    }
  }

  return {
    profile,
    status,
    loading,
    error,
    actionError,
    actionLoading,
    sendRequest: () => runAction(() => sendFriendRequest(userId!, targetUserId)),
    cancelRequest: () =>
      runAction(() => {
        if (status.kind !== 'pending_outgoing') throw new Error('Nessuna richiesta da annullare.');
        return cancelFriendRequest(status.friendshipId);
      }),
    accept: () =>
      runAction(() => {
        if (status.kind !== 'pending_incoming') throw new Error('Nessuna richiesta da accettare.');
        return respondToFriendRequest(status.friendshipId, true);
      }),
    reject: () =>
      runAction(() => {
        if (status.kind !== 'pending_incoming') throw new Error('Nessuna richiesta da rifiutare.');
        return respondToFriendRequest(status.friendshipId, false);
      }),
    removeFriend: () =>
      runAction(() => {
        if (status.kind !== 'friends') throw new Error('Nessuna amicizia da rimuovere.');
        return removeFriendApi(status.friendshipId);
      }),
    block: () => runAction(() => blockUser(userId!, targetUserId)),
    unblock: () => runAction(() => unblockUser(userId!, targetUserId)),
    report: (reason: string) => runAction(() => reportUser(userId!, targetUserId, reason)),
  };
}
