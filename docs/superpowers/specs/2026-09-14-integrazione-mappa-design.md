# Integrazione mappa (Home + dettaglio partita) — Design Spec

## 1. Goal and scope

L'app oggi non mostra mai una mappa: la ricerca partite in Home e il dettaglio partita sono entrambi puramente testuali (piano `ricerca-manuale-localita`, che ha deliberatamente rimosso ogni uso del GPS). L'MVP spec menziona genericamente "Google Maps" tra i requisiti; l'audit del 2026-09-12 l'ha segnalata come mancante — è l'ultimo gap rimasto insieme alla copertura E2E dei flussi multi-utente.

Decisioni prese in brainstorming, tutte esplicite e non di default:

- **Libreria: `react-native-maps`**, non il pacchetto ufficiale `expo-maps` — quest'ultimo è in stato **alpha con breaking changes frequenti** secondo la documentazione Expo SDK 57 stessa, un rischio concreto per un progetto che già soffre di fragilità nelle build native. `react-native-maps` è di terze parti ma maturo, stabile da anni, con un config plugin Expo ufficialmente supportato.
- **Provider: Apple Maps su iOS (default, nessuna chiave), Google Maps esplicito su Android** (`PROVIDER_GOOGLE`) — Android richiede comunque una API key Google Cloud che l'utente configurerà lui stesso (voce fuori dal controllo dell'assistente: creare account/progetto Google Cloud è un'azione con credenziali).
- **Ambito: due punti dell'app**, entrambi che leggono coordinate già presenti nel DB, nessuna nuova capacità di geocoding:
  1. **Home** — toggle lista/mappa sui risultati di "Partite vicino a te": un pulsante passa dalla lista testuale attuale a una mappa a schermo intero con gli stessi risultati come pin.
  2. **Dettaglio partita** — un riquadro mappa sotto l'indirizzo testuale attuale (che resta, non viene sostituito), con un solo pin sul campo.
- **Nessuna posizione GPS dell'utente mostrata in nessun punto** — coerente con la scelta già fatta in `ricerca-manuale-localita` di eliminare il GPS dall'app. Nessun nuovo permesso di localizzazione runtime richiesto da questo lavoro.
- **Home: tap su un pin apre direttamente il dettaglio partita** — nessun fumetto/callout intermedio.
- **Dettaglio partita: mappa interattiva** (pan/zoom liberi) **più un pulsante "Indicazioni"** che apre l'app Mappe di sistema (Apple/Google Maps già installata) con il percorso pre-impostato verso il campo, tramite un semplice deep-link URL — non richiede nessuna API aggiuntiva (Directions API) per il calcolo del percorso.
- **Il toggle lista/mappa in Home non è persistente**: si riparte sempre dalla vista lista a ogni apertura della schermata.

Fuori ambito: mappa nella creazione partita (resta la conferma testuale attuale, piano `conferma-posizione-partita`); qualunque forma di geocoding nuovo (le coordinate esistono già in `matches.latitude`/`matches.longitude`); clustering dei pin per grandi quantità di risultati (il raggio di ricerca fisso a 20km rende improbabile un numero di pin che lo renda necessario, si può aggiungere in futuro se serve); mostrare la posizione GPS dell'utente; qualunque forma di ricerca/filtro sulla mappa stessa (i filtri esistenti per tipo partita restano solo nella vista lista — vedi §4.3).

## 2. Dipendenza nuova e configurazione nativa

**Prima vera dipendenza nativa aggiunta in questa sessione dopo `expo-notifications`** (che ha già richiesto di ridiagnosticare due bug di build nativi già documentati in `project_ios_simulator_devclient_freeze`) — va messo in conto lo stesso lavoro di debug, non solo la scrittura di codice.

```bash
npx expo install react-native-maps
```

`app.json`, aggiunta al `plugins` array esistente:

```json
[
  "react-native-maps",
  {
    "androidGoogleMapsApiKey": "process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY"
  }
]
```

Nessuna chiave iOS nel plugin: iOS userà Apple Maps di default (nessun `provider` esplicito passato al componente su quella piattaforma), quindi il plugin non ha bisogno di `iosGoogleMapsApiKey`.

**Nota per l'implementazione**: questo progetto usa oggi un `app.json` statico, non un `app.config.js` dinamico — la sostituzione `process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` nel plugin richiede che Expo la risolva a tempo di prebuild, il che tipicamente richiede convertire (o affiancare) `app.json` in `app.config.js` per poter leggere `.env.local` in quel momento. La chiave stessa va in `.env.local` (già gitignored in questo progetto) e **mai committata** — l'utente dovrà procurarsela da Google Cloud Console e incollarla lì. I dettagli esatti di questa conversione config vanno decisi nel piano di implementazione, verificando la documentazione Expo v57.0.0 su config dinamica (`mobile/AGENTS.md` impone di leggere la documentazione versionata esatta prima di scrivere codice).

## 3. Backend — estendere `nearby_open_matches` con le coordinate

La RPC che alimenta la Home oggi non restituisce `latitude`/`longitude` (solo `id`, `field_name`, `match_type`, `match_date`, `start_time`, `end_time`, `max_players`, `distance_km`, `approved_players_count`) — servono per posizionare i pin. Le colonne esistono già su `matches` (non è un nuovo dato, solo una nuova colonna nel `SELECT`), quindi è una migrazione minima, senza modificare la logica di filtro/ordinamento esistente:

```sql
-- supabase/migrations/<timestamp>_add_coordinates_to_nearby_open_matches.sql
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

`mobile/src/api/matches.ts`, `NearbyMatch` guadagna i due campi:

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

Il dettaglio partita non ha bisogno di alcuna modifica backend: `fetchMatchById` fa già `select()` (tutte le colonne), quindi `match.latitude`/`match.longitude` sono già disponibili lato client oggi.

Test pgTAP: estendere `013_nearby_open_matches.test.sql` con un'asserzione che verifica che le coordinate restituite corrispondano a quelle salvate sulla riga `matches` di test, seguendo lo stile `is(...)` già usato nel resto del file.

## 4. Componente condiviso `MatchMapView`

```ts
// mobile/src/components/MatchMapView.tsx
import { Platform } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';

export interface MapPin {
  id: string;
  latitude: number;
  longitude: number;
}

interface MatchMapViewProps {
  pins: MapPin[];
  onPressPin?: (id: string) => void;
  style?: object;
}

export function MatchMapView({ pins, onPressPin, style }: MatchMapViewProps) {
  return (
    <MapView
      style={style}
      provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
      initialRegion={regionForPins(pins)}
    >
      {pins.map((pin) => (
        <Marker key={pin.id} coordinate={pin} onPress={() => onPressPin?.(pin.id)} />
      ))}
    </MapView>
  );
}
```

Un'unica funzione pura `regionForPins` (in `mobile/src/utils/`, quindi testabile con Jest senza montare `react-native-maps`) calcola la regione iniziale che contiene tutti i pin con un margine, oppure una regione di default centrata sul primo/unico pin quando ce n'è solo uno (caso del dettaglio partita) — nessun bisogno di `fitToCoordinates` via ref/`onMapReady` per il caso comune, più semplice da testare.

Questo componente è usato in due modalità:
- **Home**: `pins` = tutti i risultati filtrati correnti, `onPressPin` naviga al dettaglio.
- **Dettaglio partita**: `pins` = un array con un solo elemento (le coordinate della partita), nessun `onPressPin`.

## 5. Home — toggle lista/mappa

`app/(tabs)/home/index.tsx`: un nuovo pulsante icona (mappa/lista) nella `headerRow` esistente, accanto alla campanella notifiche. Uno stato locale `viewMode: 'list' | 'map'` (default `'list'`, non persistito). Quando `viewMode === 'map'`, il blocco che oggi renderizza `filterRow` + `FlatList` viene sostituito da `<MatchMapView pins={filteredMatches.map(toPin)} onPressPin={openMatch} style={styles.map} />` a schermo intero (i pulsanti filtro tipo-partita restano visibili solo in modalità lista, per non affollare la mappa — l'utente può sempre tornare alla lista per filtrare, poi passare alla mappa per vedere il sottoinsieme filtrato, dato che `filteredMatches` è condiviso tra le due viste).

`toPin` è una funzione pura `(match: NearbyMatch) => MapPin`, banale da testare insieme a `regionForPins`.

## 6. Dettaglio partita — mappa + indicazioni

`app/(tabs)/home/match/[id]/index.tsx`, subito sotto la riga `📍 {match.address}` esistente:

```tsx
<MatchMapView
  pins={[{ id: match.id, latitude: match.latitude, longitude: match.longitude }]}
  style={styles.detailMap}
/>
<Pressable style={withPressed(styles.directionsButton)} onPress={openDirections}>
  <Text style={styles.directionsButtonText}>Indicazioni</Text>
</Pressable>
```

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

`directionsUrl` è pura e testabile con Jest per entrambe le piattaforme (mockando `Platform.OS`); `openDirections` stessa è banale e non necessita di test oltre a quelli che già coprono la costruzione dell'URL.

## 7. Strategia di test

- **Jest**: `regionForPins`, `toPin`, `directionsUrl` — tutta logica pura, senza toccare `react-native-maps` nei test (la libreria stessa non va mockata/montata, coerente con l'assenza di test di componente in questo progetto per schermate/componenti UI).
- **pgTAP**: estensione di `013_nearby_open_matches.test.sql` per le nuove colonne `latitude`/`longitude` nel `RETURNS TABLE`.
- **Verifica manuale live** (obbligatoria, non sostituibile da Jest per una libreria di mappe): toggle lista/mappa in Home con risultati reali, tap su un pin che apre il dettaglio corretto, mappa nel dettaglio partita che mostra il pin nel posto giusto, pulsante "Indicazioni" che apre l'app Mappe di sistema con la destinazione corretta — su iOS Simulator (Apple Maps) come minimo; Android resta da verificare quando/se l'utente fornisce la API key Google e un emulatore Android è disponibile in questa sessione.

## 8. Rischi noti

- **Rischio di build nativo**: prima vera dipendenza nativa dopo `expo-notifications`, stesso profilo di rischio già documentato in `project_ios_simulator_devclient_freeze` (ExpoModulesJSI codesign, spazio nel path "app calcio", possibili nuovi bug di quoting mai visti prima con questo specifico pacchetto).
- **Google Maps API key**: azione che richiede l'utente (creazione progetto/chiave su Google Cloud Console) — l'assistente non può crearla. Fino a quel momento, la mappa Android resterà non funzionante o non testabile; la spec non blocca il lavoro iOS in attesa di questo.
- **`app.json` → `app.config.js`**: la conversione (o l'aggiunta di un meccanismo equivalente) per iniettare la API key a tempo di prebuild è un dettaglio implementativo non ancora finalizzato — va risolto nel piano, verificando la documentazione Expo v57.0.0 esatta prima di scrivere codice, come impone `mobile/AGENTS.md`.
