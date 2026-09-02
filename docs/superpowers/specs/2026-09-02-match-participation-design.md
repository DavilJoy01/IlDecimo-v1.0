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

## 3. Backend — una sola aggiunta

Quasi tutto è già mergiato su `main` (piano `backend-foundation`) e verificato dai suoi stessi
test pgTAP:

- `public.match_participants`: macchina a stati completa via trigger
  (`enforce_participant_state_machine`) — `requested` → `approved`/`rejected` (solo il creatore),
  `approved`/`active` → `left` (solo il partecipante), `left` → `requested` di nuovo (solo il
  partecipante, bloccato se `leave_count >= 2`). **Non esiste** una transizione che permetta a chi
  ha inviato una richiesta di ritirarla autonomamente, né a chi è stato rifiutato di ri-provare —
  da qui il "fuori scope" di sezione 2.
- RLS su `match_participants` (`participants_select_relevant`) già permette: al richiedente di
  vedere la propria riga, al creatore di vedere tutte le righe della propria partita, a un
  partecipante approvato/attivo di vedere tutte le righe della partita (incluse le richieste
  pendenti altrui — non è un problema qui perché quello che manca è solo il nome associato,
  vedi sotto).
- `public.notifications`: righe già inserite automaticamente da
  `notify_on_participant_change()` per `join_request_received`/`join_request_approved`/
  `join_request_rejected`, con `payload.match_id` per il collegamento alla partita. RLS
  (`notifications_select_own`, `notifications_update_own`) già pronta per lettura e
  segna-come-letta.

**La sola cosa che manca**: la RLS di `public.users` permette a ciascuno di leggere solo il
proprio profilo (`users_select_self`). Questo significa che oggi, anche avendo il permesso di
leggere una riga di `match_participants`, non c'è modo lato client di ottenere nome/foto della
persona associata a quel `user_id`.

**Nuova migrazione**: funzione `security definer`
`match_participant_profiles(p_match_id uuid)`, stesso pattern già usato da
`is_fellow_participant` — gira come proprietario della funzione (esente da RLS) e applica essa
stessa la stessa logica di autorizzazione già presente nella RLS di `match_participants`
(chiamante = creatore, oppure chiamante = partecipante approvato/attivo di quella partita),
restituendo solo i campi pubblici sicuri:

```sql
returns table (
  user_id uuid,
  first_name text,
  last_name text,
  profile_image_url text,
  unique_user_id text,
  player_role text,
  status text  -- lo status della riga match_participants, per raggruppare lato client
)
```

Niente `phone`, niente `birth_date`, niente `height_cm` — mai esposti a un altro utente. Se il
chiamante non è né il creatore né un partecipante approvato/attivo di quella partita, la funzione
restituisce zero righe (non un errore).

Questa è l'unica migrazione di questo piano. Avrà il proprio test pgTAP
(`supabase/tests/0NN_match_participant_profiles.test.sql`, numero successivo all'ultimo esistente)
che verifica: il creatore vede tutte le righe (incluse le richieste pendenti), un partecipante
approvato vede sé stesso e gli altri approvati/attivi ma non le richieste pendenti altrui, un
estraneo (né creatore né partecipante) non vede nulla.

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
  (nome, foto, ruolo, piede preferito — dalla RPC di sezione 3), pulsanti **Approva**/**Rifiuta**.
- Sezione **"Partecipanti"**: roster di chi ha `status` `approved`/`active` (stessa RPC), sola
  visualizzazione.

Entrambe le sezioni, se vuote, non vengono renderizzate affatto (nessun messaggio "nessuna
richiesta"/"nessun partecipante") — stessa scelta per entrambe, per coerenza.

Il roster "Partecipanti" (sola visualizzazione, nome/foto/ruolo) è visibile sia al creatore sia
a ogni partecipante approvato/attivo — non solo al creatore — perché la RPC autorizza entrambi
i ruoli allo stesso modo (sezione 3).

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
- `useMatchRoster(matchId)`: `pendingRequests`/`approvedParticipants` (dalla RPC, filtrati
  client-side per `status`), `approve(id)`/`reject(id)`, `refresh()`. Usato sia dal ramo
  creatore (richieste + azioni) sia dal ramo partecipante (solo il roster approvato, azioni non
  esposte in UI per un non-creatore anche se la funzione esiste — la RLS/trigger backend
  comunque le rifiuterebbe).
- `useNotifications()`: `notifications`, `unreadCount`, `markRead(id)`, `refresh()` —
  refresh-on-focus come già fatto per la Home in match-creation.
- `useMyMatches()`: `created`, `participating`, `loading`, `error`, `refresh()`.

## 6. Testing

- **Backend**: pgTAP per la nuova RPC (sezione 3).
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
