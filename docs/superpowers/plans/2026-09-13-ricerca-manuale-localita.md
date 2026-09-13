# Ricerca manuale per località (sostituzione del GPS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire ogni uso del GPS/posizione in tempo reale con ricerca manuale per località, sia per "Partite vicino a te" in Home sia per la posizione di una partita alla creazione (fix del bug noto: oggi si usa il GPS del creatore invece dell'indirizzo digitato).

**Architecture:** Un modulo di geocoding condiviso (`geocodeAddress`, wrapper su `expo-location`'s `Location.geocodeAsync`) e un modulo di persistenza locale (`lastSearchLocation`, via `expo-secure-store`) alimentano due punti indipendenti del client: la ricerca in Home (`useNearbyMatches`) e la creazione partita (`useCreateMatch`). Il backend (RPC `nearby_open_matches`, tabella `matches`) non cambia: entrambi già accettano lat/lng generici, a prescindere da dove vengano.

**Tech Stack:** React Native/Expo Router, `expo-location` (`geocodeAsync`, già installato), `expo-secure-store` (già installato), Jest + `@testing-library/react-native`.

**Spec:** [docs/superpowers/specs/2026-09-13-ricerca-manuale-localita-design.md](../specs/2026-09-13-ricerca-manuale-localita-design.md)

## Global Constraints

- Nessun GPS/posizione in tempo reale in nessun punto dell'app dopo questo piano — nessuna chiamata a `requestForegroundPermissionsAsync`/`getCurrentPositionAsync` deve sopravvivere.
- Geocoding nativo del dispositivo (`Location.geocodeAsync`), mai un servizio esterno a pagamento: nessuna nuova dipendenza, nessuna nuova chiave API.
- Nessun risultato dal geocoding → lancia `new Error('Località non trovata, prova a essere più specifico.')`, esattamente questo testo, in un solo punto (`geocodeAddress`).
- Più risultati dal geocoding → si usa il primo, mai una UI di scelta.
- L'ultima località cercata in Home è persistita solo sul dispositivo, via `expo-secure-store`, sotto la chiave `'last-search-location'`, come JSON `{ label, latitude, longitude }`.
- Un tentativo di ricerca fallito in Home non deve mai svuotare `matches`/`locationLabel` già mostrati.
- Il raggio di ricerca resta fisso a 20km (default esistente di `useNearbyMatches`), invariato.

---

### Task 1: Modulo di geocoding condiviso

**Files:**
- Create: `mobile/src/api/geocoding.ts`
- Test: `mobile/src/api/geocoding.test.ts`

**Interfaces:**
- Produces: `geocodeAddress(query: string): Promise<{ latitude: number; longitude: number }>` — usata dai Task 3 e 4.

- [ ] **Step 1: Scrivi i test (falliranno: il modulo non esiste ancora)**

```ts
// mobile/src/api/geocoding.test.ts
import * as Location from 'expo-location';
import { geocodeAddress } from './geocoding';

jest.mock('expo-location');

describe('geocodeAddress', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns the coordinates of the only geocoding result', async () => {
    (Location.geocodeAsync as jest.Mock).mockResolvedValue([{ latitude: 45.4642, longitude: 9.19 }]);

    const result = await geocodeAddress('Milano');

    expect(Location.geocodeAsync).toHaveBeenCalledWith('Milano');
    expect(result).toEqual({ latitude: 45.4642, longitude: 9.19 });
  });

  it('returns the first result when geocoding finds more than one match', async () => {
    (Location.geocodeAsync as jest.Mock).mockResolvedValue([
      { latitude: 45.4642, longitude: 9.19 },
      { latitude: 43.077, longitude: -89.401 },
    ]);

    const result = await geocodeAddress('Milano');

    expect(result).toEqual({ latitude: 45.4642, longitude: 9.19 });
  });

  it('throws an Italian error when geocoding finds no results', async () => {
    (Location.geocodeAsync as jest.Mock).mockResolvedValue([]);

    await expect(geocodeAddress('asdkjhasdkjh')).rejects.toThrow(
      'Località non trovata, prova a essere più specifico.'
    );
  });
});
```

- [ ] **Step 2: Esegui i test per verificare che falliscano**

Run: `npx jest src/api/geocoding.test.ts` (dalla cartella `mobile/`)
Expected: FAIL con "Cannot find module './geocoding'"

- [ ] **Step 3: Implementa il modulo**

```ts
// mobile/src/api/geocoding.ts
import * as Location from 'expo-location';

export interface GeocodedLocation {
  latitude: number;
  longitude: number;
}

export async function geocodeAddress(query: string): Promise<GeocodedLocation> {
  const results = await Location.geocodeAsync(query);
  if (results.length === 0) {
    throw new Error('Località non trovata, prova a essere più specifico.');
  }
  const [first] = results;
  return { latitude: first.latitude, longitude: first.longitude };
}
```

**Nota per l'implementatore**: `mobile/AGENTS.md` impone di verificare la documentazione versionata esatta di Expo (v57.0.0, https://docs.expo.dev/versions/v57.0.0/) prima di scrivere codice che tocca un'API di Expo. Conferma su quella pagina la firma esatta di `Location.geocodeAsync` (forma dell'array restituito, campi disponibili su ogni elemento) prima di considerare questo step completo — il codice sopra assume che ogni elemento abbia `latitude`/`longitude` diretti, coerente con l'uso già esistente in questo stesso progetto (`useCreateMatch.ts`'s `position.coords.latitude`/`longitude` usa una forma diversa perché è un risultato di *reverse*-geolocation via GPS, non di geocoding forward — non prenderlo come riferimento per la forma del risultato).

- [ ] **Step 4: Esegui i test per verificare che passino**

Run: `npx jest src/api/geocoding.test.ts` (dalla cartella `mobile/`)
Expected: PASS, 3/3

- [ ] **Step 5: Commit**

```bash
git add mobile/src/api/geocoding.ts mobile/src/api/geocoding.test.ts
git commit -m "feat: add shared geocoding module wrapping expo-location's geocodeAsync"
```

---

### Task 2: Modulo di persistenza dell'ultima località cercata

**Files:**
- Create: `mobile/src/api/lastSearchLocation.ts`
- Test: `mobile/src/api/lastSearchLocation.test.ts`

**Interfaces:**
- Produces: `getLastSearchLocation(): Promise<SavedSearchLocation | null>`, `saveLastSearchLocation(location: SavedSearchLocation): Promise<void>`, `interface SavedSearchLocation { label: string; latitude: number; longitude: number }` — usati dal Task 3.

- [ ] **Step 1: Scrivi i test (falliranno: il modulo non esiste ancora)**

```ts
// mobile/src/api/lastSearchLocation.test.ts
import * as SecureStore from 'expo-secure-store';
import { getLastSearchLocation, saveLastSearchLocation } from './lastSearchLocation';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

describe('lastSearchLocation', () => {
  afterEach(() => jest.clearAllMocks());

  it('saves a location as JSON under the expected key', async () => {
    await saveLastSearchLocation({ label: 'Milano', latitude: 45.4642, longitude: 9.19 });

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'last-search-location',
      JSON.stringify({ label: 'Milano', latitude: 45.4642, longitude: 9.19 })
    );
  });

  it('reads back a previously saved location', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(
      JSON.stringify({ label: 'Milano', latitude: 45.4642, longitude: 9.19 })
    );

    const result = await getLastSearchLocation();

    expect(SecureStore.getItemAsync).toHaveBeenCalledWith('last-search-location');
    expect(result).toEqual({ label: 'Milano', latitude: 45.4642, longitude: 9.19 });
  });

  it('returns null when nothing has been saved yet', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);

    const result = await getLastSearchLocation();

    expect(result).toBeNull();
  });

  it('returns null instead of throwing when the stored value is corrupted', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('{not valid json');

    const result = await getLastSearchLocation();

    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Esegui i test per verificare che falliscano**

Run: `npx jest src/api/lastSearchLocation.test.ts` (dalla cartella `mobile/`)
Expected: FAIL con "Cannot find module './lastSearchLocation'"

- [ ] **Step 3: Implementa il modulo**

```ts
// mobile/src/api/lastSearchLocation.ts
import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'last-search-location';

export interface SavedSearchLocation {
  label: string;
  latitude: number;
  longitude: number;
}

export async function getLastSearchLocation(): Promise<SavedSearchLocation | null> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SavedSearchLocation;
  } catch {
    // Valore corrotto/da una versione precedente incompatibile: trattalo
    // come "nessuna località salvata" invece di far fallire la Home.
    return null;
  }
}

export async function saveLastSearchLocation(location: SavedSearchLocation): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(location));
}
```

- [ ] **Step 4: Esegui i test per verificare che passino**

Run: `npx jest src/api/lastSearchLocation.test.ts` (dalla cartella `mobile/`)
Expected: PASS, 4/4

- [ ] **Step 5: Commit**

```bash
git add mobile/src/api/lastSearchLocation.ts mobile/src/api/lastSearchLocation.test.ts
git commit -m "feat: add local persistence for the last searched location"
```

---

### Task 3: Ricerca in Home — hook + schermata

Sostituisce il GPS con ricerca manuale nella Home. Hook e schermata cambiano insieme perché `mobile/app/(tabs)/home/index.tsx` distrugge `permissionDenied` dal valore di ritorno di `useNearbyMatches` oggi — rimuoverlo solo dall'hook romperebbe il typecheck della schermata.

**Files:**
- Modify: `mobile/src/hooks/useNearbyMatches.ts` (riscrittura completa)
- Modify: `mobile/src/hooks/useNearbyMatches.test.ts` (riscrittura completa)
- Modify: `mobile/app/(tabs)/home/index.tsx`

**Interfaces:**
- Consumes: `geocodeAddress` (Task 1), `getLastSearchLocation`/`saveLastSearchLocation`/`SavedSearchLocation` (Task 2), `fetchNearbyMatches` (esistente, invariato).
- Produces: `useNearbyMatches(radiusKm?: number)` ora ritorna `{ matches, loading, error, locationLabel, searchLocation, refresh }` — **non più** `permissionDenied`. `searchLocation(query: string): Promise<void>` e `refresh(): Promise<void>` sono nuovi/cambiati nella firma rispetto a prima.

- [ ] **Step 1: Riscrivi i test dell'hook (falliranno: l'hook non è ancora stato riscritto)**

```ts
// mobile/src/hooks/useNearbyMatches.test.ts
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { geocodeAddress } from '@/api/geocoding';
import { fetchNearbyMatches } from '@/api/matches';
import { getLastSearchLocation, saveLastSearchLocation } from '@/api/lastSearchLocation';
import { useNearbyMatches } from './useNearbyMatches';

jest.mock('@/api/geocoding', () => ({ geocodeAddress: jest.fn() }));
jest.mock('@/api/matches', () => ({ fetchNearbyMatches: jest.fn() }));
jest.mock('@/api/lastSearchLocation', () => ({
  getLastSearchLocation: jest.fn(),
  saveLastSearchLocation: jest.fn(),
}));

describe('useNearbyMatches', () => {
  afterEach(() => jest.clearAllMocks());

  it('auto-searches at mount using a previously saved location', async () => {
    (getLastSearchLocation as jest.Mock).mockResolvedValue({
      label: 'Milano',
      latitude: 45.4642,
      longitude: 9.19,
    });
    (fetchNearbyMatches as jest.Mock).mockResolvedValue([{ id: 'm1' }]);

    // @testing-library/react-native@14's renderHook returns a Promise -- await it.
    const { result } = await renderHook(() => useNearbyMatches());

    await waitFor(() => expect(result.current.matches).toHaveLength(1));
    expect(fetchNearbyMatches).toHaveBeenCalledWith(45.4642, 9.19, 20);
    expect(result.current.locationLabel).toBe('Milano');
    expect(geocodeAddress).not.toHaveBeenCalled();
  });

  it('does not search at mount when no location was ever saved', async () => {
    (getLastSearchLocation as jest.Mock).mockResolvedValue(null);

    // @testing-library/react-native@14's renderHook returns a Promise -- await it.
    const { result } = await renderHook(() => useNearbyMatches());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchNearbyMatches).not.toHaveBeenCalled();
    expect(result.current.locationLabel).toBeNull();
  });

  it('geocodes, saves, and searches a manually entered location', async () => {
    (getLastSearchLocation as jest.Mock).mockResolvedValue(null);
    (geocodeAddress as jest.Mock).mockResolvedValue({ latitude: 41.9028, longitude: 12.4964 });
    (fetchNearbyMatches as jest.Mock).mockResolvedValue([{ id: 'm2' }]);

    const { result } = await renderHook(() => useNearbyMatches());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.searchLocation('Roma');
    });

    expect(geocodeAddress).toHaveBeenCalledWith('Roma');
    expect(saveLastSearchLocation).toHaveBeenCalledWith({
      label: 'Roma',
      latitude: 41.9028,
      longitude: 12.4964,
    });
    expect(fetchNearbyMatches).toHaveBeenCalledWith(41.9028, 12.4964, 20);
    expect(result.current.matches).toHaveLength(1);
    expect(result.current.locationLabel).toBe('Roma');
  });

  it('keeps the previous results when a manual search fails', async () => {
    (getLastSearchLocation as jest.Mock).mockResolvedValue({
      label: 'Milano',
      latitude: 45.4642,
      longitude: 9.19,
    });
    (fetchNearbyMatches as jest.Mock).mockResolvedValue([{ id: 'm1' }]);

    const { result } = await renderHook(() => useNearbyMatches());
    await waitFor(() => expect(result.current.matches).toHaveLength(1));

    (geocodeAddress as jest.Mock).mockRejectedValue(
      new Error('Località non trovata, prova a essere più specifico.')
    );

    await act(async () => {
      await result.current.searchLocation('asdkjhasdkjh');
    });

    expect(result.current.error).toBe('Località non trovata, prova a essere più specifico.');
    expect(result.current.matches).toHaveLength(1);
    expect(result.current.locationLabel).toBe('Milano');
  });

  it('refresh re-reads the saved location and searches again', async () => {
    (getLastSearchLocation as jest.Mock).mockResolvedValue({
      label: 'Milano',
      latitude: 45.4642,
      longitude: 9.19,
    });
    (fetchNearbyMatches as jest.Mock).mockResolvedValue([{ id: 'm1' }]);

    const { result } = await renderHook(() => useNearbyMatches());
    await waitFor(() => expect(result.current.matches).toHaveLength(1));

    (fetchNearbyMatches as jest.Mock).mockResolvedValue([{ id: 'm1' }, { id: 'm3' }]);

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.matches).toHaveLength(2);
    expect(fetchNearbyMatches).toHaveBeenCalledTimes(2);
  });

  it('refresh does nothing when no location has ever been saved', async () => {
    (getLastSearchLocation as jest.Mock).mockResolvedValue(null);

    const { result } = await renderHook(() => useNearbyMatches());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.refresh();
    });

    expect(fetchNearbyMatches).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Esegui i test per verificare che falliscano**

Run: `npx jest src/hooks/useNearbyMatches.test.ts` (dalla cartella `mobile/`)
Expected: FAIL — l'hook attuale non espone `locationLabel`/`searchLocation` e chiama ancora `expo-location`, non i nuovi moduli mockati.

- [ ] **Step 3: Riscrivi l'hook**

```ts
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

  async function searchLocation(query: string) {
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
  }

  async function refresh() {
    const saved = await getLastSearchLocation();
    if (saved) await fetchAt(saved);
  }

  return { matches, loading, error, locationLabel, searchLocation, refresh };
}
```

- [ ] **Step 4: Esegui i test per verificare che passino**

Run: `npx jest src/hooks/useNearbyMatches.test.ts` (dalla cartella `mobile/`)
Expected: PASS, 6/6

- [ ] **Step 5: Aggiorna la schermata Home**

Sostituisci l'intero contenuto di `mobile/app/(tabs)/home/index.tsx` con:

```tsx
// mobile/app/(tabs)/home/index.tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, StyleSheet, Pressable, TextInput, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useNearbyMatches } from '@/hooks/useNearbyMatches';
import { useNotifications } from '@/hooks/useNotifications';
import { useSessionStore } from '@/stores/sessionStore';
import { MatchCard } from '@/components/MatchCard';
import { colors, typography, spacing, withPressed } from '@/theme';

const MATCH_TYPES = [5, 7, 8] as const;

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { matches, loading, error, locationLabel, searchLocation, refresh } = useNearbyMatches();
  const { unreadCount, refresh: refreshNotifications } = useNotifications();
  const firstName = useSessionStore((state) => state.profile?.first_name);
  const [activeTypes, setActiveTypes] = useState<Set<number>>(new Set());
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    if (locationLabel) setSearchText(locationLabel);
  }, [locationLabel]);

  function toggleType(type: number) {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }

  // matches is already ordered nearest-to-farthest by the nearby_open_matches
  // RPC; .filter() preserves that order.
  const filteredMatches = useMemo(
    () => (activeTypes.size === 0 ? matches : matches.filter((match) => activeTypes.has(match.match_type))),
    [matches, activeTypes]
  );

  useFocusEffect(
    useCallback(() => {
      refresh();
      refreshNotifications();
    }, [refresh, refreshNotifications])
  );

  if (loading && !locationLabel) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      {firstName && <Text style={styles.greeting}>Ciao {firstName}</Text>}
      <View style={styles.headerRow}>
        <Text style={styles.header}>Partite vicino a te</Text>
        <Pressable
          style={styles.bellButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => router.push('/(tabs)/home/notifications')}
        >
          <Text style={styles.bellIcon}>🔔</Text>
          {unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
            </View>
          )}
        </Pressable>
      </View>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Cerca una città o un indirizzo"
          value={searchText}
          onChangeText={setSearchText}
          onSubmitEditing={() => searchLocation(searchText)}
          returnKeyType="search"
        />
        <Pressable
          style={withPressed(styles.searchButton)}
          disabled={!searchText || loading}
          onPress={() => searchLocation(searchText)}
        >
          <Text style={styles.searchButtonText}>Cerca</Text>
        </Pressable>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      {!locationLabel ? (
        <Text style={styles.subtitle}>Cerca una città per trovare le partite vicino a te.</Text>
      ) : (
        <>
          <View style={styles.filterRow}>
            {MATCH_TYPES.map((type) => {
              const active = activeTypes.has(type);
              return (
                <Pressable
                  key={type}
                  style={withPressed([styles.filterPill, active && styles.filterPillActive])}
                  onPress={() => toggleType(type)}
                >
                  <Text style={[styles.filterPillText, active && styles.filterPillTextActive]}>Calcio a {type}</Text>
                </Pressable>
              );
            })}
          </View>
          <FlatList
            data={filteredMatches}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const openMatch = () => router.push({ pathname: '/(tabs)/home/match/[id]', params: { id: item.id } });
              return (
                <Pressable onPress={openMatch}>
                  <MatchCard match={item} onPressJoin={openMatch} />
                </Pressable>
              );
            }}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
            ListEmptyComponent={
              <Text style={styles.subtitle}>
                {activeTypes.size > 0 && matches.length > 0
                  ? 'Nessuna partita di questo tipo trovata.'
                  : 'Nessuna partita trovata nella tua zona.'}
              </Text>
            }
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1 },
  greeting: { ...typography.label, fontSize: 16, color: colors.muted, paddingHorizontal: spacing.spaceMd, marginBottom: spacing.spaceXs },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.spaceMd,
    marginBottom: spacing.spaceSm,
  },
  header: typography.screenTitle,
  searchRow: {
    flexDirection: 'row',
    gap: spacing.spaceXs,
    paddingHorizontal: spacing.spaceMd,
    marginBottom: spacing.spaceSm,
  },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.radiusControl,
    padding: spacing.spaceSm,
    ...typography.body,
  },
  searchButton: {
    backgroundColor: colors.primary,
    borderRadius: spacing.radiusControl,
    paddingHorizontal: spacing.spaceMd,
    justifyContent: 'center',
  },
  searchButtonText: { color: colors.onPrimary, ...typography.label },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.spaceXs,
    paddingHorizontal: spacing.spaceMd,
    marginBottom: spacing.spaceSm,
  },
  filterPill: { borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusControl, paddingVertical: 6, paddingHorizontal: spacing.spaceSm },
  filterPillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterPillText: { color: colors.ink, ...typography.label, fontSize: 13 },
  filterPillTextActive: { color: colors.onPrimary },
  bellButton: { position: 'relative', padding: 4 },
  bellIcon: { fontSize: 22 },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: colors.danger,
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: colors.onPrimary, ...typography.caption },
  list: { paddingHorizontal: spacing.spaceMd, paddingBottom: spacing.spaceLg },
  centered: { backgroundColor: colors.background, flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.spaceLg, gap: spacing.spaceSm },
  subtitle: { color: colors.muted, textAlign: 'center', ...typography.body, paddingHorizontal: spacing.spaceMd, marginTop: spacing.spaceSm },
  error: { color: colors.danger, textAlign: 'center', paddingHorizontal: spacing.spaceMd, marginBottom: spacing.spaceSm },
});
```

Rispetto all'originale: rimossi il blocco `permissionDenied` a schermo intero e il blocco `error` a schermo intero (l'errore ora è un banner inline che non nasconde la lista); rimossi gli stili ormai inutilizzati `title`/`button`/`buttonText`; aggiunti `searchRow`/`searchInput`/`searchButton`/`searchButtonText` e lo stile `subtitle`/`error` aggiornati con padding orizzontale (prima vivevano solo dentro `styles.centered`, ora compaiono anche nel flusso normale della schermata).

- [ ] **Step 6: Verifica il typecheck**

Run: `npx tsc --noEmit` (dalla cartella `mobile/`)
Expected: nessun errore

- [ ] **Step 7: Esegui l'intera suite Jest per assicurarti di non aver rotto altri test**

Run: `npx jest` (dalla cartella `mobile/`)
Expected: PASS, nessuna regressione

- [ ] **Step 8: Commit**

```bash
git add mobile/src/hooks/useNearbyMatches.ts mobile/src/hooks/useNearbyMatches.test.ts "mobile/app/(tabs)/home/index.tsx"
git commit -m "feat: replace GPS with manual location search on the Home screen"
```

---

### Task 4: Fix del bug di geolocalizzazione alla creazione partita

Sostituisce il GPS con il geocoding del campo "Indirizzo" già esistente nel form. Hook e schermata cambiano insieme per la stessa ragione del Task 3 (`permissionDenied` distrutto dalla schermata).

**Files:**
- Modify: `mobile/src/hooks/useCreateMatch.ts`
- Modify: `mobile/src/hooks/useCreateMatch.test.ts` (riscrittura completa)
- Modify: `mobile/app/(tabs)/home/create-match.tsx`
- Modify: `mobile/src/api/matches.ts` (solo un commento)

**Interfaces:**
- Consumes: `geocodeAddress` (Task 1).
- Produces: `useCreateMatch()` ora ritorna `{ create, loading, error }` — **non più** `permissionDenied`.

- [ ] **Step 1: Riscrivi i test dell'hook (falliranno: l'hook non è ancora stato riscritto)**

```ts
// mobile/src/hooks/useCreateMatch.test.ts
import { renderHook, act } from '@testing-library/react-native';
import { router } from 'expo-router';
import { geocodeAddress } from '@/api/geocoding';
import { useCreateMatch } from './useCreateMatch';
import { createMatch } from '@/api/matches';
import { useSessionStore } from '@/stores/sessionStore';

jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('@/api/geocoding', () => ({ geocodeAddress: jest.fn() }));
jest.mock('@/api/matches', () => ({ createMatch: jest.fn() }));

const formValues = {
  matchType: 5 as const,
  fieldName: 'Campo Test',
  address: 'Via Test 1',
  matchDate: '2026-09-05',
  startTime: '19:00',
  endTime: '20:30',
  maxPlayers: '10',
  description: '',
};

describe('useCreateMatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSessionStore.setState({
      session: { user: { id: 'u1' } } as never,
      profile: null,
      status: 'signed-in',
    });
  });

  it('geocodes the typed address, creates the match with those coordinates, and navigates to its detail page', async () => {
    (geocodeAddress as jest.Mock).mockResolvedValue({ latitude: 45.4642, longitude: 9.19 });
    (createMatch as jest.Mock).mockResolvedValue({ id: 'm1' });

    // @testing-library/react-native@14's renderHook returns a Promise -- await it.
    const { result } = await renderHook(() => useCreateMatch());

    await act(async () => {
      await result.current.create(formValues);
    });

    expect(geocodeAddress).toHaveBeenCalledWith('Via Test 1');
    expect(createMatch).toHaveBeenCalledWith(
      expect.objectContaining({
        creator_id: 'u1',
        latitude: 45.4642,
        longitude: 9.19,
        field_name: 'Campo Test',
        max_players: 10,
      })
    );
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/(tabs)/home/match/[id]', params: { id: 'm1' } });
    expect(result.current.error).toBeNull();
  });

  it('sets an error and does not create a match when geocoding the address fails', async () => {
    (geocodeAddress as jest.Mock).mockRejectedValue(
      new Error('Località non trovata, prova a essere più specifico.')
    );

    const { result } = await renderHook(() => useCreateMatch());

    await act(async () => {
      await result.current.create(formValues);
    });

    expect(result.current.error).toBe('Località non trovata, prova a essere più specifico.');
    expect(createMatch).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('sets an error and does not navigate when creating the match fails', async () => {
    (geocodeAddress as jest.Mock).mockResolvedValue({ latitude: 45.4642, longitude: 9.19 });
    (createMatch as jest.Mock).mockRejectedValue(new Error('insert failed'));

    const { result } = await renderHook(() => useCreateMatch());

    await act(async () => {
      await result.current.create(formValues);
    });

    expect(result.current.error).toBe('insert failed');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('sets an error and does not attempt geocoding/creation when there is no session', async () => {
    useSessionStore.setState({ session: null, profile: null, status: 'signed-out' });

    const { result } = await renderHook(() => useCreateMatch());

    await act(async () => {
      await result.current.create(formValues);
    });

    expect(result.current.error).toBeTruthy();
    expect(geocodeAddress).not.toHaveBeenCalled();
    expect(createMatch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Esegui i test per verificare che falliscano**

Run: `npx jest src/hooks/useCreateMatch.test.ts` (dalla cartella `mobile/`)
Expected: FAIL — l'hook attuale chiama ancora `expo-location`, non `geocodeAddress`.

- [ ] **Step 3: Riscrivi l'hook**

```ts
// mobile/src/hooks/useCreateMatch.ts
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
```

- [ ] **Step 4: Esegui i test per verificare che passino**

Run: `npx jest src/hooks/useCreateMatch.test.ts` (dalla cartella `mobile/`)
Expected: PASS, 4/4

- [ ] **Step 5: Aggiorna la schermata di creazione partita**

Sostituisci l'intero contenuto di `mobile/app/(tabs)/home/create-match.tsx` con:

```tsx
// mobile/app/(tabs)/home/create-match.tsx
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MatchForm } from '@/components/MatchForm';
import { useCreateMatch } from '@/hooks/useCreateMatch';
import { colors, typography, spacing } from '@/theme';

export default function CreateMatchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { create, loading, error } = useCreateMatch();

  return (
    <View style={[styles.container, { paddingTop: insets.top + 24 }]}>
      <Pressable onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.backLink}>← Annulla</Text>
      </Pressable>
      <Text style={styles.title}>Crea partita</Text>
      <MatchForm onSubmit={create} submitLabel="Crea partita" loading={loading} error={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, paddingHorizontal: spacing.spaceLg },
  title: { ...typography.label, fontSize: 24, marginBottom: spacing.spaceXs },
  backLink: { color: colors.primary, marginBottom: spacing.spaceXs },
});
```

Rispetto all'originale: rimosso l'intero blocco "Attiva la posizione" a schermo intero (e con esso l'unico uso di `withPressed` e degli stili `centered`/`subtitle`/`button`/`buttonText` in questo file, quindi anche quelli vanno rimossi).

- [ ] **Step 6: Correggi il commento non più corretto in `matches.ts`**

In `mobile/src/api/matches.ts`, trova questo commento (sopra `MatchEditableFields`):

```ts
// Location is captured once at creation from the creator's device GPS and is
// never editable afterward in this MVP -- omitting lat/lng here makes that a
// compile-time guarantee for every updateMatch call site, not just a UI rule.
export type MatchEditableFields = Omit<NewMatch, 'creator_id' | 'latitude' | 'longitude'>;
```

Sostituiscilo con:

```ts
// Location is geocoded once at creation from the typed address and is never
// editable afterward in this MVP -- omitting lat/lng here makes that a
// compile-time guarantee for every updateMatch call site, not just a UI rule.
export type MatchEditableFields = Omit<NewMatch, 'creator_id' | 'latitude' | 'longitude'>;
```

Solo il commento cambia — il tipo `MatchEditableFields` resta byte-identico.

- [ ] **Step 7: Verifica il typecheck**

Run: `npx tsc --noEmit` (dalla cartella `mobile/`)
Expected: nessun errore

- [ ] **Step 8: Esegui l'intera suite Jest per assicurarti di non aver rotto altri test**

Run: `npx jest` (dalla cartella `mobile/`)
Expected: PASS, nessuna regressione

- [ ] **Step 9: Commit**

```bash
git add mobile/src/hooks/useCreateMatch.ts mobile/src/hooks/useCreateMatch.test.ts "mobile/app/(tabs)/home/create-match.tsx" mobile/src/api/matches.ts
git commit -m "fix: geocode the typed address instead of using the creator's GPS for match location"
```

---

### Task 5: Verifica manuale end-to-end

Nessun codice nuovo. Verifica che entrambi i flussi funzionino davvero contro il geocoder reale del sistema operativo (i mock di Jest non lo esercitano mai) e che i dati salvati siano corretti, non solo che la UI sembri giusta.

**Files:** nessuno (solo verifica).

- [ ] **Step 1: Avvia l'app in simulatore con Supabase locale attivo**

Segui il flusso di setup già stabilito per questo progetto (Metro sulla porta di default 8081, Docker/Supabase locale già avviati). Accedi con un utente di test esistente o creane uno nuovo.

- [ ] **Step 2: Verifica la ricerca in Home**

1. Alla primissima apertura (nessuna località mai cercata su questo dispositivo/simulatore): la Home mostra l'invito "Cerca una città per trovare le partite vicino a te", non la lista partite né nessuna richiesta di permesso di localizzazione.
2. Digita una città reale (es. "Milano") nel campo di ricerca e premi "Cerca": la lista si popola (o mostra "Nessuna partita trovata nella tua zona" se non ci sono partite create in quella zona nel DB locale — in tal caso, crea prima una partita di test con un indirizzo nella stessa città per avere un risultato da verificare).
3. Digita una stringa senza senso (es. "asdkjhasdkjhasdkjh") e premi "Cerca": appare l'errore "Località non trovata, prova a essere più specifico." sotto il campo di ricerca, **e la lista precedente (Milano) resta visibile sotto**, non sparisce.
4. Chiudi e riapri la Home (o naviga via e torna): la ricerca su Milano riparte da sola, senza dover ridigitare nulla.

- [ ] **Step 3: Verifica la creazione partita**

1. Vai su "Crea partita", compila il form con un indirizzo reale diverso dalla posizione fisica del Mac/simulatore (es. un indirizzo a Roma, anche se il simulatore non si trova lì).
2. Invia il form: la partita viene creata e si naviga al suo dettaglio senza errori né richieste di permesso di posizione.
3. Verifica direttamente sul database (query SQL diretta, non solo la UI) che `matches.latitude`/`matches.longitude` della partita appena creata corrispondano alle coordinate reali dell'indirizzo digitato (Roma, non la posizione del simulatore/Mac).
4. Prova a creare una partita con un indirizzo senza senso: il submit fallisce con lo stesso errore "Località non trovata, prova a essere più specifico.", mostrato dal form, e nessuna partita viene creata nel DB.

- [ ] **Step 4: Registra l'esito**

Se emergono problemi non coperti dai test automatici (rendering, UX, un caso limite del geocoder reale), annotali e decidi con il proprio giudizio se vanno risolti prima di considerare il piano completo o se possono essere annotati come follow-up — non c'è un passo di commit qui, dato che non c'è codice da salvare.
