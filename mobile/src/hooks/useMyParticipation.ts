import { useCallback, useEffect, useState } from 'react';
import {
  fetchMyParticipation,
  requestToJoin,
  reRequestToJoin,
  leaveMatch,
  type MyParticipation,
} from '@/api/participants';
import { useSessionStore } from '@/stores/sessionStore';

export function useMyParticipation(matchId: string) {
  const userId = useSessionStore((s) => s.session?.user.id);
  const [participation, setParticipation] = useState<MyParticipation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetchMyParticipation(matchId, userId);
      setParticipation(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile caricare la partecipazione.');
    } finally {
      setLoading(false);
    }
  }, [matchId, userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function requestJoin(): Promise<boolean> {
    if (!userId) {
      setError('Devi essere autenticato per partecipare.');
      return false;
    }
    setActionLoading(true);
    setError(null);
    try {
      await requestToJoin(matchId, userId);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile inviare la richiesta.');
      return false;
    } finally {
      setActionLoading(false);
    }
  }

  async function requestAgain(): Promise<boolean> {
    if (!participation) return false;
    setActionLoading(true);
    setError(null);
    try {
      await reRequestToJoin(participation.id);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile inviare la richiesta.');
      return false;
    } finally {
      setActionLoading(false);
    }
  }

  async function leave(): Promise<boolean> {
    if (!participation) return false;
    setActionLoading(true);
    setError(null);
    try {
      await leaveMatch(participation.id);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile abbandonare la partita.');
      return false;
    } finally {
      setActionLoading(false);
    }
  }

  return { participation, loading, error, actionLoading, requestJoin, requestAgain, leave, refresh: load };
}
