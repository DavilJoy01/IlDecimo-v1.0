// mobile/src/hooks/useMatchRoster.ts
import { useCallback, useEffect, useState } from 'react';
import {
  fetchMatchParticipantProfiles,
  approveParticipant,
  rejectParticipant,
  assignTeam,
  shuffleTeams,
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

  async function assignParticipantTeam(participantId: string, team: 'A' | 'B' | null): Promise<boolean> {
    setActionLoading(true);
    setError(null);
    try {
      await assignTeam(participantId, team);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile assegnare la squadra.');
      return false;
    } finally {
      setActionLoading(false);
    }
  }

  async function shuffle(): Promise<boolean> {
    setActionLoading(true);
    setError(null);
    try {
      await shuffleTeams(matchId);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile dividere le squadre.');
      return false;
    } finally {
      setActionLoading(false);
    }
  }

  const pendingRequests = profiles.filter((p) => p.status === 'requested');
  const approvedParticipants = profiles.filter((p) => p.status === 'approved' || p.status === 'active');
  const unassignedParticipants = approvedParticipants.filter((p) => !p.team);
  const teamAParticipants = approvedParticipants.filter((p) => p.team === 'A');
  const teamBParticipants = approvedParticipants.filter((p) => p.team === 'B');

  return {
    pendingRequests,
    approvedParticipants,
    unassignedParticipants,
    teamAParticipants,
    teamBParticipants,
    loading,
    error,
    actionLoading,
    approve,
    reject,
    assignParticipantTeam,
    shuffle,
    refresh: load,
  };
}
