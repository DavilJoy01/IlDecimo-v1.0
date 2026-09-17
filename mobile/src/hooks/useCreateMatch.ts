import { useState } from 'react';
import { router } from 'expo-router';
import { geocodeAddress, reverseGeocodeLabel, type GeocodedLocation } from '@/api/geocoding';
import { createMatch } from '@/api/matches';
import { useSessionStore } from '@/stores/sessionStore';
import type { MatchFormValues } from '@/components/MatchForm';

export interface ResolvedMatchLocation extends GeocodedLocation {
  label: string;
}

export function useCreateMatch() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useSessionStore((s) => s.session);

  async function resolveLocation(address: string): Promise<ResolvedMatchLocation | null> {
    if (!session) {
      setError('Devi essere autenticato per creare una partita.');
      return null;
    }
    setLoading(true);
    setError(null);
    try {
      const location = await geocodeAddress(address);
      const label = (await reverseGeocodeLabel(location)) ?? address;
      return { ...location, label };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile creare la partita.');
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function create(values: MatchFormValues, location: GeocodedLocation): Promise<void> {
    if (!session) {
      setError('Devi essere autenticato per creare una partita.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const match = await createMatch({
        creator_id: session.user.id,
        match_type: values.matchType,
        field_name: values.fieldName,
        address: values.address,
        latitude: location.latitude,
        longitude: location.longitude,
        match_date: values.matchDate,
        start_time: values.startTime,
        end_time: values.endTime,
        max_players: Number(values.maxPlayers),
        external_confirmed_count: Number(values.externalConfirmedCount) || 0,
        description: values.description || null,
      });
      router.replace({ pathname: '/(tabs)/home/match/[id]', params: { id: match.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile creare la partita.');
    } finally {
      setLoading(false);
    }
  }

  return { resolveLocation, create, loading, error };
}
