# Partecipazione alle Partite — Design

Data: 2026-09-02
Stato: approvato in chat, in attesa di conferma sul documento scritto

Spec madre: [docs/superpowers/specs/2026-08-30-app-calcio-mvp-design.md](2026-08-30-app-calcio-mvp-design.md)
(schema database, regole RLS, stack tecnologico — questo documento non li ripete, li estende
con il dettaglio di un singolo sotto-flusso).

## 1. Contesto e obiettivo

Il piano [2026-08-31-match-creation.md](../plans/2026-08-31-match-creation.md) (già implementato
e mergiato su `main`) copre creazione, visualizzazione, modifica e cancellazione di una partita —
ma una partita creata non ha ancora modo di **riempirsi**: nessun altro utente può chiedere di
parteciparvi, e il creatore non ha modo di approvare o rifiutare nessuno. Era esplicitamente
rimandato a questo piano, come annotato nella sezione "What this plan does not cover" di
match-creation.

Questo piano copre: richiesta di partecipazione a una partita aperta, approvazione/rifiuto da
parte del creatore, visualizzazione di chi partecipa, abbandono di una partita, una lista
"Le mie partite", e una lista notifiche in-app per gli eventi di partecipazione.

Non copre: inviti diretti a una persona specifica (`match_invitations`), chat di stanza partita
(`match_messages`), registrazione/ricezione effettiva delle push notification (`expo-notifications`,
richiede un dispositivo reale per essere testata), una schermata "profilo utente" navigabile
(sezione "Persone" della spec madre, non ancora pianificata).

## 2. Scope

**In scope:**
- Richiesta di partecipazione a una partita `open` (chiunque tranne il creatore)
- Approvazione/rifiuto delle richieste da parte del creatore
- Visualizzazione inline del profilo pubblico di chi ha richiesto/partecipa (nome, foto, ruolo,
  piede preferito) — non una schermata profilo navigabile
- Abbandono di una partita da parte di un partecipante approvato/attivo
- Ri-richiesta dopo un abbandono (fino a 2 volte, limite già imposto dal backend)
- Schermata "Le mie partite" (partite create + partite a cui si partecipa)
- Schermata "Notifiche" in-app (lettura della tabella `notifications` già esistente)

**Fuori scope (rimandato):**
- Inviti diretti (`match_invitations`) — dipende dal sistema "amicizie", non ancora costruito
  lato mobile
- Chat di stanza partita (`match_messages`)
- Registrazione token push / ricezione reale delle notifiche push (`expo-notifications`) — la
  tabella `user_push_tokens` e il trigger `pg_net` che invia le push esistono già lato backend,
  ma non c'è ancora nessun codice mobile che registra un token. Le push richiedono un dispositivo
  fisico per essere verificate, quindi questo resta un piano a sé.
- Ritiro di una richiesta pendente da parte di chi l'ha inviata — il backend non modella questa
  transizione (vedi sezione 3), non la aggiungiamo qui
- Schermata profilo utente navigabile (sezione "Persone")

## 3. Backend — nessuna nuova migrazione

Tutto quanto segue è già mergiato su `main` (piano `backend-foundation`) e verificato dai suoi
stessi test pgTAP. **Correzione rispetto alla prima stesura di questa spec**: era stata
proposta una nuova funzione RPC per esporre nome/foto dei partecipanti — non serve, esiste già
un meccanismo pensato esattamente per questo (vedi sotto). Questo piano non tocca il backend.

- `public.match_participants`: macchina a stati completa via trigger
  (`enforce_participant_state_machine`) — `requested` → `approved`/`rejected` (solo il creatore),
  `approved`/`active` → `left` (solo il partecipante), `left` → `requested` di nuovo (solo il
  partecipante, bloccato se `leave_count >= 2`). **Non esiste** una transizione che permetta a chi
  ha inviato una richiesta di ritirarla autonomamente, né a chi è stato rifiutato di ri-provare —
  da qui il "fuori scope" di sezione 2.
- RLS su `match_participants` (`participants_select_relevant`) già permette: al richiedente di
  vedere la propria riga, al creatore di vedere tutte le righe della propria partita, a un
  partecipante approvato/attivo di vedere tutte le righe della partita (incluse le richieste
  pendenti altrui).
- `public.notifications`: righe già inserite automaticamente da
  `notify_on_participant_change()` per `join_request_received`/`join_request_approved`/
  `join_request_rejected`, con `payload.match_id` per il collegamento alla partita. RLS
  (`notifications_select_own`, `notifications_update_own`) già pronta per lettura e
  segna-come-letta.
- **`public.user_public_profiles`** (vista, `supabase/migrations/20260830100100_create_users_table.sql`):
  espone `id, unique_user_id, first_name, last_name, birth_date, height_cm, preferred_foot,
  player_role, profile_image_url, matches_played_count, matches_completed_count,
  matches_abandoned_count` per **qualunque** utente, a **qualunque** altro utente autenticato
  (`grant select ... to authenticated`, nessuna RLS aggiuntiva sulla vista — verificato dal test
  `supabase/tests/001_users.test.sql`: "a non-owner can see another user's public profile via
  the view"). **Non espone mai `phone`** (verificato dallo stesso test: leggere `phone` da questa
  vista genera un errore, la colonna non esiste sulla vista). Questa vista esiste già proprio per
  supportare casi come "vedi il profilo di chi ha chiesto di partecipare" — non serve costruire
  nulla di nuovo lato backend, basta interrogarla dal client.

Per questo piano: dato un `match_id`, si leggono le righe di `match_participants` (già
autorizzate correttamente dalla RLS esistente — chi può vedere quali righe è già deciso lì) e
poi si arricchiscono con una seconda query su `user_public_profiles` filtrata sugli `user_id`
trovati. Due query semplici lato `src/api/participants.ts` (sezione 5), nessuna gestione
d'autorizzazione aggiuntiva da scrivere: la vista è aperta a chiunque sia autenticato, e la riga
`match_participants` stessa è già filtrata correttamente da chi può vederla.

## 4. Schermate e flusso

### 4.1 Dettaglio partita — `app/(tabs)/home/match/[id].tsx` (estensione)

Aggiunge una sezione di partecipazione sotto quella già esistente (che resta invariata: titolo,
campo, indirizzo, data/ora, descrizione; Modifica/Cancella solo per il creatore).

**Se l'utente corrente NON è il creatore**, in base alla propria riga in `match_participants`
(assente, o con uno status):

| Stato | Cosa vede | Azione disponibile |
|---|---|---|
| Nessuna riga | — | "Richiedi di partecipare" (nascosto se `status` partita ≠ `open` o posti esauriti) |
| `requested` | "Richiesta in attesa di approvazione" | nessuna |
| `approved` / `active` | "Sei dentro ✅" + roster partecipanti | "Abbandona partita" (con conferma) |
| `rejected` | "La tua richiesta è stata rifiutata" | nessuna |
| `left` | "Hai lasciato questa partita" | "Richiedi di nuovo" (se `leave_count < 2`; altrimenti nascosto — vedi sotto) |

**Se l'utente corrente È il creatore**, sotto Modifica/Cancella:
- Sezione **"Richieste in attesa"**: una riga per partecipante con `status='requested'`
  (nome, foto, ruolo, piede preferito — da `user_public_profiles`, sezione 3), pulsanti
  **Approva**/**Rifiuta**.
- Sezione **"Partecipanti"**: roster di chi ha `status` `approved`/`active` (stessa fonte dati),
  sola visualizzazione.

Entrambe le sezioni, se vuote, non vengono renderizzate affatto (nessun messaggio "nessuna
richiesta"/"nessun partecipante") — stessa scelta per entrambe, per coerenza.

Il roster "Partecipanti" (sola visualizzazione, nome/foto/ruolo) è visibile sia al creatore sia
a ogni partecipante approvato/attivo — non solo al creatore — perché la RLS esistente su
`match_participants` già permette a entrambi i ruoli di leggere tutte le righe della partita
(sezione 3); `fetchMatchParticipantProfiles` non applica nessun filtro di autorizzazione
proprio, restituisce semplicemente ciò che la query sottostante può già vedere.

**Ri-richiesta bloccata dal limite (2 uscite)**: se l'utente preme "Richiedi di nuovo" e il
trigger backend rifiuta (`leave_count >= 2`), l'errore Postgres grezzo viene mostrato inline
(stesso pattern già accettato nel piano match-creation per altri errori del trigger) — non
costruiamo una UI dedicata per questo caso limite.

### 4.2 Notifiche — nuova schermata `app/(tabs)/home/notifications.tsx`

Lista delle notifiche dell'utente corrente (`notifications`, ordinate per `created_at desc`),
un elemento per riga con `payload.message` e un indicatore di lettura. Tap su una notifica:
segna `read_at` (se non già letta) e, se `payload.match_id` è presente, naviga al dettaglio di
quella partita.

**Punto d'accesso**: icona/pulsante campanella nell'header della Home esistente
(`app/(tabs)/home/index.tsx`), accanto al pulsante "+ Crea" già presente, con un badge del
conteggio non lette (`read_at is null`).

### 4.3 Le mie partite — `app/(tabs)/my-matches/index.tsx` (da placeholder a reale)

Oggi è un semplice `ScreenPlaceholder`. Diventa due liste:
- **"Create da te"**: partite con `creator_id = auth.uid()`, qualunque stato.
- **"A cui partecipi"**: partite dove l'utente ha una riga in `match_participants` con status
  `requested`/`approved`/`active` (non `rejected`/`left`/`completed` — quelle non sono più
  "partite a cui partecipi" nel presente).

Ogni riga è cliccabile e naviga a `/(tabs)/home/match/[id]` (percorso completo — dalla tab
"Le mie partite" verso una rotta fisicamente definita sotto la tab "Home"; Expo Router supporta
questo cambio di tab tramite `router.push` con il percorso assoluto, pattern già in uso altrove
nel progetto).

## 5. Livello dati/API

Due nuovi file, stesso stile di `src/api/matches.ts` (una funzione per query/RPC, mai logica
business nel componente):

**`src/api/participants.ts`**:
```ts
export interface ParticipantProfile {
  user_id: string;
  first_name: string;
  last_name: string;
  profile_image_url: string | null;
  unique_user_id: string;
  player_role: 'player' | 'goalkeeper' | 'both';
  status: 'requested' | 'approved' | 'rejected' | 'active' | 'left' | 'completed';
}

// The current user's own match_participants row for one match (or null if
// they've never interacted with it) -- just the fields the participation UI
// needs, not the full table row.
export interface MyParticipation {
  id: string;
  status: 'requested' | 'approved' | 'rejected' | 'active' | 'left' | 'completed';
  leave_count: number;
}

export async function requestToJoin(matchId: string): Promise<void>;
export async function reRequestToJoin(participantRowId: string): Promise<void>;
export async function leaveMatch(participantRowId: string): Promise<void>;
export async function approveParticipant(participantRowId: string): Promise<void>;
export async function rejectParticipant(participantRowId: string): Promise<void>;
export async function fetchMyParticipation(matchId: string, userId: string): Promise<MyParticipation | null>;
export async function fetchMatchParticipantProfiles(matchId: string): Promise<ParticipantProfile[]>;
```

**`src/api/notifications.ts`**:
```ts
export interface AppNotification {
  id: string;
  type: string;
  payload: { message: string; match_id?: string; [k: string]: unknown };
  read_at: string | null;
  created_at: string;
}

export async function fetchNotifications(): Promise<AppNotification[]>;
export async function markNotificationRead(id: string): Promise<void>;
```

`src/hooks/` (nuovi, stesso pattern di `useMatchDetail`/`useCreateMatch`):
- `useMyParticipation(matchId)`: la propria riga (o `null`), `requestToJoin()`,
  `reRequestToJoin()`, `leaveMatch()` — ognuna con `loading`/`error` propri e refresh dello stato
  dopo successo.
- `useMatchRoster(matchId)`: `pendingRequests`/`approvedParticipants` (da
  `fetchMatchParticipantProfiles`, filtrati client-side per `status`), `approve(id)`/`reject(id)`,
  `refresh()`. Usato sia dal ramo
  creatore (richieste + azioni) sia dal ramo partecipante (solo il roster approvato, azioni non
  esposte in UI per un non-creatore anche se la funzione esiste — la RLS/trigger backend
  comunque le rifiuterebbe).
- `useNotifications()`: `notifications`, `unreadCount`, `markRead(id)`, `refresh()` —
  refresh-on-focus come già fatto per la Home in match-creation.
- `useMyMatches()`: `created`, `participating`, `loading`, `error`, `refresh()`.

## 6. Testing

- **Unit test Jest** per `participants.ts`/`notifications.ts`: mock del client Supabase, stesso
  stile del resto del progetto.
- **Unit test Jest** per i 4 nuovi hook: incluso il caso "richiesta bloccata dal limite di 2
  uscite" per `useMyParticipation`, il caso "azioni non disponibili per un non-creatore" per
  `useMatchRoster`.
- **Verifica manuale end-to-end nel simulatore**: due utenti di test (o lo stesso account
  riautenticato) — richiesta di partecipazione, approvazione dal creatore, verifica del roster
  su entrambi i lati, abbandono, ri-richiesta, verifica della notifica e del suo badge.

## 7. Rischi e decisioni aperte

- **Ritiro di una richiesta pendente**: non supportato (sezione 3) — un utente che chiede di
  partecipare deve aspettare la decisione del creatore. Accettato come limite noto per l'MVP.
- **Rifiuto definitivo**: chi viene rifiutato non può ri-provare per la stessa partita (il
  backend non modella `rejected → requested`). Accettato come limite noto.
- **Notifiche senza push reali**: la schermata Notifiche mostra solo eventi già avvenuti quando
  l'utente apre l'app — senza registrazione del token push, non arriva nulla mentre l'app è
  chiusa. Push reali restano un piano futuro a sé (sezione 2).
