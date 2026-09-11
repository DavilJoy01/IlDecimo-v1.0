# Eliminazione account — Design Spec

## 1. Goal and scope

La spec MVP originale (`2026-08-30-app-calcio-mvp-design.md`, sezione 9) richiede esplicitamente "logout ed elimina account per GDPR" — solo il logout è mai stato implementato. Questa è anche una precondizione tecnica per la pubblicazione su App Store/Play Store, che richiedono entrambi che l'utente possa cancellare account e dati in autonomia.

Decisioni prese in brainstorming, tutte esplicite e non di default:
- **Le partite create dall'utente vengono cancellate** insieme all'account (comportamento già presente via `on delete cascade`, nessuna logica aggiuntiva) — anche se future e con altri partecipanti già approvati dentro. Nessun avviso automatico agli altri partecipanti: fuori scope.
- **I messaggi inviati (chat di stanza e privati) restano**, ma il mittente viene mostrato come "Utente eliminato" — non si vuole distruggere il contesto delle conversazioni di chi li ha ricevuti.
- **Le partecipazioni a partite create da altri vengono rimosse** (la riga in `match_participants` viene cancellata), liberando il posto per qualcun altro.
- Il profilo (`public.users`) **non viene mai cancellato**, ma trasformato in un segnaposto anonimo — è l'unico modo per soddisfare "i messaggi restano ma il mittente è anonimo", dato che ogni riga che referenzia l'utente punta a `public.users`.
- Il numero di telefono reale viene liberato (sia in `public.users` che in `auth.users`), per permettere una futura registrazione con lo stesso numero.
- **Meccanismo**: una funzione Postgres `security definer` (`delete_own_account()`), coerente con ogni altra operazione sensibile già presente nel backend (`enforce_participant_state_machine`, `transition_match_statuses`, ecc.) — nessuna Edge Function, nessuna chiamata HTTP esterna, nessun nuovo segreto da gestire. Vedi sezione 4 per l'analisi delle alternative scartate.
- **Conferma**: alert "sei sicuro?" (azione irreversibile) seguito da re-inserimento della password attuale, prima di eseguire la cancellazione.
- **Posizione UI**: pulsante "Elimina account" dentro `mobile/app/(tabs)/profile/edit.tsx` (schermata "Modifica profilo"), non nella schermata Profilo principale — che resta con solo nome/statistiche/Modifica profilo/Esci.

Fuori ambito: cancellazione di account altrui (percorso admin); un periodo di "grazia" prima della cancellazione definitiva (es. 30 giorni per ripensarci — nessuna spec lo ha mai richiesto, e complica sostanzialmente il modello dati); notificare gli altri partecipanti quando una partita a cui erano iscritti viene cancellata per l'eliminazione del creatore.

## 2. Schema e funzione (backend)

Nessuna nuova tabella. Una nuova funzione RPC.

### 2.1 Vincoli NOT NULL da rispettare nell'anonimizzazione

`public.users` ha `phone`, `first_name`, `last_name`, `birth_date`, `height_cm`, `preferred_foot`, `player_role` tutti `not null` (più `phone` con vincolo `unique`) — l'anonimizzazione deve scrivere valori validi, non `null`, in questi campi:

```sql
first_name = 'Utente'
last_name = 'eliminato'
phone = 'deleted-' || id::text   -- unico per costruzione (id è la PK), libera il numero reale
birth_date = '2000-01-01'        -- valore sentinella, non identificativo
profile_image_url = null         -- già nullable
```

`height_cm`, `preferred_foot`, `player_role`, `unique_user_id` restano invariati: non sono dati identificativi una volta rimossi nome/foto/telefono, e modificarli non aggiunge protezione reale (YAGNI).

### 2.2 Perché anonimizzare `public.users` invece di cancellarlo

Ogni tabella con dati da preservare (`match_messages`, `private_messages`, `notifications`, `friendships`, `user_blocks`, `reports`) referenzia `public.users(id) on delete cascade`. Cancellare la riga le cancellerebbe a cascata — compreso il contenuto dei messaggi che si è deciso di preservare. L'unica strada per "il messaggio resta, il mittente è anonimo" è che la riga `public.users` continui a esistere, sotto una nuova identità placeholder. Le tabelle elencate non richiedono nessuna modifica: il `join` verso `public.users` restituirà automaticamente "Utente" / "eliminato" ovunque il nome venga mostrato.

### 2.3 `auth.users` — disabilitare l'accesso senza cancellare la riga

`auth.users.id` è la chiave a cui `public.users.id` fa riferimento con `on delete cascade` — cancellare la riga `auth.users` cancellerebbe a cascata anche il segnaposto appena creato in `public.users`, vanificando il punto 2.2. La riga `auth.users` va quindi **mantenuta ma resa inutilizzabile**:

```sql
phone = null                              -- libera il numero anche lato GoTrue (colonna nullable, vincolo unique rispettato: più NULL sono ammessi)
phone_confirmed_at = null
encrypted_password = crypt(gen_random_uuid()::text, gen_salt('bf'))  -- password casuale, mai comunicata a nessuno
banned_until = '2999-12-31'::timestamptz  -- blocca ogni futuro tentativo di login, colonna nativa di GoTrue
```

Nessuna chiamata all'Admin API di GoTrue: sono tutti campi di una tabella Postgres reale, scrivibili direttamente da una funzione `security definer` con i privilegi del proprio owner — lo stesso meccanismo già usato da ogni altra funzione sensibile di questo backend.

### 2.4 La funzione completa

```sql
-- supabase/migrations/20260911000000_add_delete_own_account.sql
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'must be authenticated to delete an account';
  end if;

  -- 1. Partite create dall'utente: cascata già esistente ripulisce
  -- match_participants, match_messages, match_message_mentions, match_invitations
  -- di quelle partite.
  delete from public.matches where creator_id = v_uid;

  -- 2. Partecipazioni a partite create da altri: libera il posto.
  delete from public.match_participants where user_id = v_uid;

  -- 3. Anonimizza il profilo pubblico -- MAI cancellato, per preservare
  -- i messaggi già inviati (restano, mittente mostrato come "Utente eliminato").
  update public.users
  set first_name = 'Utente',
      last_name = 'eliminato',
      phone = 'deleted-' || v_uid::text,
      birth_date = '2000-01-01',
      profile_image_url = null
  where id = v_uid;

  -- 4. Disabilita l'accesso senza cancellare la riga (vedi 2.3 per il perché).
  update auth.users
  set phone = null,
      phone_confirmed_at = null,
      encrypted_password = crypt(gen_random_uuid()::text, gen_salt('bf')),
      banned_until = '2999-12-31'::timestamptz
  where id = v_uid;
end;
$$;

grant execute on function public.delete_own_account() to authenticated;
revoke execute on function public.delete_own_account() from public, anon;
```

Nota: `crypt`/`gen_salt` richiedono l'estensione `pgcrypto`, già installata in questo progetto (usata da GoTrue stesso per le password esistenti) — nessuna nuova estensione da abilitare.

### 2.5 Perché non un'Edge Function o `pg_net` verso l'Admin API (alternative scartate)

Il progetto non ha mai usato Edge Function; introdurne una solo per questa funzionalità significa gestire per la prima volta un componente di infrastruttura nuovo, con un segreto (`service_role` key, accesso admin completo) che va protetto in un posto nuovo. Una funzione Postgres `security definer` che scrive direttamente su `auth.users` (tabella Postgres reale, non un'astrazione HTTP) ottiene lo stesso risultato senza introdurre nessun nuovo segreto né nessuna chiamata di rete — e replica esattamente il pattern già in uso in tutto il resto del backend.

## 3. Frontend

### 3.1 Nuova funzione API

```ts
// mobile/src/api/auth.ts (aggiunta)
export async function deleteOwnAccount(): Promise<void> {
  const { error } = await supabase.rpc('delete_own_account');
  if (error) throw error;
}
```

### 3.2 UI — `mobile/app/(tabs)/profile/edit.tsx`

Sezione "zona pericolosa" renderizzata come elemento **fratello di `<ProfileForm>`**, non al suo interno: `ProfileForm` è condiviso con la schermata di registrazione (`mobile/app/(auth)/create-profile.tsx`), che non deve mai mostrare questa opzione. `ProfileForm` incapsula già il proprio `ScrollView` interno per i campi del modulo — il pulsante va quindi dopo, nel flusso normale (non-scrollabile) dello `View` esterno della schermata, non annidato in un secondo `ScrollView`. Verificare a schermo durante l'implementazione che non ci sia sovrapposizione visiva se il form è molto lungo.

Flusso al tocco di "Elimina account" (stile testo rosso, sotto il form, separato da un margine più ampio del resto):
1. `Alert.alert` con titolo tipo "Elimina il tuo account" e testo che spiega l'irreversibilità e cosa succede (partite create cancellate, messaggi resi anonimi) — pulsanti "Annulla" / "Continua".
2. Se "Continua": un secondo step chiede la password attuale (un `TextInput` inline con `secureTextEntry`, non un altro Alert — Alert.prompt non è supportato su Android). Un pulsante "Conferma eliminazione".
3. Verifica della password: `signInWithPassword(profile.phone, enteredPassword)` (funzione già esistente in `mobile/src/api/auth.ts`, riusata così com'è) — se fallisce, mostra "Password errata" e resta sullo step 2; se ha successo, procede.
4. Elimina **tutte** le foto profilo caricate nel bucket `profile-images` sotto il prefisso `${userId}/` — non solo quella attualmente attiva: `mobile/src/api/users.ts`'s `uploadProfileImage` non cancella mai la foto precedente ad ogni modifica (ogni upload usa un path con timestamp nuovo, per garantire un URL pubblico sempre fresco), quindi foto di versioni passate del profilo possono essere ancora presenti nel bucket, pubblicamente raggiungibili via URL diretto. Va quindi prima elencato il contenuto della cartella (`supabase.storage.from('profile-images').list(userId)`) e poi rimosso ogni file trovato (`.remove(paths)`) — non basta cancellare solo il file puntato da `profile.profile_image_url`. Chiamata separata dalla RPC: lo Storage non è raggiungibile da SQL.
5. Chiama `deleteOwnAccount()`.
6. `supabase.auth.signOut()` e redirect alla schermata di login (`useSessionStore` si aggiorna da solo tramite il listener già esistente sull'auth state, nessuna logica di navigazione nuova da scrivere).

### 3.3 Gestione errori

Se il passo 5 (RPC) fallisce dopo che il passo 4 (cancellazione foto) è già andato a buon fine: la foto è persa ma l'account resta intatto — l'utente può semplicemente ricaricarne una nuova da "Modifica profilo". Non è un problema pratico: mostrare un errore generico ("Impossibile completare l'eliminazione, riprova") e restare sulla schermata, senza fare sign-out.

## 4. Testing

- **pgTAP** (`supabase/tests/026_delete_own_account.test.sql`, nuovo file): verifica che dopo la chiamata, le partite create dall'utente non esistano più; le sue partecipazioni altrove siano rimosse; un messaggio inviato prima della cancellazione esista ancora ma la join verso `public.users` mostri "Utente" "eliminato"; `auth.users.banned_until` sia impostato e un tentativo di login con le vecchie credenziali fallisca; il vecchio numero di telefono sia riutilizzabile da una nuova registrazione (nessun conflitto di unicità).
- **Manuale**: registrare un utente di test, creare una partita, farne approvare un secondo utente in una partita di un terzo, mandare un messaggio in una chat, poi eliminare l'account del primo utente e verificare a video ogni conseguenza elencata sopra, incluso il redirect al login e l'impossibilità di accedere di nuovo con le vecchie credenziali.
