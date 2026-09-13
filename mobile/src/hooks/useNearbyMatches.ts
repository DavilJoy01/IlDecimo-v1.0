// mobile/src/hooks/useNearbyMatches.ts
import { useCallback, useEffect, useState } from 'react';
import { geocodeAddress } from '@/api/geocoding';
import { fetchNearbyMatches, type NearbyMatch } from '@/api/matches';
import { getLastSearchLocation, saveLastSearchLocation, type SavedSearchLocation } from '@/api/lastSearchLocation';

export function useNearbyMatches(radiusKm = 20) {
  const [matches, setMatches] = useState<NearbyMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locationLabel, setLocationLabel] = useState<string | null>(null);

  const fetchAt = useCallback(
    async (location: SavedSearchLocation) => {
      setLoading(true);
      setError(null);
      try {
        const results = await fetchNearbyMatches(location.latitude, location.longitude, radiusKm);
        setMatches(results);
        setLocationLabel(location.label);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Impossibile caricare le partite.');
      } finally {
        setLoading(false);
      }
    },
    [radiusKm]
  );

  useEffect(() => {
    (async () => {
      const saved = await getLastSearchLocation();
      if (saved) {
        await fetchAt(saved);
      } else {
        setLoading(false);
      }
    })();
    // Solo al mount: il raggio è una costante fissa senza controllo UI in
    // questo progetto, quindi fetchAt non cambia identità in pratica dopo
    // il primo render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const searchLocation = useCallback(
    async (query: string) => {
      setLoading(true);
      setError(null);
      try {
        const { latitude, longitude } = await geocodeAddress(query);
        const location: SavedSearchLocation = { label: query, latitude, longitude };
        await saveLastSearchLocation(location);
        await fetchAt(location);
      } catch (err) {
        // Un submit fallito non deve cancellare l'ultima lista di partite già
        // mostrata -- matches/locationLabel restano quelli precedenti,
        // l'errore si mostra in aggiunta, non al loro posto.
        setError(err instanceof Error ? err.message : 'Impossibile cercare le partite.');
        setLoading(false);
      }
    },
    [fetchAt]
  );

  const refresh = useCallback(async () => {
    const saved = await getLastSearchLocation();
    if (saved) await fetchAt(saved);
  }, [fetchAt]);

  return { matches, loading, error, locationLabel, searchLocation, refresh };
}
