// mobile/src/hooks/useMatchRoster.ts
import { useCallback, useEffect, useState } from 'react';
import {
  fetchMatchParticipantProfiles,
  approveParticipant,
  rejectParticipant,
  type ParticipantProfile,
} from '@/api/participants';

export function useMatchRoster(matchId: string) {
  const [profiles, setProfiles] = useState<ParticipantProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchMatchParticipantProfiles(matchId);
      setProfiles(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile caricare i partecipanti.');
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    load();
  }, [load]);

  async function approve(participantId: string): Promise<boolean> {
    setActionLoading(true);
    setError(null);
    try {
      await approveParticipant(participantId);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile approvare la richiesta.');
      return false;
    } finally {
      setActionLoading(false);
    }
  }

  async function reject(participantId: string): Promise<boolean> {
    setActionLoading(true);
    setError(null);
    try {
      await rejectParticipant(participantId);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile rifiutare la richiesta.');
      return false;
    } finally {
      setActionLoading(false);
    }
  }

  const pendingRequests = profiles.filter((p) => p.status === 'requested');
  const approvedParticipants = profiles.filter((p) => p.status === 'approved' || p.status === 'active');

  return { pendingRequests, approvedParticipants, loading, error, actionLoading, approve, reject, refresh: load };
}
