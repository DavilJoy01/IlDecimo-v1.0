// mobile/src/hooks/useNearbyMatches.ts
import { useCallback, useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { fetchNearbyMatches, type NearbyMatch } from '@/api/matches';

export function useNearbyMatches(radiusKm = 20) {
  const [matches, setMatches] = useState<NearbyMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPermissionDenied(false);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setPermissionDenied(true);
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      const results = await fetchNearbyMatches(position.coords.latitude, position.coords.longitude, radiusKm);
      setMatches(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile caricare le partite.');
    } finally {
      setLoading(false);
    }
  }, [radiusKm]);

  useEffect(() => {
    load();
  }, [load]);

  return { matches, loading, error, permissionDenied, refresh: load };
}
