# Creazione Partite — Design

Data: 2026-08-31
Stato: approvato in chat, in attesa di conferma sul documento scritto

Spec madre: [docs/superpowers/specs/2026-08-30-app-calcio-mvp-design.md](2026-08-30-app-calcio-mvp-design.md)
(schema database, regole RLS, stack tecnologico — questo documento non li ripete, li estende
con il dettaglio di un singolo sotto-flusso).

## 1. Contesto e obiettivo

Le fondamenta mobile ([2026-08-31-mobile-app-foundation.md](../plans/2026-08-31-mobile-app-foundation.md),
già implementate e mergiate su `main`) coprono autenticazione, sessione, e una Home che mostra le
partite vicine — ma non c'è ancora modo di **creare** una partita dall'app: i dati di test usati
per verificare la Home sono stati inseriti a mano via SQL.

Questo piano copre: creazione di una nuova partita e visualizzazione/gestione del suo dettaglio.
Non copre: richieste di partecipazione, approvazione, chat di stanza partita — esplicitamente
rimandate a un piano successivo, come già annotato nella sezione "What this plan does not cover"
di mobile-app-foundation.

## 2. Scope

**In scope:**
- Schermata di creazione partita (form)
- Schermata di dettaglio partita (visualizzazione; modifica e cancellazione per il creatore)
- Livello API (`src/api/matches.ts`) per create/read/update/delete su `matches`
- Cattura automatica della posizione GPS del creatore al momento della creazione

**Fuori scope (rimandato):**
- Richieste di partecipazione e approvazione (`match_participants`)
- Chat di stanza partita (`match_messages`)
- Ricerca/autocomplete indirizzo (Google Places — la spec madre lo prevede per una fase
  successiva; qui l'indirizzo è testo libero non geocodificato)
- Riposizionamento della partita su mappa dopo la creazione
- Qualunque UI per notifiche push legate al ciclo di vita partita (il backend le genera già
  via trigger; non c'è lavoro mobile aggiuntivo in questo piano oltre a quanto già costruito)

## 3. Backend già esistente — nessuna nuova migrazione

Tutto quanto segue è già mergiato su `main` (piano `backend-foundation`, sezione 4/5 della spec
madre) e verificato dai suoi stessi test pgTAP:

- `public.matches`: `creator_id`, `match_type` (5/7/8), `field_name`, `address`, `latitude`,
  `longitude` (colonna `location` generata da questi due), `match_date`, `start_time`,
  `end_time`, `max_players`, `description`, `status` (default `'open'`).
- RLS: `matches_insert_as_creator` (insert solo con `auth.uid() = creator_id`),
  `matches_update_creator_only`, `matches_delete_creator_only`, `matches_select_authenticated`
  (lettura per qualunque utente autenticato, indipendentemente dallo status).
- `public.nearby_open_matches(user_lat, user_lng, radius_km)`: già consumata dalla Home
  (Task 7 di mobile-app-foundation) — filtra solo `status = 'open'`. Una partita creata con lo
  status di default compare quindi automaticamente in Home, senza altro lavoro backend.

Questo piano è puro lavoro mobile: nessuna migrazione, nessuna nuova RLS, nessun test pgTAP.

## 4. Schermate e flusso

### 4.1 Creazione partita — `app/(tabs)/home/create-match.tsx`

Accessibile da un pulsante (es. "+" nell'header) aggiunto alla Home esistente
(`app/(tabs)/home/index.tsx`).

Form (renderizzato da un componente condiviso `MatchForm`, vedi sezione 5):
- **Tipo partita**: selettore a chip 5/7/8 (stesso pattern di `preferredFoot`/`playerRole` in
  `create-profile.tsx`)
- **Nome campo**: testo
- **Indirizzo**: testo libero, solo per visualizzazione — non geocodificato
- **Data**: testo `AAAA-MM-GG` (stesso pattern di `birthDate` in `create-profile.tsx`)
- **Ora inizio** / **Ora fine**: testo `HH:MM`
- **Numero massimo giocatori**: numero, precompilato in base al tipo partita
  (5 → 10, 7 → 14, 8 → 16) e modificabile dall'utente
- **Descrizione**: testo multilinea, opzionale

Al submit:
1. Richiede la posizione GPS corrente via `expo-location` (stesso pattern già usato da
   `useNearbyMatches` per la ricerca). Se il permesso è negato o la posizione non è
   ottenibile, la creazione si blocca con un messaggio d'errore chiaro — non c'è inserimento
   manuale di coordinate per l'utente finale in questo MVP.
2. Se la posizione è disponibile, inserisce la riga in `matches` con `creator_id = auth.uid()`
   e `latitude`/`longitude` dalla posizione corrente del dispositivo.
3. In caso di successo, naviga alla schermata di dettaglio della partita appena creata.

**Limite noto e accettato per questo MVP**: la posizione salvata è quella del dispositivo del
creatore al momento della creazione, non necessariamente quella esatta del campo (nessuna
geocodifica dell'indirizzo testuale). Chi crea la partita mentre è altrove dal campo otterrà
una posizione imprecisa. Documentato qui come limite noto, non come bug.

### 4.2 Dettaglio partita — `app/(tabs)/home/match/[id].tsx`

- Mostra tutti i campi della partita (tipo, campo, indirizzo, data/ora, posti disponibili,
  descrizione).
- Se l'utente corrente è il creatore (`creator_id === auth.uid()`):
  - Pulsante **"Modifica"** → riusa `MatchForm` precompilato con i dati esistenti, submit
    chiama `updateMatch` invece di `createMatch` (nessuna nuova cattura GPS: la posizione non
    è modificabile da questa schermata, coerente con il limite di 4.1).
  - Pulsante **"Cancella partita"** con conferma (`Alert.alert` nativo) → `deleteMatch`, poi
    `router.back()` verso Home.
- Se l'utente corrente NON è il creatore: sola visualizzazione, nessuna azione (le richieste di
  partecipazione sono fuori scope, vedi sezione 2).

### 4.3 Home — modifica minima

`app/(tabs)/home/index.tsx` guadagna:
- Un pulsante/link per navigare a `create-match.tsx`.
- `MatchCard` (già esistente, oggi puramente presentazionale) diventa cliccabile e naviga a
  `match/[id].tsx` con l'id della partita.

## 5. Livello dati/API

`src/api/matches.ts` (estende il file esistente, che oggi ha solo `fetchNearbyMatches`):

```ts
export interface Match {
  id: string;
  creator_id: string;
  match_type: 5 | 7 | 8;
  field_name: string;
  address: string;
  latitude: number;
  longitude: number;
  match_date: string;
  start_time: string;
  end_time: string;
  max_players: number;
  description: string | null;
  status: 'draft' | 'open' | 'full' | 'started' | 'completed' | 'cancelled';
}

export async function createMatch(input: NewMatch): Promise<Match>;
export async function fetchMatchById(id: string): Promise<Match>;
export async function updateMatch(id: string, input: Partial<NewMatch>): Promise<Match>;
export async function deleteMatch(id: string): Promise<void>;
```

`src/hooks/`:
- `useCreateMatch()`: stato `loading`/`error`, cattura la posizione GPS, chiama `createMatch`,
  naviga al dettaglio in caso di successo.
- `useMatchDetail(matchId)`: fetch iniziale della partita, espone `update`/`remove` per la
  schermata di dettaglio (usati solo dal ramo "sei il creatore" della UI — la RLS backend
  imporrebbe comunque il divieto anche se la UI venisse aggirata).

Entrambi seguono il pattern già stabilito da `useRegistration`/`useNearbyMatches`: business
logic nell'hook, schermate presentazionali.

## 6. Testing

- **Unit test Jest** per `matches.ts`: `createMatch`, `fetchMatchById`, `updateMatch`,
  `deleteMatch` — mock del client Supabase, stesso pattern del resto del progetto
  (`jest.mock('./supabase', () => ({ supabase: { ... } }))`).
- **Unit test Jest** per `useCreateMatch` e `useMatchDetail` — incluso il caso di permesso GPS
  negato per `useCreateMatch`, e il caso "utente non è il creatore" per `useMatchDetail`
  (nessuna azione di modifica/cancella esposta o comunque non invocabile).
- **Verifica manuale end-to-end nel simulatore** (stesso pattern del Task 9 di
  mobile-app-foundation): crea una partita dal form, conferma appaia in Home, apri il
  dettaglio, modificala, cancellala e conferma sparisca da Home.

## 7. Rischi e decisioni aperte

- **Date/orari nel passato**: questo MVP non impedisce lato client di creare una partita con
  `match_date` nel passato (il backend impone solo `end_time > start_time`, non un vincolo sul
  giorno). Non bloccante per l'MVP; nota per iterazioni future.
- **Precisione della posizione**: vedi il limite noto in 4.1 — accettato per questo MVP,
  da risolvere quando (e se) arriverà l'integrazione Google Places/Maps prevista dalla spec
  madre per una fase successiva.
