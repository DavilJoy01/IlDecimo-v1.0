# Inviti diretti alla partita — Design Spec

## 1. Contesto e obiettivo

Il backend per gli inviti diretti esiste già per intero dal piano
`backend-foundation`: la tabella `match_invitations` (`match_id`,
`inviter_id`, `invitee_id`, `status` `sent`/`viewed`/`ignored`, vincolo
unico su `(match_id, invitee_id)`), le sue policy RLS (`insert` solo come
`inviter_id` con controllo di blocco reciproco, `select` solo per le due
parti, `update` solo come `invitee_id`), un trigger che protegge i campi
identificativi da modifica (`trg_protect_match_invitation_identity`) e un
trigger che genera già una notifica di tipo `match_invitation` con payload
`{message, match_id}` (`trg_notify_on_match_invitation`) — nessun codice
mobile usa ancora nessuna di queste parti.

Questa funzionalità era stata esplicitamente rimandata sia durante
`match-creation` che durante `persone` perché "richiede il sistema di
amicizie" — `persone` ha ormai introdotto quel sistema, quindi è
sbloccata. È la quarta funzionalità di fila a seguire lo stesso schema:
backend già pronto, il mobile recupera.

## 2. Scope

**Dentro lo scope:**
- Un pulsante "Invita amici" sulla schermata dettaglio partita, visibile
  solo al creatore, che apre un selettore degli amici invitabili.
- L'invio dell'invito (`match_invitations` insert).
- La notifica `match_invitation` già esistente instrada l'invitato
  direttamente al dettaglio della partita, segnando l'invito come
  `viewed` nel farlo.

**Fuori scope:**
- Un'azione esplicita "Ignora" sull'invito — lo stato `ignored` resta nello
  schema ma inutilizzato per ora, coerente con la decisione presa in fase
  di brainstorming.
- Una schermata/lista dedicata "I miei inviti" — la superficie per
  l'invitato è solo la lista Notifiche già esistente.
- Invitare da una schermata diversa dal dettaglio partita (es. dal
  profilo dell'amico) — non richiesto, rimandabile a un secondo giro se
  mai servisse.
- Qualunque modifica al flusso di richiesta/approvazione partecipazione
  già esistente: l'invito è solo un modo per far notare la partita a un
  amico, l'invitato deve comunque passare dal normale "Richiedi di
  partecipare" — esattamente come da spec originale ("L'invito notifica
  soltanto: non garantisce l'accesso").

## 3. Backend

**Nessuna migrazione nuova.** Tabella, RLS, trigger e il valore
`match_invitation` nel constraint di `notifications.type` esistono già,
verificati direttamente sul database di sviluppo prima di scrivere questa
spec (non assunti dalla sola lettura della spec MVP originale).

## 4. Livello dati mobile

### 4.1 `mobile/src/api/matchInvitations.ts`

Tipo:
```ts
export interface InvitableFriend {
  user_id: string;
  first_name: string;
  last_name: string;
  profile_image_url: string | null;
}
```

Funzioni:
- `fetchInvitableFriends(userId: string, matchId: string):
  Promise<InvitableFriend[]>` — tre query in parallelo (`fetchFriends`,
  già esistente in `friendships.ts`; una `select user_id from
  match_participants where match_id = ?`; una `select invitee_id from
  match_invitations where match_id = ?`), poi un filtro lato client che
  rimuove dagli amici chiunque compaia in uno dei due insiemi di
  esclusione — stesso schema già usato in `messaggi` (`fetchConversations`)
  e in `persone` per ridurre più query in un'unica lista, non serve una
  RPC dato che nessuna delle tre query richiede di bypassare RLS.
  Esclude *qualunque* stato esistente (partecipazione o invito, non solo
  quelli "attivi") per restare semplice e garantire di non violare mai il
  vincolo unico `(match_id, invitee_id)` — un amico che ha già
  lasciato/rifiutato può comunque vedere e richiedere la partita da solo,
  l'invito è solo una scorciatoia, non l'unico modo di parteciparvi.
- `sendMatchInvitation(matchId: string, inviterId: string, inviteeId:
  string): Promise<void>` — insert su `match_invitations`. Traduce
  l'errore Postgres `42501` (RLS: blocco reciproco) in un messaggio
  neutro in italiano, stesso principio già stabilito in
  `friendships.ts`/`privateMessages.ts` (non rivelare *perché* l'inserimento
  è stato negato). Non serve gestire `23505` qui: `fetchInvitableFriends`
  già esclude chiunque abbia un invito pendente, quindi un duplicato può
  capitare solo per una corsa a doppio tap sullo stesso amico — in quel
  caso il secondo tentativo fallisce con lo stesso messaggio tradotto,
  che è un esito accettabile (l'utente vede comunque un errore chiaro,
  non una stringa Postgres grezza) senza bisogno di un percorso di
  recupero come quello di `findOrCreateConversation`.
- `markInvitationViewed(matchId: string, inviteeId: string):
  Promise<void>` — `update match_invitations set status = 'viewed' where
  match_id = ? and invitee_id = ? and status = 'sent'`. Il filtro
  `status = 'sent'` rende l'operazione idempotente (una seconda apertura
  della stessa notifica non fa nulla, non è un errore) — non serve
  gestire il risultato "0 righe aggiornate" come fallimento.

### 4.2 Hook

`useInvitableFriends(matchId: string)` — carica `fetchInvitableFriends`
al mount con l'id dell'utente corrente (da `useSessionStore`), espone
`{ friends, loading, error, invite, inviting }` dove `invite(inviteeId)`
chiama `sendMatchInvitation` e poi rimuove otticamente quell'amico dalla
lista locale (nessun bisogno di ricaricare tutto — lo stesso schema già
usato per le richieste di amicizia in `useFriendRequests`).

## 5. Schermate

### 5.1 `home/match/[id]/index.tsx`

Un nuovo pulsante "Invita amici", visibile sempre quando `isCreator` è
vero (indipendentemente dal fatto che la sezione "Partecipanti" sia
attualmente renderizzata, dato che quella compare solo se
`roster.approvedParticipants.length > 0`) — posizionato subito dopo il
blocco `actions` esistente (Modifica/Cancella partita). Apre
`home/match/[id]/invite.tsx` passando l'id partita già presente nell'URL.

### 5.2 `home/match/[id]/invite.tsx` (nuova schermata)

Usa `useInvitableFriends(id)`. Una `FlatList` di `InvitableFriend`, ogni
riga con nome e un pulsante "Invita" che chiama `invite(user_id)` e
sparisce dalla lista al successo. Stato vuoto: "Nessun amico da invitare."
(copre sia "nessun amico in generale" sia "tutti i tuoi amici sono già
coinvolti in questa partita" — non serve distinguere i due casi, dato
che l'azione richiesta all'utente è la stessa: non c'è nessuno da
invitare in questo momento). Link "← Torna alla partita" in cima, stesso
pattern di ogni altra sotto-schermata di `match/[id]/`.

Serve un nuovo `_layout.tsx`? **No, verificato direttamente sul
filesystem, non assunto.** `home/_layout.tsx` dichiara solo `index`,
`create-match`, `match/[id]` e `notifications` come `Stack.Screen` —
**non** dichiara `match/[id]/chat`, eppure quella rotta funziona
correttamente da quando `match-room-chat` l'ha introdotta, e
`match/[id]/` non contiene un proprio `_layout.tsx` (solo `index.tsx` e
`chat.tsx`). Il bug "route promossa a tab" già trovato due volte in
`persone` e `messaggi` scatta quando due file sono fratelli diretti
dentro una cartella-tab (`(tabs)/<nome-tab>/index.tsx` +
`(tabs)/<nome-tab>/[altro].tsx`, entrambi allo stesso livello di
`(tabs)/`) — qui `match/[id]/invite.tsx` sarebbe annidato *sotto* la
route dinamica `match/[id]`, non alla pari di `home/index.tsx`, quindi
non rientra in quel caso: basta aggiungere il file
`match/[id]/invite.tsx`, nessuna riga da aggiungere in nessun
`_layout.tsx`, esattamente come `chat.tsx` non ne ha richiesta.

## 6. Notifiche

`mobile/app/(tabs)/home/notifications.tsx`'s `handlePress` guadagna un
nuovo branch per `type === 'match_invitation'`: chiama
`markInvitationViewed(payload.match_id, <id utente corrente>)` (senza
attendere il risultato per bloccare la navigazione — stesso spirito
"best effort" di `markConversationRead` in `messaggi`, un fallimento qui
non deve impedire la navigazione), poi `router.push` a
`/(tabs)/home/match/[id]` con lo stesso `match_id` — stesso branch di
routing già usato per gli altri tipi basati su `match_id` (in fondo alla
funzione, dopo i branch specifici per `friend_request_*`/
`private_message`), nessuna nuova logica di routing serve dato che il
payload ha esattamente la stessa forma.

## 7. Testing

Stesse convenzioni di `messaggi`/`persone`: Jest per `matchInvitations.ts`
e `useInvitableFriends` (client Supabase mockato, stile a catena già
stabilito in questo codebase), nessun test pgTAP nuovo (nessuna
migrazione nuova — la RLS/i trigger esistenti sono già coperti dai test
del piano `backend-foundation`), nessun test automatico a livello di
schermata, un walkthrough live nel simulatore iOS come task finale: il
creatore invita un amico, l'amico vede la notifica, la apre, viene
portato al dettaglio partita, l'invito risulta `viewed` (verificato via
SQL diretta), l'amico richiede di partecipare normalmente.

## 8. Rischi / decisioni aperte

- `fetchInvitableFriends` fa tre query separate invece di una singola
  query ottimizzata — accettabile alle dimensioni attuali di questo
  progetto (lista amici tipicamente piccola), stesso principio già
  accettato per `fetchConversations` in `messaggi`.
- Nessuna azione "Ignora" per l'invitato in questo giro: se in futuro
  servisse (es. per nascondere l'invito da una qualche lista "amici che
  vanno a questa partita"), lo stato `ignored` è già pronto nello schema
  e non richiede una nuova migrazione, solo una nuova azione lato
  client.
- Un amico rimosso (`removeFriend`) dopo aver ricevuto un invito continua
  a vedere l'invito/la notifica — non c'è un trigger che cancella o
  nasconde inviti pendenti alla rimozione dell'amicizia, a differenza del
  blocco (`delete_friendship_on_block` in `persone` gestisce solo il caso
  blocco, non la rimozione volontaria). Accettato come limite noto,
  coerente col fatto che rimuovere un amico non blocca né nasconde nulla
  altrove in questo codebase (es. una chat privata esistente resta
  visibile dopo la rimozione di un'amicizia).
