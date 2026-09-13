# Ricerca partite per località (senza GPS) — Design Spec

## 1. Goal and scope

Oggi la Home ("Partite vicino a te") legge la posizione GPS live del dispositivo (`expo-location`, `getCurrentPositionAsync`) per cercare partite nel raggio di 20km. La creazione di una partita fa la stessa cosa per salvare la posizione della partita stessa, **ignorando il campo "Indirizzo" che l'utente digita nel form** — un bug già noto, mai risolto, individuato durante l'audit MVP del 2026-09-12.

Decisioni prese in brainstorming, tutte esplicite e non di default:
- **Nessun GPS/posizione in tempo reale, in nessun punto dell'app.** Sostituito ovunque da ricerca manuale per città/indirizzo. Non un'opzione accanto al GPS: lo sostituisce.
- **Ambito: sia la ricerca in Home sia la creazione partita**, nello stesso sotto-progetto — entrambe richiedono la stessa capacità di base (trasformare un testo in coordinate) ed è la stessa modifica applicata a due chiamanti, non due funzionalità indipendenti.
- **Geocoding nativo del dispositivo** (`expo-location`'s `geocodeAsync`), non Google Places Autocomplete — zero costi, zero nuove chiavi API/fatturazione, coerente con la filosofia del progetto di minimizzare l'infrastruttura esterna. Nessun suggerimento "a tendina" mentre si scrive: l'utente scrive l'indirizzo/città per intero e lo si geocodifica al submit.
- **Nessun risultato trovato → errore, l'utente riprova** ("Località non trovata, prova a essere più specifico"). **Più risultati ambigui → si prende il primo** (il più rilevante secondo il geocoder), senza mostrare una lista di scelta. Accettato esplicitamente come rischio noto: un indirizzo ambiguo (es. una città con lo stesso nome in più paesi) può risolvere nel posto sbagliato — non c'è nessuna conferma visiva (niente mappa/pin in questa fase) che lo segnali all'utente.
- **L'ultima località cercata in Home è salvata solo sul dispositivo** (`expo-secure-store`, già una dipendenza del progetto per la sessione — nessun nuovo pacchetto), non sul profilo utente lato backend. Non sincronizzata tra dispositivi.
- **All'apertura della Home, se esiste una località salvata, la ricerca riparte automaticamente** con quella — stesso comportamento percepito di oggi (che partiva da solo col GPS), solo con una località fissa al posto della posizione live.

Fuori ambito: una UI di scelta tra risultati di geocoding ambigui; Google Places/Maps Autocomplete; sincronizzazione multi-dispositivo dell'ultima ricerca; modificare il raggio fisso di ricerca (20km, invariato); qualunque anteprima mappa/pin alla creazione partita; permettere di modificare la posizione di una partita dopo la creazione (già fuori scope oggi, invariato).

## 2. Modulo di geocoding condiviso

Un solo punto che trasforma testo in coordinate, usato sia dalla ricerca Home sia dalla creazione partita.

```ts
// mobile/src/api/geocoding.ts
import { Platform } from 'react-native';
import * as Location from 'expo-location';

export interface GeocodedLocation {
  latitude: number;
  longitude: number;
}

export async function geocodeAddress(query: string): Promise<GeocodedLocation> {
  if (Platform.OS === 'android') {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      throw new Error('Località non trovata, prova a essere più specifico.');
    }
  }
  const results = await Location.geocodeAsync(query);
  if (results.length === 0) {
    throw new Error('Località non trovata, prova a essere più specifico.');
  }
  const [first] = results;
  return { latitude: first.latitude, longitude: first.longitude };
}
```

**Correzione post-implementazione (emersa dalla review finale del branch)**: questa sezione affermava originariamente che `geocodeAsync` "non richiede alcun permesso di localizzazione a runtime" su nessuna piattaforma — **falso su Android**. La documentazione di `expo-location` (il docblock sopra `geocodeAsync`) e il codice nativo (`LocationModule.kt`) confermano che su Android `geocodeAsync` lancia `LocationUnauthorizedException` finché `requestForegroundPermissionsAsync` non è stato chiamato e concesso a runtime — la sola dichiarazione nel manifest non basta su API 23+. Su iOS invece nessun permesso è richiesto, la premessa originale era corretta solo lì.

Questo **non riapre** la decisione di design "nessun GPS/posizione in tempo reale": il vincolo riguarda non leggere mai la posizione live del dispositivo (`getCurrentPositionAsync`), non l'assenza assoluta di ogni chiamata a un'API di permesso su ogni piattaforma. Richiedere il permesso di localizzazione **solo per sbloccare il geocoder di sistema** (mai per leggere una posizione) resta coerente con lo spirito della decisione — è un dettaglio tecnico di piattaforma, non un ripensamento del design. Il Global Constraint del piano va letto di conseguenza: "nessuna chiamata a `requestForegroundPermissionsAsync`/`getCurrentPositionAsync` deve sopravvivere" si applica a `getCurrentPositionAsync` su ogni piattaforma e a `requestForegroundPermissionsAsync` **solo su iOS**, dove è davvero inutile; su Android la chiamata a `requestForegroundPermissionsAsync` è necessaria e corretta.

**Nota per l'implementazione**: `mobile/AGENTS.md` impone di verificare la documentazione versionata esatta di Expo (v57.0.0) prima di scrivere codice — la firma/il comportamento esatto di `Location.geocodeAsync` in questa versione (forma dell'array di risultati, campi disponibili su ogni risultato) va confermata contro quella documentazione durante l'implementazione, non assunta da versioni precedenti.

## 3. Ricerca partite in Home — sostituzione del GPS

### 3.1 Persistenza dell'ultima località cercata

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

Si salvano sia il testo digitato (`label`, da rimostrare nel campo di ricerca e come intestazione) sia le coordinate già risolte (`latitude`/`longitude`) — così l'auto-ricerca all'apertura della Home non richiede una nuova chiamata di geocoding ogni volta, solo la lettura da storage seguita direttamente da `fetchNearbyMatches`.

### 3.2 `useNearbyMatches` — riscrittura

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

Nessun più `permissionDenied`: rimosso dall'hook, dal suo consumer (`mobile/app/(tabs)/home/index.tsx`) e dai relativi test.

### 3.3 UI — `mobile/app/(tabs)/home/index.tsx`

Un campo di ricerca (`TextInput` + pulsante "Cerca") viene aggiunto sopra la lista partite, sotto il saluto/header esistente. Comportamento:
- Al mount, se `locationLabel` diventa non-null (arrivato dall'auto-ricerca), il campo si precompila con quel testo (`useEffect` che sincronizza uno stato locale `searchText` su `locationLabel`) — l'utente vede da subito cosa sta cercando e può modificarlo.
- Il submit (bottone "Cerca" o tasto invio sulla tastiera, `onSubmitEditing`) chiama `searchLocation(searchText)`.
- **Tre stati di rendering distinti**, non più i due di oggi (`permissionDenied`/`error` a schermo intero):
  1. **Nessuna ricerca mai fatta** (`locationLabel === null`, non in caricamento): sotto il campo di ricerca, un messaggio di invito ("Cerca una città per trovare le partite vicino a te") al posto della lista — non più uno stato "Attiva la posizione" a schermo intero, dato che non c'è più nessun permesso da negare.
  2. **Ricerca fallita** (`error` non nullo): il messaggio di errore appare come testo inline sotto il campo di ricerca (stile esistente `styles.error`), e la lista sottostante continua a mostrare `matches` così com'era prima del tentativo fallito (mai un `return` anticipato a schermo intero per l'errore, a differenza del comportamento pre-esistente).
  3. **Risultati** (`locationLabel` non nullo): stesso `FlatList`/filtri per tipo partita già esistenti, invariati.
- Lo stato di caricamento a schermo intero (`ActivityIndicator`) resta solo per il primissimo mount, prima che l'auto-ricerca (se una località era salvata) o il messaggio di invito (se non lo era) si stabilizzino.

## 4. Creazione partita — fix del bug di geolocalizzazione

`useCreateMatch` sostituisce interamente la cattura GPS con il geocoding del campo "Indirizzo" già esistente nel form (`MatchForm.tsx`, invariato — il campo `address` c'è già, semplicemente oggi il suo valore non viene mai usato per calcolare `latitude`/`longitude`).

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

`permissionDenied` rimosso anche qui: dall'hook, da `mobile/app/(tabs)/home/create-match.tsx` (elimina il blocco "Attiva la posizione" a schermo intero) e dai relativi test. Un fallimento del geocoding si presenta come un `error` normale, mostrato dal form nello stesso slot già usato per ogni altro errore di submit (`MatchForm`'s `error` prop, invariato) — nessuna nuova UI.

**Nessuna conferma/anteprima della posizione risolta** prima di salvare: il geocoding avviene silenziosamente al submit, coerente con la decisione di non introdurre una UI a mappa in questa fase. Stesso rischio noto della sezione 1 (ambiguità → primo risultato) si applica qui simmetricamente.

**Correzione di un commento ora scorretto**: `mobile/src/api/matches.ts` ha un commento sopra `MatchEditableFields` che dice "Location is captured once at creation from the creator's device GPS" — va aggiornato per riflettere che la posizione ora viene dal geocoding dell'indirizzo digitato, non più dal GPS del creatore (il vincolo che descrive — lat/lng non modificabili dopo la creazione — resta invariato e vero).

## 5. Gestione errori (condivisa)

- **Nessun risultato dal geocoding**: `geocodeAddress` lancia l'errore italiano già mostrato sopra ("Località non trovata, prova a essere più specifico.") — stesso testo in entrambi i flussi, un solo posto dove è scritto.
- **Il servizio di geocoding di sistema non risponde** (es. nessuna connessione di rete, errore nativo transitorio): `Location.geocodeAsync` può rigettare direttamente con un proprio errore nativo, non tradotto — accettato come comportamento identico a come il resto del codebase gestisce già errori di rete non previsti (mostrato via `err.message`, che può risultare in inglese/tecnico in questo caso specifico; non è un problema nuovo introdotto da questa modifica, lo stesso accadeva già se `fetchNearbyMatches`/`createMatch` fallivano per un errore di rete).
- **Storage corrotto** (`lastSearchLocation.ts`): un valore non parsabile in `expo-secure-store` viene trattato come "nessuna località salvata", mai come un errore mostrato all'utente — la Home torna semplicemente allo stato "nessuna ricerca ancora fatta".

## 6. Testing

- **`mobile/src/api/geocoding.test.ts`** (nuovo): nessun risultato → l'errore italiano viene lanciato; un risultato → coordinate restituite correttamente; più risultati → viene restituito il primo.
- **`mobile/src/api/lastSearchLocation.test.ts`** (nuovo, stesso pattern di mock di `expo-secure-store` già usato in `secureStorageAdapter.test.ts`): scrittura e lettura round-trip; nessun valore salvato → `null`; valore corrotto (JSON non valido) → `null`, non un'eccezione.
- **`mobile/src/hooks/useNearbyMatches.test.ts`** (riscritto, mock di `@/api/geocoding` + `@/api/lastSearchLocation` + `@/api/matches`): auto-ricerca al mount quando esiste una località salvata; nessuna ricerca al mount quando non esiste; `searchLocation` geocodifica, salva, e cerca; un `searchLocation` fallito imposta `error` senza svuotare `matches`/`locationLabel` precedenti; `refresh` rilegge la località salvata e ricerca di nuovo (no-op se non esiste).
- **`mobile/src/hooks/useCreateMatch.test.ts`** (riscritto, mock di `@/api/geocoding` al posto di `expo-location`): il geocoding sostituisce la cattura GPS nella chiamata a `createMatch`; un geocoding fallito imposta `error` e non chiama `createMatch` né naviga; il test esistente "nessuna sessione" resta invariato nella sua assertion, cambia solo il mock da sostituire.
- **Manuale**: verifica in simulatore di entrambi i flussi (ricerca in Home con una città reale, creazione di una partita con un indirizzo reale, verifica diretta su DB che `matches.latitude`/`longitude` corrispondano all'indirizzo digitato e non alla posizione del simulatore) — necessaria perché dipende dal comportamento reale del geocoder di sistema, non solo dai mock.
