# Chat di Stanza Partita — Design

Data: 2026-09-04
Stato: approvato in chat, in attesa di conferma sul documento scritto

Spec madre: [docs/superpowers/specs/2026-08-30-app-calcio-mvp-design.md](2026-08-30-app-calcio-mvp-design.md)
(schema database, regole RLS, stack tecnologico — questo documento non li ripete, li estende
con il dettaglio di un singolo sotto-flusso).

## 1. Contesto e obiettivo

Il piano [2026-09-02-match-participation.md](../plans/2026-09-02-match-participation.md) (già
implementato e mergiato su `main`) copre richiesta/approvazione/roster/abbandono, ma era
esplicitamente rimandata a un piano successivo la chat di stanza partita (`match_messages`) —
uno spazio di conversazione di gruppo scoped a una singola partita, per i suoi partecipanti. È il
prossimo passo nella sequenza già indicata dalla spec madre: "partita → richiesta →
approvazione → stanza, chat realtime".

Questo piano copre: lettura/invio di messaggi in tempo reale nella chat di una partita, un fix a
un gap di autorizzazione già esistente nel backend (il creatore non poteva accedere alla chat
della propria partita), e la possibilità di menzionare un singolo partecipante in un messaggio
per fargli arrivare una notifica dedicata.

Non copre: inviti diretti (`match_invitations`), registrazione/ricezione reale delle push
notification (`expo-notifications`), una schermata profilo utente navigabile, cronologia
messaggi paginata oltre agli ultimi 50, evidenziazione visiva del testo menzionato, menzione
collettiva ("@Tutti" — scartata in fase di design), allegati/media nei messaggi.

## 2. Scope

**In scope:**
- Lettura della cronologia recente (ultimi 50 messaggi) e invio di nuovi messaggi in una chat
  scoped a una partita
- Aggiornamento in tempo reale (Supabase Realtime) quando altri partecipanti scrivono, mentre la
  chat è aperta
- Accesso per il creatore della partita e per ogni partecipante con status `approved`/`active`/
  `completed` (stessa idoneità già usata per la lettura del roster)
- Invio ottimistico (il messaggio proprio appare subito, prima della conferma del server)
- Menzione di un singolo partecipante tramite "@" nel campo di testo, con notifica dedicata
  (`match_message_mention`) distinta dalla notifica generica di nuovo messaggio
- Fix del gap RLS: il creatore potrà leggere/scrivere nella chat anche senza avere una propria
  riga in `match_participants` (oggi non ne ha mai una)
- Punto d'accesso: pulsante "Chat" nel dettaglio partita esistente, visibile solo a chi ha
  accesso; le notifiche di nuovo messaggio/menzione navigano direttamente alla chat

**Fuori scope (rimandato o scartato):**
- Inviti diretti (`match_invitations`) — dipende dal sistema "amicizie", non ancora costruito
- Registrazione token push / ricezione reale delle notifiche push (`expo-notifications`) — stesso
  limite già documentato nel piano match-participation, richiede un dispositivo fisico
- Schermata profilo utente navigabile (sezione "Persone")
- Cronologia paginata/infinite-scroll oltre agli ultimi 50 messaggi — estensione futura se serve
- Evidenziazione colorata del testo "@Nome" nei messaggi renderizzati — il testo resta semplice,
  la menzione esiste solo come meccanismo di notifica
- Menzione collettiva ("@Tutti") — valutata in fase di design, scartata su richiesta esplicita
- Riconnessione esplicita della sottoscrizione realtime in caso di caduta — si usa il
  comportamento di retry automatico già fornito dalla libreria Supabase, nessuna logica aggiuntiva

## 3. Backend

### 3.1 Fix RLS esistente: il creatore non ha accesso alla propria chat

Le policy attuali su `match_messages` (`supabase/migrations/20260830100700_create_match_messages
_table.sql`) controllano solo `match_participants.status`:

```sql
create policy "match_messages_select_participants" on public.match_messages
  for select to authenticated using (
    exists (
      select 1 from public.match_participants mp
      where mp.match_id = match_messages.match_id
        and mp.user_id = auth.uid()
        and mp.status in ('approved','active','completed')
    )
  );
-- stessa struttura per match_messages_insert_participants
```

Il creatore di una partita non ha mai una riga in `match_participants` per la propria partita
(confermato: nessun codice, né trigger né client, ne inserisce una alla creazione). Le policy
equivalenti su `match_participants` stesso già gestiscono questo caso con un `or auth.uid() =
(select creator_id from public.matches where id = match_id)` — le policy di `match_messages`,
scritte nella stessa migrazione ma senza questa clausola, sono una svista, non una scelta
voluta. Una nuova migrazione ricrea le due policy aggiungendo la stessa clausola `or`.

### 3.2 Nuova tabella `match_message_mentions`

```sql
create table public.match_message_mentions (
  message_id uuid not null references public.match_messages(id) on delete cascade,
  mentioned_user_id uuid not null references public.users(id) on delete cascade,
  primary key (message_id, mentioned_user_id)
);

alter table public.match_message_mentions enable row level security;
grant select, insert on public.match_message_mentions to authenticated;

create policy "match_message_mentions_select_participants" on public.match_message_mentions
  for select to authenticated using (
    exists (
      select 1 from public.match_messages mm
      where mm.id = match_message_mentions.message_id
        and (
          exists (
            select 1 from public.match_participants mp
            where mp.match_id = mm.match_id and mp.user_id = auth.uid()
              and mp.status in ('approved','active','completed')
          )
          or auth.uid() = (select creator_id from public.matches where id = mm.match_id)
        )
    )
  );

create policy "match_message_mentions_insert_own_message" on public.match_message_mentions
  for insert to authenticated with check (
    mentioned_user_id <> auth.uid()
    and exists (
      select 1 from public.match_messages mm
      where mm.id = match_message_mentions.message_id and mm.sender_id = auth.uid()
    )
  );
```

Un trigger `before insert` (`enforce_valid_mention`, stesso stile di
`enforce_participant_state_machine` in `match_participants`) rifiuta l'inserimento se
`mentioned_user_id` non è, per la partita del messaggio, un partecipante `approved`/`active` né
il creatore — mai fidarsi che il client mandi solo id validi.

### 3.3 Nuova funzione `send_match_message` sostituisce il trigger automatico

Il trigger esistente `trg_notify_on_match_message` (`after insert on match_messages`) scatta
subito dopo l'inserimento del messaggio — troppo presto per vedere le righe di menzione, che
devono necessariamente essere inserite dopo (hanno una FK verso `message_id`). La soluzione è
una funzione RPC unica che orchestra l'intera operazione in una transazione:

```sql
create or replace function public.send_match_message(
  p_match_id uuid,
  p_body text,
  p_mentions uuid[] default '{}'
)
returns public.match_messages
language plpgsql
security invoker
as $$
declare
  v_message public.match_messages;
  v_mentioned_id uuid;
  v_field_name text;
  v_recipient record;
begin
  insert into public.match_messages (match_id, sender_id, body)
  values (p_match_id, auth.uid(), p_body)
  returning * into v_message;

  foreach v_mentioned_id in array p_mentions loop
    insert into public.match_message_mentions (message_id, mentioned_user_id)
    values (v_message.id, v_mentioned_id);
  end loop;

  select field_name into v_field_name from public.matches where id = p_match_id;

  for v_recipient in
    select user_id from public.match_participants
    where match_id = p_match_id and status in ('approved','active') and user_id <> auth.uid()
    union
    select creator_id from public.matches where id = p_match_id and creator_id <> auth.uid()
  loop
    insert into public.notifications (user_id, type, payload)
    values (
      v_recipient.user_id,
      case when v_recipient.user_id = any(p_mentions) then 'match_message_mention' else 'match_message' end,
      jsonb_build_object(
        'message',
        case when v_recipient.user_id = any(p_mentions)
          then 'Sei stato menzionato in ' || v_field_name
          else 'Nuovo messaggio nella stanza di ' || v_field_name
        end,
        'match_id', p_match_id
      )
    );
  end loop;

  return v_message;
end;
$$;

grant execute on function public.send_match_message(uuid, text, uuid[]) to authenticated;
revoke execute on function public.send_match_message(uuid, text, uuid[]) from public, anon;
```

`security invoker` (non `definer`): la funzione si appoggia interamente alle RLS già esistenti su
`match_messages` e `match_message_mentions` per l'autorizzazione — se il chiamante non ha i
permessi, i singoli insert falliscono normalmente, la funzione non introduce un varco. Il vecchio
trigger `trg_notify_on_match_message` e la sua funzione vengono rimossi nella stessa migrazione:
tutti gli invii passeranno da qui, il client non farà mai un insert diretto su `match_messages`.

### 3.4 Realtime

`match_messages` è già in `supabase_realtime` publication (aggiunta nella migrazione di
hardening di backend-foundation) — nessuna modifica necessaria, la sottoscrizione lato client
(sezione 5) funziona da subito.

## 4. Schermate e flusso

### 4.1 Dettaglio partita — `app/(tabs)/home/match/[id].tsx` (estensione minima)

Un pulsante **"Chat"**, visibile se l'utente è il creatore oppure se `myParticipation.status` è
`approved`/`active`/`completed` (stessa condizione della RLS backend, replicata qui solo per
mostrare/nascondere il pulsante — mai come controllo di sicurezza, che resta interamente lato
server). Naviga a `app/(tabs)/home/match/[id]/chat.tsx`.

### 4.2 Nuova schermata Chat — `app/(tabs)/home/match/[id]/chat.tsx`

- `FlatList` invertita con i messaggi (bolla a destra per i propri, a sinistra per gli altri;
  nome mittente + orario), caricati inizialmente con `fetchMatchMessages` (ultimi 50, poi
  ordinati cronologicamente per la visualizzazione).
- Sottoscrizione Supabase Realtime (`postgres_changes`, evento `INSERT`, filtro `match_id=eq.<id>`
  su `match_messages`) aperta al mount, chiusa allo smontaggio: ogni nuovo messaggio arrivato
  viene accodato allo stato locale, sostituendo l'eventuale placeholder ottimistico corrispondente
  (match per un id temporaneo generato lato client al momento dell'invio).
- Campo di testo in basso con pulsante invio. Digitando `@` si apre un elenco dei partecipanti
  correnti idonei (stesso insieme che riceverebbe la notifica: `approved`/`active` + creatore,
  esclude sé stessi), filtrabile continuando a digitare; toccando un nome si inserisce `@Nome ` nel
  testo e si aggiunge l'id alla lista di menzioni del messaggio in composizione.
- Invio: mostra subito il messaggio (stato ottimistico) chiamando `sendMatchMessage(matchId, body,
  mentionedUserIds)`; su errore, il messaggio ottimistico viene rimosso e un errore inline appare
  vicino al campo di input (stesso pattern di errore già in uso nel resto dell'app).
- Errore nel fetch iniziale: messaggio inline con possibilità di riprovare (stesso pattern di
  `roster.error` in match/[id].tsx).

### 4.3 Notifiche — `app/(tabs)/home/notifications.tsx` (modifica minima)

Per `payload.type` `match_message` o `match_message_mention`, il tap naviga direttamente a
`match/[id]/chat` invece che al dettaglio partita generico (unica eccezione al comportamento
esistente, che per tutti gli altri tipi resta invariato).

## 5. Livello dati/API

**`src/api/matchMessages.ts`** (stesso stile di `src/api/participants.ts`):

```ts
export interface ChatMessage {
  id: string;
  match_id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

export interface ChatMessageWithSender extends ChatMessage {
  sender: { first_name: string; last_name: string; profile_image_url: string | null };
}

export async function fetchMatchMessages(matchId: string, limit = 50): Promise<ChatMessageWithSender[]>;
export async function sendMatchMessage(matchId: string, body: string, mentionedUserIds: string[]): Promise<ChatMessage>;
```

`fetchMatchMessages` fa due query (stesso pattern a due passaggi già usato per
`fetchMatchParticipantProfiles`: nessuna FK scopribile da PostgREST tra `sender_id` e
`user_public_profiles`, quindi niente `select` annidato). `sendMatchMessage` chiama
`supabase.rpc('send_match_message', ...)`.

**`src/hooks/useMatchChat.ts`** (nuovo):
- `messages`, `loading`, `error`, `refresh()` — fetch iniziale.
- `send(body, mentionedUserIds)` — invio ottimistico (id temporaneo `local-<timestamp>`),
  rimpiazzato dal messaggio reale in arrivo via realtime; su errore, rimozione + `sendError`.
- Sottoscrizione realtime gestita internamente con `useEffect`, chiusa al cleanup.
- `mentionCandidates`: deriva dallo stesso hook `useMatchRoster(matchId)` già esistente —
  `approvedParticipants` più il creatore (se l'utente corrente non è il creatore), **sempre
  escludendo l'utente corrente stesso** dall'elenco (né il creatore vede se stesso come opzione,
  né un partecipante può menzionare se stesso) — nessuna nuova query per popolare l'elenco del
  picker "@".

## 6. Testing

- **pgTAP** (nuovo file `supabase/tests/018_send_match_message.test.sql`): invio senza menzioni;
  invio con una menzione valida (verifica tipo e payload della notifica per il menzionato e per
  un partecipante non menzionato); rifiuto di una menzione verso un non-partecipante; il creatore
  può leggere e scrivere nella chat della propria partita senza avere una riga in
  `match_participants`; un partecipante `requested` (non ancora approvato) non può né leggere né
  scrivere.
- **Jest**: `matchMessages.test.ts` (fetch a due query, invio via RPC, mapping dei parametri);
  `useMatchChat.test.ts` (fetch iniziale, append da evento realtime mockato, invio ottimistico e
  sua sostituzione, rollback su invio fallito, derivazione di `mentionCandidates`).
- **Verifica manuale nel simulatore**: due utenti, uno apre la chat e scrive un messaggio
  menzionando l'altro; verifica che il messaggio appaia in tempo reale sul lato dell'altro utente
  senza refresh manuale, e che la notifica di menzione (testo distinto da quella generica) arrivi
  correttamente; verifica che il creatore (senza riga in `match_participants`) possa accedere e
  scrivere nella chat della propria partita.

## 7. Rischi e decisioni aperte

- **Rimozione del vecchio trigger `trg_notify_on_match_message`**: è un cambiamento del
  comportamento esistente, non solo un'aggiunta — da qui in poi ogni invio deve passare dalla
  nuova funzione RPC; un eventuale insert diretto su `match_messages` (bypassando la funzione)
  smetterebbe di generare notifiche. Accettato: il client mobile chiamerà sempre e solo la
  funzione, non esiste altro punto d'ingresso lato applicazione.
- **Nessuna evidenziazione visiva delle menzioni**: chi legge un messaggio vede "@Nome" come
  testo semplice, non uno stile distinto. Accettato come limite MVP, riportabile in un secondo
  momento senza toccare backend o dati già salvati.
- **Nessuna riconnessione esplicita della sottoscrizione realtime**: se la connessione cade e la
  libreria non la ripristina da sola, i messaggi altrui non appaiono finché non si riapre la
  schermata. Limite noto, accettato per l'MVP.
- **Cronologia limitata a 50 messaggi**: chat molto lunghe perdono i messaggi più vecchi dalla
  vista iniziale, senza modo di risalire. Estensione futura se il bisogno emerge realmente.
