# Squadre partita — Design Spec

## 1. Goal and scope

Oggi la schermata di dettaglio partita mostra il roster dei partecipanti approvati come una lista piatta, senza alcuna nozione di squadra. Questo piano introduce la divisione in due squadre fisse ("Squadra A" / "Squadra B") per i partecipanti approvati di una partita, assegnabile manualmente dal creatore in qualsiasi momento prima dell'inizio della partita.

Decisioni prese in brainstorming, tutte esplicite e non di default:
- Divisione **manuale** dal creatore — nessuna assegnazione automatica/casuale.
- **Sempre 2 squadre** ("Squadra A"/"Squadra B", etichette fisse, non personalizzabili), indipendentemente da `match_type`.
- Il creatore può assegnare/modificare **in qualsiasi momento**, non solo a roster completo.
- Limite per squadra: **`match_type`** giocatori (es. 5 per una 5v5) — nessuno sbilanciamento oltre quel limite.
- Se un partecipante lascia la partita (o viene rimosso), la sua assegnazione squadra **si azzera**; se si ri-iscrive va riassegnato da capo.
- Visibile solo a **partecipanti approvati/attivi e al creatore** — stessa visibilità già in vigore per il roster.

Fuori ambito: nomi di squadra personalizzabili; più di 2 squadre; assegnazione automatica/casuale; collegamento con lo storico partite (`storico-pubblico`, già shippato) per mostrare in quale squadra si è giocato — un follow-up naturale ma non richiesto qui.

## 2. Schema e trigger (backend)

Nessuna nuova tabella. Una colonna aggiuntiva su `match_participants`, più un'estensione del trigger di stato-macchina già esistente (`enforce_participant_state_machine`).

### 2.1 Colonna

```sql
alter table public.match_participants
  add column team text check (team in ('A', 'B'));
```

`team` è `null` di default (non assegnato). Nessuna modifica a `user_public_profiles` o ad altre tabelle.

### 2.2 Trigger — perché serve un nuovo ramo esplicito

Il trigger esistente (`supabase/migrations/20260830100300_create_match_participants_table.sql`) valida ogni `UPDATE` su `match_participants` con una catena `if/elsif` sulle transizioni `old.status → new.status`; il ramo `else` finale solleva `'invalid participation status transition from % to %'` per qualunque combinazione non esplicitamente gestita — **incluso il caso in cui `status` non cambia affatto**, che è esattamente la forma che un `UPDATE` "solo team" assume. Senza un ramo dedicato, ogni tentativo di assegnare una squadra fallirebbe con quell'eccezione, indipendentemente da quanto sia valido il cambiamento di `team`.

Serve quindi:
1. Un nuovo ramo `elsif new.status = old.status then` che gestisce gli update che non cambiano `status`, con le sue proprie validazioni per `team`.
2. Nei rami di transizione `status` già esistenti, un `new.team := old.team;` esplicito — un singolo `UPDATE` non può cambiare `status` e `team` insieme; se un client lo tenta, il cambio di `team` viene **ignorato silenziosamente** (non è un errore, è semplicemente non applicato), dato che nessuna combinazione del genere è mai generata dalla UI di questo piano (che fa sempre chiamate separate) — comportamento deliberato, non un bug da difendersi ulteriormente.
3. Nel ramo `status = 'left'`, un `new.team := null;` esplicito — azzeramento automatico dell'assegnazione all'uscita, come deciso in brainstorming.

### 2.3 Migrazione completa

```sql
-- supabase/migrations/20260910000000_add_match_participant_teams.sql
alter table public.match_participants
  add column team text check (team in ('A', 'B'));

create or replace function public.enforce_participant_state_machine()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator_id uuid;
  v_match_type integer;
  v_team_count integer;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'requested' then
      raise exception 'a new participation must start as requested';
    end if;
    if new.user_id is distinct from auth.uid() then
      raise exception 'a user can only request participation for themselves';
    end if;
    new.join_count := 1;
    new.leave_count := 0;
    new.requested_at := now();
    new.approved_at := null;
    new.left_at := null;
    new.team := null;
    return new;
  end if;

  if new.match_id is distinct from old.match_id then
    raise exception 'match_id cannot be changed';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id cannot be changed';
  end if;

  select creator_id into v_creator_id from public.matches where id = old.match_id;

  new.join_count := old.join_count;
  new.leave_count := old.leave_count;
  new.requested_at := old.requested_at;
  new.approved_at := old.approved_at;
  new.left_at := old.left_at;

  if new.status = 'requested' and old.status = 'left' then
    if auth.uid() is distinct from old.user_id then
      raise exception 'only the participant themselves can re-request to join';
    end if;
    if old.leave_count >= 2 then
      raise exception 'maximum number of re-entries (2) reached for this match';
    end if;
    new.join_count := old.join_count + 1;
    new.requested_at := now();
    new.approved_at := null;
    new.left_at := null;
    new.team := old.team;

  elsif new.status in ('approved','rejected') and old.status = 'requested' then
    if auth.uid() is distinct from v_creator_id then
      raise exception 'only the match creator can approve or reject a request';
    end if;
    if new.status = 'approved' then
      new.approved_at := now();
    end if;
    new.team := old.team;

  elsif new.status = 'active' and old.status = 'approved' then
    if auth.uid() is distinct from v_creator_id then
      raise exception 'only the match creator can activate a participant';
    end if;
    new.team := old.team;

  elsif new.status = 'left' and old.status in ('approved','active') then
    if auth.uid() is distinct from old.user_id then
      raise exception 'only the participant themselves can leave the match';
    end if;
    new.leave_count := old.leave_count + 1;
    new.left_at := now();
    new.team := null;

  elsif new.status = 'completed' and old.status in ('approved','active') then
    if auth.uid() is not null and auth.uid() is distinct from v_creator_id then
      raise exception 'only the match creator or the system can mark a participation completed';
    end if;
    new.team := old.team;

  elsif new.status = old.status then
    if new.team is distinct from old.team then
      if auth.uid() is distinct from v_creator_id then
        raise exception 'only the match creator can assign a team';
      end if;
      if old.status not in ('approved', 'active') then
        raise exception 'only an approved or active participant can be assigned a team';
      end if;
      if new.team is not null then
        select match_type into v_match_type from public.matches where id = old.match_id;
        select count(*) into v_team_count
        from public.match_participants
        where match_id = old.match_id and team = new.team and id <> old.id;
        if v_team_count >= v_match_type then
          raise exception 'team % is already full', new.team;
        end if;
      end if;
    end if;

  else
    raise exception 'invalid participation status transition from % to %', old.status, new.status;
  end if;

  return new;
end;
$$;
```

Nessuna nuova RLS: `participants_update_self_or_creator` già permette al creatore di aggiornare qualunque riga della propria partita — il trigger sopra è l'unico punto che restringe *chi* può cambiare *cosa*.

## 3. Data layer e hook mobile

### 3.1 `src/api/participants.ts` (estensione)

```ts
export interface ParticipantProfile {
  // ... campi esistenti invariati ...
  team: 'A' | 'B' | null;
}

export async function assignTeam(participantId: string, team: 'A' | 'B' | null): Promise<void> {
  const { error } = await supabase.from('match_participants').update({ team }).eq('id', participantId);
  if (error) throw new Error(translateTeamAssignmentError(error.message));
}

const TEAM_FULL_PATTERN = /^team [AB] is already full$/;

function translateTeamAssignmentError(message: string): string {
  if (TEAM_FULL_PATTERN.test(message)) {
    return 'La squadra è già al completo.';
  }
  return message;
}
```

`fetchMatchParticipantProfiles` aggiunge `team` alla `select` su `match_participants` (`'id, user_id, status, team'`) e la riporta nell'oggetto `ParticipantProfile` costruito in fondo alla funzione.

### 3.2 `useMatchRoster` (estensione)

```ts
const unassignedParticipants = approvedParticipants.filter((p) => !p.team);
const teamAParticipants = approvedParticipants.filter((p) => p.team === 'A');
const teamBParticipants = approvedParticipants.filter((p) => p.team === 'B');

async function assignParticipantTeam(participantId: string, team: 'A' | 'B' | null): Promise<boolean> {
  setActionLoading(true);
  setError(null);
  try {
    await assignTeam(participantId, team);
    await load();
    return true;
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Impossibile assegnare la squadra.');
    return false;
  } finally {
    setActionLoading(false);
  }
}
```

Ritorno esteso: `{ pendingRequests, approvedParticipants, unassignedParticipants, teamAParticipants, teamBParticipants, loading, error, actionLoading, approve, reject, assignParticipantTeam, refresh: load }`.

### 3.3 Schermata

Nella schermata di dettaglio partita, la sezione esistente che mostra `approvedParticipants` (già visibile a creatore e partecipanti approvati/attivi) viene sostituita da tre sotto-sezioni, in quest'ordine: **Squadra A**, **Squadra B**, **Non assegnati** — ciascuna renderizzata solo se non vuota, tranne "Non assegnati" che compare sempre quando ci sono partecipanti approvati (anche se già tutti assegnati, mostra "Nessuno" — coerente con lo stile "stato vuoto esplicito" già usato altrove nell'app).

Per il creatore, ogni `ParticipantRow` porta due chip toccabili nello slot `children`:
```tsx
<View style={styles.teamChips}>
  <Pressable
    style={withPressed(profile.team === 'A' ? styles.teamChipActive : styles.teamChip)}
    disabled={roster.actionLoading || (profile.team !== 'A' && teamAParticipants.length >= match.match_type)}
    onPress={() => roster.assignParticipantTeam(profile.participant_id, profile.team === 'A' ? null : 'A')}
  >
    <Text style={profile.team === 'A' ? styles.teamChipTextActive : styles.teamChipText}>A</Text>
  </Pressable>
  <Pressable
    style={withPressed(profile.team === 'B' ? styles.teamChipActive : styles.teamChip)}
    disabled={roster.actionLoading || (profile.team !== 'B' && teamBParticipants.length >= match.match_type)}
    onPress={() => roster.assignParticipantTeam(profile.participant_id, profile.team === 'B' ? null : 'B')}
  >
    <Text style={profile.team === 'B' ? styles.teamChipTextActive : styles.teamChipText}>B</Text>
  </Pressable>
</View>
```
Tap su un chip non attivo assegna a quella squadra; tap sul chip già attivo rimuove l'assegnazione (torna a "Non assegnati"); il chip è disabilitato (non il tap rimosso, solo lo stato visivo `disabled`) quando la squadra è già piena, a meno che il tap sia proprio per liberare un posto togliendo quel giocatore.

Per gli altri partecipanti (sola lettura), nessun `children` — le tre sotto-sezioni stesse comunicano l'appartenenza, nessuna etichetta aggiuntiva necessaria per riga.

## 4. Error handling

- Squadra piena: messaggio "La squadra è già al completo." (tradotto lato client da `translateTeamAssignmentError`), mostrato inline nella sezione squadre senza bloccare il resto della schermata — stesso pattern già in uso per `roster.error` con approve/reject.
- Ogni altro errore del trigger (non-creatore, partecipante non approvato) non è raggiungibile dalla UI di questo piano (i chip esistono solo per il creatore su `approvedParticipants`), quindi resta un messaggio grezzo di fallback — difesa in profondità lato DB, non un caso reale da tradurre.
- Nessun nuovo stato di caricamento globale: riuso `roster.actionLoading` già esistente (già copre approve/reject), esteso a coprire anche `assignParticipantTeam`.

## 5. Testing

**pgTAP** (nuovo file `supabase/tests/025_match_participant_teams.test.sql`):
- Il creatore può assegnare un partecipante `approved` a `team='A'`.
- Fallisce se chi tenta l'assegnazione non è il creatore.
- Fallisce se il partecipante è `requested` (non ancora approvato).
- Fallisce quando la squadra ha già raggiunto `match_type` giocatori (creare una partita `match_type=5`, riempire 5 partecipanti in `team='A'`, il sesto tentativo fallisce con `'team A is already full'`).
- Il tentativo del sesto giocatore su `team='B'` invece riesce (il limite è per singola squadra, non aggregato).
- `team` si azzera automaticamente a `null` quando lo status passa a `'left'`.
- Un `UPDATE` che cambia solo `team` (status invariato) ora funziona correttamente (verifica che il bug del ramo `else` sia risolto).
- Un `UPDATE` che tenta di cambiare `status` e `team` nella stessa chiamata ignora silenziosamente il cambio di `team` (verifica esplicita del comportamento deciso in §2.2, non un errore).
- Rimuovere un'assegnazione esistente (`team: 'A' → null`) funziona come il creatore.

**Jest**:
- `assignTeam` in `src/api/participants.test.ts` chiama l'update coi parametri attesi; verifica la traduzione del messaggio "team A is already full" → italiano.
- `useMatchRoster.test.ts`: il raggruppamento `unassignedParticipants`/`teamAParticipants`/`teamBParticipants` riflette correttamente il campo `team` di ogni profilo; `assignParticipantTeam` chiama `assignTeam` e ricarica il roster; un fallimento imposta `error` senza alterare le liste già caricate.
- Nessun test automatico per la schermata (coerente con la convenzione già in uso in questo progetto per gli screen).

## 6. Cosa non copre questo piano

Nomi di squadra personalizzabili; più di due squadre; assegnazione automatica/casuale come punto di partenza; visualizzazione della squadra di appartenenza nello storico partite (`storico-pubblico`) — un follow-up naturale, non richiesto qui; una vista "sola lettura" dedicata per chi guarda la partita da fuori senza aver ancora richiesto di partecipare (esplicitamente escluso: le squadre restano visibili solo a partecipanti approvati/attivi e al creatore).
