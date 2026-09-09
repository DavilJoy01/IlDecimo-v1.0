# Storico pubblico partite — Design Spec

## 1. Goal and scope

Oggi il profilo di una persona (`people/user/[id].tsx`) mostra solo statistiche aggregate (`matches_played_count`, `matches_completed_count`) senza alcun dettaglio sulle partite giocate. Questo piano aggiunge una sezione "Storico partite" al profilo di ogni persona, che elenca le sue partite passate (create o partecipate, effettivamente concluse), visibile a chiunque apra quel profilo — con lo stesso livello di accesso pubblico che il profilo ha oggi, salvo un blocco tra le due parti.

Questo piano chiude anche un gap di privacy già noto e documentato (vedi memoria di progetto, piano `persone`): oggi `useUserProfile.load()` legge `user_public_profiles` direttamente, senza alcun controllo sui blocchi — un utente che conosce l'id di un altro può vederne il profilo anche se quest'ultimo lo ha bloccato. Le due nuove funzioni RPC introdotte qui (profilo e storico) chiudono questo gap per entrambe le superfici.

Fuori ambito: link dalla riga dello storico alla schermata di dettaglio partita (deciso esplicitamente in brainstorming — la riga è puramente informativa); un filtro per tipo di partita o intervallo di date; l'esposizione dello storico ad utenti non autenticati.

## 2. Schema e permessi (backend)

Nessuna nuova tabella. Due nuove funzioni RPC `security definer`, seguendo il pattern già stabilito in questo progetto per i casi che RLS dichiarativa non può esprimere bene (`search_user_by_code`, `send_match_message`).

### 2.1 Helper condiviso

```sql
create or replace function public.is_blocked_either_direction(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

revoke all on function public.is_blocked_either_direction(uuid, uuid) from public;
grant execute on function public.is_blocked_either_direction(uuid, uuid) to authenticated;
```

`user_blocks` ha RLS che permette a un utente di leggere solo le proprie righe come `blocker_id` — questa funzione, essendo `security definer`, bypassa quella restrizione internamente per controllare entrambe le direzioni, ma non espone mai *chi* ha bloccato chi al chiamante: ritorna solo un booleano.

### 2.2 `get_user_profile`

```sql
create or replace function public.get_user_profile(target_id uuid)
returns setof public.user_public_profiles
language sql
stable
security definer
set search_path = ''
as $$
  select p.*
  from public.user_public_profiles p
  where p.id = target_id
    and not public.is_blocked_either_direction(auth.uid(), target_id);
$$;

revoke all on function public.get_user_profile(uuid) from public;
grant execute on function public.get_user_profile(uuid) to authenticated;
```

Se una delle due parti ha bloccato l'altra, la funzione ritorna zero righe — identico, dal punto di vista del chiamante, al caso "utente inesistente" già gestito oggi da `useUserProfile` come "Utente non trovato". Questo evita di rivelare l'esistenza di un blocco, coerente col principio "mai rivelare un blocco all'altra parte" già seguito altrove nel progetto (`persone`, `messaggi`).

### 2.3 `get_user_match_history`

```sql
create or replace function public.get_user_match_history(
  target_id uuid,
  before_date date default null,
  before_time time default null,
  before_id uuid default null,
  page_size int default 20
)
returns table (
  match_id uuid,
  role text,
  outcome text,
  match_type integer,
  field_name text,
  address text,
  match_date date,
  start_time time
)
language sql
stable
security definer
set search_path = ''
as $$
  with history as (
    select
      m.id as match_id,
      'creator'::text as role,
      m.status as outcome,
      m.match_type,
      m.field_name,
      m.address,
      m.match_date,
      m.start_time
    from public.matches m
    where m.creator_id = target_id
      and m.status = 'completed'

    union all

    select
      m.id as match_id,
      'participant'::text as role,
      mp.status as outcome,
      m.match_type,
      m.field_name,
      m.address,
      m.match_date,
      m.start_time
    from public.match_participants mp
    join public.matches m on m.id = mp.match_id
    where mp.user_id = target_id
      and mp.status in ('completed', 'left')
      and m.status = 'completed'
  )
  select *
  from history h
  where not public.is_blocked_either_direction(auth.uid(), target_id)
    and (
      before_date is null
      or (h.match_date, h.start_time, h.match_id) < (before_date, before_time, before_id)
    )
  order by h.match_date desc, h.start_time desc, h.match_id desc
  limit page_size;
$$;

revoke all on function public.get_user_match_history(uuid, date, time, uuid, int) from public;
grant execute on function public.get_user_match_history(uuid, date, time, uuid, int) to authenticated;
```

Note:
- `role` distingue "creata da questa persona" da "questa persona vi ha partecipato" — una stessa partita non può mai comparire due volte per lo stesso utente (il creatore non ha mai una riga `match_participants` propria, confermato durante `match-room-chat`), quindi la `union all` non produce duplicati.
- `outcome` per il ruolo `creator` è sempre `'completed'` (per costruzione del filtro `where m.status = 'completed'`); per il ruolo `participant` è `'completed'` o `'left'` — la UI mappa questi in etichette italiane.
- Il cursore `(before_date, before_time, before_id)` usa un confronto per tupla su colonne che esistono già (nessun indice nuovo necessario per l'MVP: `matches` ha già poche migliaia di righe attese; se servisse in futuro, un indice su `(creator_id, status, match_date desc)` e uno su `(user_id, status)` per `match_participants` sono l'estensione naturale, non richiesta ora).
- Bloccato in una delle due direzioni → zero righe, stesso trattamento silenzioso di `get_user_profile`.

## 3. Data layer e hook mobile

### 3.1 `src/api/users.ts` (estensione)

Due nuove funzioni:

```ts
export async function fetchUserProfile(targetId: string): Promise<TargetProfile | null> {
  const { data, error } = await supabase.rpc('get_user_profile', { target_id: targetId });
  if (error) throw new Error(error.message);
  return (data?.[0] as TargetProfile) ?? null;
}

export interface MatchHistoryEntry {
  match_id: string;
  role: 'creator' | 'participant';
  outcome: 'completed' | 'left';
  match_type: 5 | 7 | 8;
  field_name: string;
  address: string;
  match_date: string;
  start_time: string;
}

export async function fetchUserMatchHistory(
  targetId: string,
  cursor: { date: string; time: string; id: string } | null,
  pageSize = 20,
): Promise<MatchHistoryEntry[]> {
  const { data, error } = await supabase.rpc('get_user_match_history', {
    target_id: targetId,
    before_date: cursor?.date ?? null,
    before_time: cursor?.time ?? null,
    before_id: cursor?.id ?? null,
    page_size: pageSize,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as MatchHistoryEntry[];
}
```

`useUserProfile`'s esistente `load()` sostituisce la query diretta `supabase.from('user_public_profiles').select('*').eq('id', targetUserId).single()` con `fetchUserProfile(targetUserId)`. Il comportamento "not found" (oggi un errore da `.single()` su zero righe) diventa un controllo esplicito su `null` — stesso messaggio d'errore utente-facing ("Utente non trovato"), path di codice leggermente diverso.

### 3.2 Nuovo hook `useUserMatchHistory`

`mobile/src/hooks/useUserMatchHistory.ts`:

```ts
export function useUserMatchHistory(targetId: string) {
  const [matches, setMatches] = useState<MatchHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const PAGE_SIZE = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchUserMatchHistory(targetId, null, PAGE_SIZE);
      setMatches(page);
      setHasMore(page.length === PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile caricare lo storico.');
    } finally {
      setLoading(false);
    }
  }, [targetId]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || matches.length === 0) return;
    setLoadingMore(true);
    try {
      const last = matches[matches.length - 1];
      const page = await fetchUserMatchHistory(
        targetId,
        { date: last.match_date, time: last.start_time, id: last.match_id },
        PAGE_SIZE,
      );
      setMatches((prev) => [...prev, ...page]);
      setHasMore(page.length === PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile caricare altre partite.');
    } finally {
      setLoadingMore(false);
    }
  }, [targetId, matches, loadingMore, hasMore]);

  useEffect(() => { load(); }, [load]);

  return { matches, loading, loadingMore, error, hasMore, loadMore, retry: load };
}
```

Pattern nuovo per questo codebase (nessun hook esistente fa paginazione a cursore), ma deliberatamente minimale: niente cache cross-schermata, niente invalidazione — lo storico di un'altra persona non cambia abbastanza spesso da giustificarla, coerente con lo stile "hook sottile" di `useNearbyMatches`/`useConversations`.

### 3.3 Schermata

In `people/user/[id].tsx`, sotto il blocco azioni (richiesta amicizia/messaggio/segnala/blocca) esistente, una nuova sezione:

- Intestazione "Storico partite" (`typography.screenTitle` o `label`, da confermare in fase di implementazione con lo stile già presente nella schermata).
- Una riga per voce di storico: data (`DD/MM/AAAA`) + orario, un badge col tipo partita (5/7/8, stesso stile chip già usato in `MatchForm`), campo e indirizzo, e un'etichetta ruolo+esito:
  - `role='creator'` → "Partita creata"
  - `role='participant', outcome='completed'` → "Partecipante"
  - `role='participant', outcome='left'` → "Partecipante (uscito prima della fine)"
- Stato vuoto: "Nessuna partita nello storico." se `matches.length === 0` dopo il primo caricamento.
- Errore: messaggio + pulsante "Riprova" che chiama `retry()`, indipendente dall'eventuale errore del profilo principale sopra.
- Scroll infinito: `onEndReached` sulla lista chiama `loadMore()`; uno spinner piccolo in fondo quando `loadingMore` è vero.

## 4. Error handling

- `get_user_profile` senza righe (bloccato o utente inesistente): comportamento identico a oggi, nessun nuovo stato UI.
- Fallimento di rete/RPC sullo storico: errore isolato con "Riprova", non blocca il resto del profilo.
- Auto-visita al proprio profilo: il redirect esistente a `/(tabs)/profile` resta invariato; le chiamate ai nuovi hook partono comunque prima del redirect ma sono innocue (nessun side effect visibile).

## 5. Testing

**pgTAP** (nuovo file `supabase/tests/0XX_user_profile_and_history.test.sql`):
- `get_user_profile` ritorna la riga quando non c'è blocco tra le due parti.
- `get_user_profile` non ritorna righe se A ha bloccato B, chiamata come A o come B (entrambe le direzioni).
- `get_user_match_history` include una partita creata-e-completata con `role='creator'`.
- Include una partita partecipata con esito `'completed'` e una con `'left'`, entrambe con `role='participant'`.
- Esclude una partita creata ma con status diverso da `'completed'` (es. `'cancelled'`, `'open'`).
- Esclude una partecipazione con status `'requested'`/`'rejected'`/`'active'`.
- La paginazione a cursore non ripete né salta righe su due chiamate consecutive (prima pagina + seconda pagina con l'ultimo cursore).
- Nessuna riga se bloccato in una delle due direzioni.

**Jest**:
- `fetchUserProfile`/`fetchUserMatchHistory` chiamano `supabase.rpc` con i parametri attesi (mockato).
- `useUserMatchHistory`: stato iniziale (`loading=true`), dopo il primo caricamento popola `matches` e imposta `hasMore` correttamente; `loadMore` accoda risultati e aggiorna il cursore; `hasMore` diventa `false` quando l'ultima pagina è più corta di `PAGE_SIZE`; un errore su `loadMore` non svuota `matches` già caricati.
- Aggiornamento dei test esistenti di `useUserProfile` per il nuovo path via `fetchUserProfile` (mock di `supabase.rpc` invece di `supabase.from(...).select(...).single()`).

Nessuna modifica alla UI esistente del profilo (statistiche, azioni amicizia) — solo aggiunta additiva della sezione storico.

## 6. Cosa non copre questo piano

Link dalla riga dello storico al dettaglio partita; filtri (per tipo partita, intervallo date); ricerca testuale nello storico; indici Postgres dedicati (rimandati a se e quando servissero per volume reale di dati); esposizione dello storico ad utenti non autenticati; un "mio storico" nella schermata Profilo propria (fuori scope esplicito di questa richiesta, che riguardava il profilo di *altre* persone — un follow-up naturale ma non richiesto qui).
