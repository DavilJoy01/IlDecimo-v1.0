# Integrazione mappa (Home + dettaglio partita) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrare le partite come pin su una mappa in due punti dell'app — un toggle lista/mappa nei risultati di ricerca della Home, e un riquadro mappa con pulsante "Indicazioni" nel dettaglio partita.

**Architecture:** `react-native-maps` con un componente condiviso `MatchMapView` (Home = più pin, dettaglio = un pin singolo), alimentato da coordinate già esistenti nel DB (`matches.latitude`/`longitude`) — l'unica modifica backend è estendere la RPC `nearby_open_matches` per restituirle. Tutta la logica non banale (calcolo della regione mappa, URL di indicazioni) è estratta in funzioni pure testabili con Jest senza montare la libreria mappa.

**Tech Stack:** React Native / Expo Router (mobile), Supabase/Postgres (RPC), `react-native-maps` (nuova dipendenza nativa).

**Spec:** [docs/superpowers/specs/2026-09-14-integrazione-mappa-design.md](../specs/2026-09-14-integrazione-mappa-design.md)

## Global Constraints

- Libreria: `react-native-maps`, non `expo-maps` (alpha, breaking changes frequenti).
- Provider: Apple Maps su iOS (nessuna chiave), `PROVIDER_GOOGLE` esplicito su Android (richiede una API key fornita dall'utente, non creabile dall'assistente).
- Nessuna posizione GPS dell'utente mostrata in nessun punto — nessun nuovo permesso di localizzazione runtime.
- Nessun nuovo geocoding: le coordinate usate esistono già in `matches.latitude`/`matches.longitude`.
- Home: tap su un pin apre direttamente il dettaglio partita (nessun callout intermedio). Toggle lista/mappa non persistito tra le aperture della schermata.
- Dettaglio partita: mappa interattiva (pan/zoom liberi) + pulsante "Indicazioni" che apre l'app Mappe di sistema via deep-link, nessuna Directions API.
- `mobile/AGENTS.md` impone di verificare la documentazione Expo v57.0.0 esatta prima di scrivere codice che tocca l'SDK.

---

### Task 1: `regionForPins` — calcolo della regione mappa

**Files:**
- Create: `mobile/src/utils/mapRegion.ts`
- Test: `mobile/src/utils/mapRegion.test.ts`

**Interfaces:**
- Produces: `interface MapPin { id: string; latitude: number; longitude: number }`, `interface MapRegion { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number }`, `function regionForPins(pins: MapPin[]): MapRegion`. Usato da Task 4 (`MatchMapView`).

- [ ] **Step 1: Write the failing tests**

```ts
// mobile/src/utils/mapRegion.test.ts
import { regionForPins } from './mapRegion';

describe('regionForPins', () => {
  it('centers on the single pin with the minimum delta when there is only one', () => {
    const region = regionForPins([{ id: 'm1', latitude: 45.4642, longitude: 9.19 }]);
    expect(region.latitude).toBe(45.4642);
    expect(region.longitude).toBe(9.19);
    expect(region.latitudeDelta).toBe(0.05);
    expect(region.longitudeDelta).toBe(0.05);
  });

  it('centers between two pins and scales the delta to their spread, with padding', () => {
    const region = regionForPins([
      { id: 'm1', latitude: 45.0, longitude: 9.0 },
      { id: 'm2', latitude: 46.0, longitude: 10.0 },
    ]);
    expect(region.latitude).toBe(45.5);
    expect(region.longitude).toBe(9.5);
    expect(region.latitudeDelta).toBeCloseTo(1.4, 5);
    expect(region.longitudeDelta).toBeCloseTo(1.4, 5);
  });

  it('clamps the delta to the minimum when pins are very close together', () => {
    const region = regionForPins([
      { id: 'm1', latitude: 45.0, longitude: 9.0 },
      { id: 'm2', latitude: 45.0001, longitude: 9.0001 },
    ]);
    expect(region.latitudeDelta).toBe(0.05);
    expect(region.longitudeDelta).toBe(0.05);
  });

  it('falls back to a default region centered on Rome when there are no pins', () => {
    const region = regionForPins([]);
    expect(region.latitude).toBe(41.9028);
    expect(region.longitude).toBe(12.4964);
    expect(region.latitudeDelta).toBe(0.05);
    expect(region.longitudeDelta).toBe(0.05);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `mobile/`): `npx jest src/utils/mapRegion.test.ts`
Expected: FAIL with "Cannot find module './mapRegion'"

- [ ] **Step 3: Write the implementation**

```ts
// mobile/src/utils/mapRegion.ts
export interface MapPin {
  id: string;
  latitude: number;
  longitude: number;
}

export interface MapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

const MIN_DELTA = 0.05;
const PADDING_FACTOR = 1.4;
const DEFAULT_REGION: MapRegion = {
  latitude: 41.9028,
  longitude: 12.4964,
  latitudeDelta: MIN_DELTA,
  longitudeDelta: MIN_DELTA,
};

export function regionForPins(pins: MapPin[]): MapRegion {
  if (pins.length === 0) return DEFAULT_REGION;

  const latitudes = pins.map((pin) => pin.latitude);
  const longitudes = pins.map((pin) => pin.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * PADDING_FACTOR, MIN_DELTA),
    longitudeDelta: Math.max((maxLng - minLng) * PADDING_FACTOR, MIN_DELTA),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/utils/mapRegion.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add mobile/src/utils/mapRegion.ts mobile/src/utils/mapRegion.test.ts
git commit -m "feat: add regionForPins for computing a map's initial region"
```

---

### Task 2: `mapLinks` — URL di indicazioni stradali

**Files:**
- Create: `mobile/src/utils/mapLinks.ts`
- Test: `mobile/src/utils/mapLinks.test.ts`

**Interfaces:**
- Produces: `function directionsUrl(latitude: number, longitude: number): string`, `function openDirections(latitude: number, longitude: number): Promise<void>`. Usato da Task 6 (dettaglio partita).

- [ ] **Step 1: Write the failing tests**

```ts
// mobile/src/utils/mapLinks.test.ts
import { Platform, Linking } from 'react-native';
import { directionsUrl, openDirections } from './mapLinks';

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Linking: { openURL: jest.fn() },
}));

describe('directionsUrl', () => {
  afterEach(() => {
    Platform.OS = 'ios';
  });

  it('builds an Apple Maps URL on iOS', () => {
    Platform.OS = 'ios';
    expect(directionsUrl(45.4642, 9.19)).toBe('https://maps.apple.com/?daddr=45.4642,9.19');
  });

  it('builds a Google Maps directions URL on Android', () => {
    Platform.OS = 'android';
    expect(directionsUrl(45.4642, 9.19)).toBe('https://www.google.com/maps/dir/?api=1&destination=45.4642,9.19');
  });
});

describe('openDirections', () => {
  afterEach(() => jest.clearAllMocks());

  it('opens the directions URL for the given coordinates', async () => {
    Platform.OS = 'ios';
    await openDirections(45.4642, 9.19);
    expect(Linking.openURL).toHaveBeenCalledWith('https://maps.apple.com/?daddr=45.4642,9.19');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/utils/mapLinks.test.ts`
Expected: FAIL with "Cannot find module './mapLinks'"

- [ ] **Step 3: Write the implementation**

```ts
// mobile/src/utils/mapLinks.ts
import { Platform, Linking } from 'react-native';

export function directionsUrl(latitude: number, longitude: number): string {
  return Platform.OS === 'ios'
    ? `https://maps.apple.com/?daddr=${latitude},${longitude}`
    : `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
}

export async function openDirections(latitude: number, longitude: number): Promise<void> {
  await Linking.openURL(directionsUrl(latitude, longitude));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/utils/mapLinks.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add mobile/src/utils/mapLinks.ts mobile/src/utils/mapLinks.test.ts
git commit -m "feat: add directionsUrl/openDirections for opening system Maps"
```

---

### Task 3: Backend — `nearby_open_matches` restituisce le coordinate

**Files:**
- Create: `supabase/migrations/20260914010000_add_coordinates_to_nearby_open_matches.sql`
- Modify: `supabase/tests/013_nearby_open_matches.test.sql`
- Modify: `mobile/src/api/matches.ts` (interfaccia `NearbyMatch`)

**Interfaces:**
- Consumes: nessuna (colonne `matches.latitude`/`matches.longitude` già esistenti, invariate).
- Produces: `NearbyMatch` guadagna `latitude: number` e `longitude: number`. Usato da Task 5 (Home).

- [ ] **Step 1: Write the failing pgTAP assertions**

Apri `supabase/tests/013_nearby_open_matches.test.sql` e cambia `select plan(6);` in `select plan(8);`, poi aggiungi queste due asserzioni subito dopo quella su `field_name` (dopo il blocco `'the nearby match is correctly identified'`):

```sql
select is(
  (select latitude from public.nearby_open_matches(38.1157, 13.3615, 20) limit 1),
  38.1157,
  'the nearby match returns its stored latitude'
);

select is(
  (select longitude from public.nearby_open_matches(38.1157, 13.3615, 20) limit 1),
  13.3615,
  'the nearby match returns its stored longitude'
);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (da `supabase/`): `npx supabase test db`
Expected: FAIL — `column "latitude" does not exist` (la funzione non restituisce ancora quella colonna)

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260914010000_add_coordinates_to_nearby_open_matches.sql
create or replace function public.nearby_open_matches(user_lat double precision, user_lng double precision, radius_km double precision default 20)
returns table(
  id uuid,
  field_name text,
  match_type integer,
  match_date date,
  start_time time,
  end_time time,
  max_players integer,
  distance_km double precision,
  approved_players_count bigint,
  latitude double precision,
  longitude double precision
)
language sql
stable security definer
set search_path to 'extensions'
as $$
  select
    m.id,
    m.field_name,
    m.match_type,
    m.match_date,
    m.start_time,
    m.end_time,
    m.max_players,
    round((ST_Distance(m.location, ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography) / 1000)::numeric, 2)::double precision as distance_km,
    (select count(*) from public.match_participants mp where mp.match_id = m.id and mp.status in ('approved','active')) as approved_players_count,
    m.latitude,
    m.longitude
  from public.matches m
  where m.status = 'open'
    and m.creator_id != auth.uid()
    and ST_DWithin(m.location, ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography, radius_km * 1000)
  order by distance_km asc;
$$;
```

`create or replace function` con la stessa firma preserva i `grant`/`revoke` già applicati (nessuna nuova riga di permessi necessaria).

- [ ] **Step 4: Apply the migration and run the tests to verify they pass**

`npx supabase test db` da solo non è garantito riapplichi una migrazione nuova (osservato in una sessione precedente di questo stesso progetto) — esegui prima un reset esplicito:

Run (da `supabase/`):
```bash
npx supabase db reset
npx supabase test db
```
Expected: PASS, `Files=27, Tests=192` (192 = 190 attuali + 2 nuove)

- [ ] **Step 5: Update the TypeScript interface**

In `mobile/src/api/matches.ts`, modifica `NearbyMatch`:

```ts
export interface NearbyMatch {
  id: string;
  field_name: string;
  match_type: 5 | 7 | 8;
  match_date: string;
  start_time: string;
  end_time: string;
  max_players: number;
  distance_km: number;
  approved_players_count: number;
  latitude: number;
  longitude: number;
}
```

- [ ] **Step 6: Run the mobile test suite and typecheck to verify nothing broke**

Run (da `mobile/`): `npm test -- --watchAll=false && npm run typecheck`
Expected: PASS — i test esistenti mockano `fetchNearbyMatches` con `jest.Mock`, che non applica il tipo `NearbyMatch` ai valori di mock, quindi nessuna modifica di test è necessaria qui.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260914010000_add_coordinates_to_nearby_open_matches.sql supabase/tests/013_nearby_open_matches.test.sql mobile/src/api/matches.ts
git commit -m "feat: return match coordinates from nearby_open_matches"
```

---

### Task 4: Dipendenza `react-native-maps` + componente condiviso `MatchMapView`

**Files:**
- Modify: `mobile/package.json` (nuova dipendenza)
- Create: `mobile/app.config.js`
- Modify: `mobile/.env.local.example`
- Create: `mobile/src/components/MatchMapView.tsx`

**Interfaces:**
- Consumes: `regionForPins`/`MapPin` da Task 1 (`@/utils/mapRegion`).
- Produces: `MatchMapView({ pins, onPressPin?, style? })`. Usato da Task 5 (Home) e Task 6 (dettaglio partita).

Questo task non segue il ciclo TDD stretto degli altri: `react-native-maps` è una libreria nativa, non montabile/mockabile in modo significativo in Jest, e questo progetto non scrive test di componente per le schermate/i componenti UI (`MatchForm`/`ProfileForm` non ne hanno) — la verifica reale arriva dalla build nativa e dal Task 7 (verifica manuale).

- [ ] **Step 1: Install the dependency**

Run (da `mobile/`):
```bash
npx expo install react-native-maps
```

- [ ] **Step 2: Add the Google Maps API key placeholder**

In `mobile/.env.local.example`, aggiungi una riga (senza valore — il file esistente già documenta le chiavi attese senza contenerle davvero):

```
GOOGLE_MAPS_API_KEY_ANDROID=
```

Aggiungi la stessa riga (con o senza valore reale, a seconda se l'utente l'ha già fornita) al proprio `mobile/.env.local` locale, non tracciato da git.

- [ ] **Step 3: Add a dev dependency to read `.env.local` at config time**

Run (da `mobile/`):
```bash
npm install --save-dev dotenv
```

Verifica prima nella documentazione Expo v57.0.0 (`mobile/AGENTS.md` lo impone) se Expo CLI carica già `.env.local` per variabili non prefissate `EXPO_PUBLIC_` prima di valutare `app.config.js` durante `expo prebuild`/`expo run:ios` — se sì, questo step e il `require('dotenv')` nello step successivo sono superflui e vanno rimossi per non duplicare il caricamento. Se la documentazione non lo conferma esplicitamente (era il caso alla stesura di questa spec), procedi con `dotenv` per non dipendere da un comportamento non documentato.

- [ ] **Step 4: Create `app.config.js`**

`app.json` resta invariato (contiene tutta la configurazione statica esistente). `app.config.js` lo estende dinamicamente con il plugin `react-native-maps`, che ha bisogno di un valore risolto a tempo di prebuild (non esprimibile in un JSON statico):

```js
// mobile/app.config.js
require('dotenv').config({ path: '.env.local' });

module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ...config.plugins,
    [
      'react-native-maps',
      { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY_ANDROID },
    ],
  ],
});
```

- [ ] **Step 5: Verify the config resolves correctly**

Run (da `mobile/`): `npx expo config --json | grep -A3 react-native-maps`
Expected: mostra la voce del plugin appena aggiunta con `androidGoogleMapsApiKey` valorizzato (stringa vuota se `.env.local` non ha ancora la chiave reale — accettabile in questa fase, la mappa Android non funzionerà finché l'utente non la fornisce, ma il config stesso deve risolvere senza errori)

- [ ] **Step 6: Write `MatchMapView`**

```tsx
// mobile/src/components/MatchMapView.tsx
import { Platform, type ViewStyle } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { regionForPins, type MapPin } from '@/utils/mapRegion';

export type { MapPin };

interface MatchMapViewProps {
  pins: MapPin[];
  onPressPin?: (id: string) => void;
  style?: ViewStyle;
}

export function MatchMapView({ pins, onPressPin, style }: MatchMapViewProps) {
  return (
    <MapView style={style} provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined} initialRegion={regionForPins(pins)}>
      {pins.map((pin) => (
        <Marker
          key={pin.id}
          coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
          onPress={() => onPressPin?.(pin.id)}
        />
      ))}
    </MapView>
  );
}
```

- [ ] **Step 7: Typecheck**

Run (da `mobile/`): `npm run typecheck`
Expected: pulito (nessun nuovo errore)

- [ ] **Step 8: Commit**

```bash
git add mobile/package.json mobile/package-lock.json mobile/app.config.js mobile/.env.local.example mobile/src/components/MatchMapView.tsx
git commit -m "feat: add react-native-maps dependency and MatchMapView component"
```

---

### Task 5: Home — toggle lista/mappa

**Files:**
- Modify: `mobile/app/(tabs)/home/index.tsx`

**Interfaces:**
- Consumes: `MatchMapView`/`MapPin` da Task 4, `NearbyMatch.latitude`/`longitude` da Task 3.

Nessun file di test per questo screen (coerente con l'assenza di test di componente in questo progetto) — verificato manualmente nel Task 7.

- [ ] **Step 1: Add the import and view-mode state**

In `mobile/app/(tabs)/home/index.tsx`, aggiungi l'import subito dopo quello di `MatchCard`:

```tsx
import { MatchMapView } from '@/components/MatchMapView';
```

Dentro `HomeScreen`, subito dopo `const [searchText, setSearchText] = useState('');`:

```tsx
const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
```

- [ ] **Step 2: Add the toggle button next to the bell**

Sostituisci l'intero blocco `headerRow` esistente:

```tsx
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
```

con:

```tsx
<View style={styles.headerRow}>
  <Text style={styles.header}>Partite vicino a te</Text>
  <View style={styles.headerActions}>
    {locationLabel && (
      <Pressable
        style={styles.viewToggleButton}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        onPress={() => setViewMode((mode) => (mode === 'list' ? 'map' : 'list'))}
      >
        <Text style={styles.viewToggleIcon}>{viewMode === 'list' ? '🗺️' : '📋'}</Text>
      </Pressable>
    )}
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
</View>
```

Il toggle compare solo quando c'è già una `locationLabel` (una ricerca già fatta) — non ha senso passare a una mappa vuota prima che l'utente abbia cercato una città.

- [ ] **Step 3: Render the map when `viewMode === 'map'`**

Sostituisci il blocco:

```tsx
{!locationLabel ? (
  <Text style={styles.subtitle}>Cerca una città per trovare le partite vicino a te.</Text>
) : (
  <>
    <View style={styles.filterRow}>
```

con:

```tsx
{!locationLabel ? (
  <Text style={styles.subtitle}>Cerca una città per trovare le partite vicino a te.</Text>
) : viewMode === 'map' ? (
  <MatchMapView
    pins={filteredMatches.map((match) => ({ id: match.id, latitude: match.latitude, longitude: match.longitude }))}
    onPressPin={(id) => router.push({ pathname: '/(tabs)/home/match/[id]', params: { id } })}
    style={styles.map}
  />
) : (
  <>
    <View style={styles.filterRow}>
```

(il resto del blocco `<>...</>` con `filterRow` e `FlatList` resta invariato, solo la condizione che lo introduce cambia)

- [ ] **Step 4: Add the new styles**

Nel blocco `styles`, subito dopo `bellButton: { position: 'relative', padding: 4 },`, aggiungi:

```ts
headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.spaceSm },
viewToggleButton: { padding: 4 },
viewToggleIcon: { fontSize: 20 },
map: { flex: 1 },
```

- [ ] **Step 5: Typecheck**

Run (da `mobile/`): `npm run typecheck`
Expected: pulito

- [ ] **Step 6: Commit**

```bash
git add "mobile/app/(tabs)/home/index.tsx"
git commit -m "feat: add list/map toggle to Home search results"
```

---

### Task 6: Dettaglio partita — mappa + pulsante Indicazioni

**Files:**
- Modify: `mobile/app/(tabs)/home/match/[id]/index.tsx`

**Interfaces:**
- Consumes: `MatchMapView` da Task 4, `openDirections` da Task 2.

- [ ] **Step 1: Add the imports**

In `mobile/app/(tabs)/home/match/[id]/index.tsx`, aggiungi dopo l'import di `ParticipantRow`:

```tsx
import { MatchMapView } from '@/components/MatchMapView';
import { openDirections } from '@/utils/mapLinks';
```

- [ ] **Step 2: Insert the map and directions button**

Sostituisci:

```tsx
      <Text style={styles.meta}>📍 {match.address}</Text>
      <Text style={styles.meta}>
```

con:

```tsx
      <Text style={styles.meta}>📍 {match.address}</Text>
      <MatchMapView
        pins={[{ id: match.id, latitude: match.latitude, longitude: match.longitude }]}
        style={styles.detailMap}
      />
      <Pressable
        style={withPressed(styles.directionsButton)}
        onPress={() => openDirections(match.latitude, match.longitude)}
      >
        <Text style={styles.directionsButtonText}>Indicazioni</Text>
      </Pressable>
      <Text style={styles.meta}>
```

- [ ] **Step 3: Add the new styles**

Nel blocco `styles` (dopo `meta: { color: colors.ink, ...typography.body },`), aggiungi:

```ts
detailMap: { height: 180, borderRadius: spacing.radiusCard, overflow: 'hidden', marginTop: spacing.spaceXs },
directionsButton: { backgroundColor: colors.primaryTint, borderRadius: spacing.radiusControl, paddingVertical: 10, alignItems: 'center', marginTop: spacing.spaceXs },
directionsButtonText: { color: colors.primary, ...typography.label, fontSize: 15 },
```

- [ ] **Step 4: Typecheck**

Run (da `mobile/`): `npm run typecheck`
Expected: pulito

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/(tabs)/home/match/[id]/index.tsx"
git commit -m "feat: show a map and directions button on the match detail screen"
```

---

### Task 7: Build nativo e verifica manuale live

**Files:** nessuno (solo verifica)

**Interfaces:** nessuna — task terminale.

- [ ] **Step 1: Full test suite**

Run (da `mobile/`): `npm test -- --watchAll=false && npm run typecheck`
Expected: tutti i test passano, typecheck pulito

Run (da `supabase/`): `npx supabase test db`
Expected: tutti gli assert passano (192, come nel Task 3)

- [ ] **Step 2: Native rebuild**

Run (da `mobile/`): `npx expo prebuild --platform ios && npx expo run:ios --device <simulatore>`

Aspettati di dover ridiagnosticare bug di build nativi già documentati in `project_ios_simulator_devclient_freeze` (ExpoModulesJSI codesign, spazio nel path "app calcio") — non sono regressioni di questo lavoro, sono lo stesso profilo di rischio già incontrato con `expo-notifications` in questa stessa sessione. Applica le stesse correzioni già note prima di assumere che sia un problema nuovo.

- [ ] **Step 3: Manual verification — Home**

Sul simulatore: cerca una città con risultati noti, tocca il pulsante toggle mappa/lista, verifica che compaiano i pin nelle posizioni corrette, tocca un pin e verifica che apra il dettaglio partita corretto. Torna alla lista col toggle e verifica che i filtri per tipo partita continuino a funzionare e che passando di nuovo alla mappa mostrino solo i pin filtrati.

- [ ] **Step 4: Manual verification — dettaglio partita**

Apri il dettaglio di una partita esistente, verifica che la mappa mostri il pin nella posizione corretta (confrontala con l'indirizzo testuale sopra), tocca "Indicazioni" e verifica che si apra l'app Mappe di sistema con la destinazione già impostata.

- [ ] **Step 5: Report Android status**

Se l'utente ha fornito una API key Google Maps reale in `.env.local`, ripeti gli step 3-4 su un emulatore Android. Se la chiave non è ancora disponibile, riporta esplicitamente questo come limite noto della verifica — non affermare che Android funziona senza averlo visto.
