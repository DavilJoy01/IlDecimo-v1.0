import { useState } from 'react';
import { router } from 'expo-router';
import { geocodeAddress } from '@/api/geocoding';
import { createMatch } from '@/api/matches';
import { useSessionStore } from '@/stores/sessionStore';
import type { MatchFormValues } from '@/components/MatchForm';

export function useCreateMatch() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useSessionStore((s) => s.session);

  async function create(values: MatchFormValues) {
    if (!session) {
      setError('Devi essere autenticato per creare una partita.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { latitude, longitude } = await geocodeAddress(values.address);
      const match = await createMatch({
        creator_id: session.user.id,
        match_type: values.matchType,
        field_name: values.fieldName,
        address: values.address,
        latitude,
        longitude,
        match_date: values.matchDate,
        start_time: values.startTime,
        end_time: values.endTime,
        max_players: Number(values.maxPlayers),
        description: values.description || null,
      });
      router.replace({ pathname: '/(tabs)/home/match/[id]', params: { id: match.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile creare la partita.');
    } finally {
      setLoading(false);
    }
  }

  return { create, loading, error };
}
