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
        // Valorizza subito la label anche prima che il fetch risolva: se il
        // fetch automatico fallisce (rete assente, ecc.), l'utente vede
        // comunque la città già cercata invece della schermata "mai
        // cercato" insieme all'errore, e può ripremere "Cerca".
        setLocationLabel(saved.label);
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
      const trimmedQuery = query.trim();
      setLoading(true);
      setError(null);
      try {
        const { latitude, longitude } = await geocodeAddress(trimmedQuery);
        const location: SavedSearchLocation = { label: trimmedQuery, latitude, longitude };
        await fetchAt(location);
        try {
          await saveLastSearchLocation(location);
        } catch {
          // Salvataggio best-effort: serve solo a ripristinare la ricerca
          // alla prossima apertura, non è un requisito della ricerca
          // corrente -- un fallimento di storage non deve mascherare un
          // geocoding riuscito.
        }
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
