# Modifica profilo — Design Spec

## 1. Contesto e obiettivo

La schermata Profilo (`mobile/app/(tabs)/profile/index.tsx`) è oggi puramente
di sola lettura: mostra i dati raccolti una volta sola in fase di
registrazione (`create-profile.tsx`) e non offre alcun modo di modificarli.
Questo era stato esplicitamente rimandato durante il piano `persone`
("editing your own profile (separate small follow-up)").

Il backend permette già tecnicamente l'update della propria riga
(`users_update_self`, `auth.uid() = id`), ma senza alcuna restrizione di
colonna — un client può oggi scrivere anche `phone`, `unique_user_id` e i
tre contatori partite, che non devono mai essere modificabili dall'utente.
Questa spec chiude quel gap contestualmente all'introduzione della modifica
profilo, invece di lasciarlo aperto.

L'utente ha inoltre chiesto di includere la possibilità di caricare/
cambiare la foto profilo, che richiede di introdurre Supabase Storage in
questo progetto per la prima volta — nessun bucket esiste ancora.

## 2. Scope

**Dentro lo scope:**
- Una nuova schermata "Modifica profilo" che permette di cambiare nome,
  cognome, data di nascita, altezza, piede preferito, ruolo e foto
  profilo.
- Restringere `users_update_self` ai soli campi editabili via migrazione,
  in modo che il backend applichi la regola indipendentemente dal client
  (principio già consolidato in questo progetto: mai fidarsi solo del
  client per le regole di business).
- Un bucket Supabase Storage pubblico per le foto profilo, con RLS che
  limita ogni utente a scrivere solo sotto il proprio path.
- Estrazione di un componente `ProfileForm` condiviso tra la schermata di
  registrazione (`create-profile.tsx`) e la nuova schermata di modifica —
  mirror del pattern già stabilito da `MatchForm` (condiviso tra
  create-match e la modalità edit di match/[id]/index.tsx).
- Correzione mirata di un bug preesistente incontrato toccando questo
  codice: le chip "piede preferito"/"ruolo" mostrano oggi i valori grezzi
  in inglese (`left`, `goalkeeper`, ...) invece delle etichette italiane
  già definite in `profileDisplay.ts` e già usate correttamente altrove
  (es. la stessa schermata Profilo).

**Fuori scope:**
- Compressione/resize dell'immagine lato client — accettabile alle
  dimensioni d'uso attuali di questo progetto.
- Cambio del numero di telefono (è legato all'identità di autenticazione,
  richiederebbe un flusso OTP separato — non richiesto).
- Rigenerazione retroattiva di `unique_user_id` o modifica dei contatori
  partite — questi restano scritti solo dal backend/dai trigger esistenti.

## 3. Backend

Una sola nuova migrazione — vedi la correzione sotto.

### 3.1 Restringere `users_update_self` ai soli campi editabili — **CORREZIONE: non serve, esiste già**

**Questa sezione, nella sua versione originale, proponeva un nuovo
trigger per proteggere `phone`/`unique_user_id`/i tre contatori
partite.** Durante l'implementazione (Task 1 del piano) è emerso che
questo gap **non esiste**: `public.users` ha già un trigger
`trg_protect_users_row` (funzione `protect_users_row`, definita in
`supabase/migrations/20260830101700_final_review_hardening.sql`) che
protegge esattamente questi campi:

```sql
-- già esistente, nessuna modifica necessaria
if new.unique_user_id is distinct from old.unique_user_id then
  raise exception 'unique_user_id is immutable';
end if;
if auth.uid() is not null and new.phone is distinct from old.phone then
  raise exception 'phone cannot be changed directly; contact support to update your phone number';
end if;
if auth.uid() is not null and (
  new.matches_played_count is distinct from old.matches_played_count
  or new.matches_completed_count is distinct from old.matches_completed_count
  or new.matches_abandoned_count is distinct from old.matches_abandoned_count
) then
  raise exception 'match statistics are server-managed and cannot be changed directly';
end if;
```

Questo era un errore di analisi in fase di brainstorming: era stata
controllata solo la policy RLS (`users_update_self`, che davvero non
restringe le colonne), non i trigger sulla tabella. **Nessuna nuova
migrazione serve per questo punto.** La funzione client che traduce
l'errore in §4.1 deve tradurre i tre messaggi già esistenti sopra, non
un messaggio nuovo consolidato come nella bozza originale.

`first_name`, `last_name`, `birth_date`, `height_cm`, `preferred_foot`,
`player_role`, `profile_image_url` restano liberamente scrivibili (già
validati dai check constraint esistenti sulla tabella per altezza/piede/
ruolo) e non sono toccati da `protect_users_row`.

### 3.2 Bucket Storage per le foto profilo

```sql
-- supabase/migrations/20260907100100_create_profile_images_bucket.sql
insert into storage.buckets (id, name, public)
values ('profile-images', 'profile-images', true);

create policy "profile_images_public_read"
  on storage.objects for select
  using (bucket_id = 'profile-images');

create policy "profile_images_insert_own"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'profile-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "profile_images_update_own"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'profile-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "profile_images_delete_own"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'profile-images' and (storage.foldername(name))[1] = auth.uid()::text);
```

Ogni file va caricato con un path `<user_id>/<nome-file>` — la funzione
`storage.foldername(name)` restituisce il path spezzato in segmenti,
`[1]` è il primo segmento (l'id utente). Lettura pubblica per tutti
(`select` senza `to authenticated`), scrittura solo per il proprietario
del path. Bucket pubblico: gli URL restituiti da
`getPublicUrl()` sono diretti e permanenti, nessuna scadenza da gestire —
coerente con come `profile_image_url` è già usato ovunque nel codice
esistente (un URL diretto passato a `<Image source={{uri: ...}}>`, mai
un URL firmato).

## 4. Livello dati mobile

### 4.1 `mobile/src/api/users.ts`

Nuove funzioni:
- `updateOwnProfile(userId: string, fields: Partial<Pick<UserProfile,
  'first_name' | 'last_name' | 'birth_date' | 'height_cm' |
  'preferred_foot' | 'player_role' | 'profile_image_url'>>):
  Promise<UserProfile>` — `update` parziale, solo i campi passati.
  Traduce ciascuno dei tre messaggi già sollevati dal trigger
  preesistente `protect_users_row` (§3.1 — non un codice Postgres
  standard come `42501`/`23505`, un `RAISE EXCEPTION` senza `SQLSTATE`
  esplicito arriva come `P0001`, quindi il match è sul testo del
  messaggio): `'unique_user_id is immutable'`,
  `'phone cannot be changed directly; contact support to update your phone number'`,
  `'match statistics are server-managed and cannot be changed directly'`
  — ciascuno in un messaggio neutro italiano. Scenario che il client
  stesso non dovrebbe mai produrre dato che il form non espone quei
  campi — resta comunque una difesa contro un client compromesso/
  desincronizzato.
- `uploadProfileImage(userId: string, localUri: string): Promise<string>`
  — legge il file locale via `expo-file-system` (`readAsStringAsync` con
  `encoding: 'base64'`, poi decodificato a `ArrayBuffer` per l'upload —
  `fetch(uri).blob()` non è affidabile per URI di file locali su React
  Native, pattern noto nell'ecosistema Expo), carica su
  `supabase.storage.from('profile-images').upload(\`${userId}/${Date.now()}.jpg\`,
  ...)` con `{ contentType: 'image/jpeg', upsert: false }` (il timestamp
  nel nome file evita qualunque collisione/necessità di upsert, e
  garantisce che l'URL pubblico cambi ad ogni nuova foto, così eventuali
  cache lato client/CDN non servono mai l'immagine vecchia sotto lo
  stesso URL), poi `getPublicUrl(...)` per l'URL da salvare in
  `profile_image_url`.

### 4.2 Hook `useEditProfile()`

`mobile/src/hooks/useEditProfile.ts` — legge il profilo corrente da
`useSessionStore`, espone
`{ profile, loading, error, save }` dove
`save(fields: ProfileFormValues, newImageUri?: string): Promise<boolean>`:
se `newImageUri` è presente, chiama prima `uploadProfileImage` per
ottenere il nuovo URL, poi `updateOwnProfile` con tutti i campi del form
più (se presente) il nuovo `profile_image_url`; al successo aggiorna lo
store di sessione (`setProfile`) così ogni schermata che legge
`useSessionStore((s) => s.profile)` vede subito i dati aggiornati, senza
bisogno di un refetch esplicito.

## 5. Componente `ProfileForm` condiviso

`mobile/src/components/ProfileForm.tsx` — estratto dal corpo JSX
attualmente inline in `create-profile.tsx` (stessi campi: nome, cognome,
data di nascita, altezza, chip piede preferito, chip ruolo), con due
aggiunte:
- Le chip usano `FOOT_LABELS`/`ROLE_LABELS` da `profileDisplay.ts` per il
  testo mostrato (mantenendo il valore inglese come chiave interna) —
  fix del bug delle etichette non tradotte descritto in §2.
- Una prop opzionale `showImagePicker?: boolean` (default `false`): se
  vera, mostra l'avatar corrente (o un placeholder) sopra il resto del
  form; un tocco apre `expo-image-picker`'s
  `launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 })` e,
  se l'utente sceglie un'immagine, la mostra in anteprima al posto
  dell'avatar esistente e la espone al chiamante tramite `onImageSelected:
  (localUri: string) => void`.

Interfaccia:
```ts
export interface ProfileFormValues {
  firstName: string;
  lastName: string;
  birthDate: string;
  heightCm: string;
  preferredFoot: 'left' | 'right' | 'both';
  playerRole: 'player' | 'goalkeeper' | 'both';
}

interface ProfileFormProps {
  initialValues?: ProfileFormValues;
  currentImageUrl?: string | null;
  showImagePicker?: boolean;
  onImageSelected?: (localUri: string) => void;
  onSubmit: (values: ProfileFormValues) => void;
  submitLabel: string;
  loading?: boolean;
  error?: string | null;
}
```

`create-profile.tsx` viene aggiornato per usare `<ProfileForm
onSubmit={...} submitLabel="Crea profilo" loading={loading}
error={error} />` (senza `showImagePicker`, dato che non ha ancora senso
caricare una foto prima che il profilo esista) al posto del JSX inline
attuale — stessa logica di submit di oggi (`completeProfile`), solo il
markup si sposta nel componente condiviso.

## 6. Schermate

### 6.1 `mobile/app/(tabs)/profile/edit.tsx` (nuova)

Usa `useEditProfile()`. Tiene lo stato locale dell'URI dell'immagine
appena selezionata (se presente) separato dal profilo salvato, così
l'anteprima aggiorna subito la UI senza aspettare l'upload. Al tocco di
"Salva": chiama `save(formValues, selectedImageUri)`; al successo,
`router.back()` verso la schermata Profilo.

```tsx
<ProfileForm
  initialValues={{
    firstName: profile.first_name,
    lastName: profile.last_name,
    birthDate: profile.birth_date,
    heightCm: String(profile.height_cm),
    preferredFoot: profile.preferred_foot,
    playerRole: profile.player_role,
  }}
  currentImageUrl={profile.profile_image_url}
  showImagePicker
  onImageSelected={setSelectedImageUri}
  onSubmit={(values) => handleSave(values)}
  submitLabel="Salva modifiche"
  loading={saving}
  error={error}
/>
```

### 6.2 `mobile/app/(tabs)/profile/index.tsx`

Un pulsante "Modifica profilo" tra le statistiche e "Esci", che naviga a
`/(tabs)/profile/edit`.

### 6.3 `mobile/app/(tabs)/profile/_layout.tsx` (nuovo)

**Serve**, a differenza dell'ultimo caso analogo (`match/[id]/invite.tsx`
nel piano `match-invitations`, dove NON serviva): lì la nuova rotta era
annidata sotto una route dinamica (`match/[id]/`), qui invece
`index.tsx` ed `edit.tsx` sono entrambi file diretti dentro la cartella-
tab `(tabs)/profile/` — esattamente il pattern che in `persone` e
`messaggi` ha causato la promozione automatica della rotta figlia a tab
separata in fondo alla barra. Il nuovo file dichiara esplicitamente
entrambe le rotte sotto lo stesso `Stack`, mirror di
`people/_layout.tsx`/`messages/_layout.tsx`:

```tsx
// mobile/app/(tabs)/profile/_layout.tsx
import { Stack } from 'expo-router';

export default function ProfileLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="edit" />
    </Stack>
  );
}
```

## 7. Configurazione

`expo-image-picker` non è ancora una dipendenza — va installata con
`npx expo install expo-image-picker` (garantisce la versione compatibile
con questo SDK 57, non `npm install` diretto). Il plugin va aggiunto
all'array `plugins` di `app.json` con la stringa di permesso iOS
richiesta dall'App Store per l'accesso alla libreria foto:

```json
[
  "expo-image-picker",
  {
    "photosPermission": "Consente all'app di accedere alle tue foto per impostare l'immagine del profilo."
  }
]
```

## 8. Testing

Jest per `updateOwnProfile`/`uploadProfileImage` (client Supabase/Storage
mockato, stesso stile a catena già consolidato in questo progetto — il
mock di `supabase.storage.from(...).upload(...)`/`.getPublicUrl(...)`
segue lo stesso schema a metodi concatenati già usato per `.from(...).select(...)`),
per `useEditProfile`. Nessun nuovo test pgTAP per la protezione dei
campi — il trigger preesistente `protect_users_row` (§3.1) è già
coperto dai test esistenti (`001_users.test.sql`,
`017_final_review_hardening.test.sql`); questa spec non aggiunge alcun
comportamento backend nuovo su quel fronte, solo la traduzione lato
client dei suoi messaggi già esistenti. Nessun test pgTAP
dedicato per le policy dello storage bucket — questo progetto non ha
finora scritto test pgTAP per `storage.objects` (nessun bucket esisteva
prima), e improvvisare un framework di test per lo storage sarebbe
sproporzionato per un singolo bucket con quattro policy semplici e
speculari; la copertura per questa parte è il walkthrough manuale finale.
Nessun test automatico a livello di schermata. Walkthrough manuale finale
nel simulatore: modifica nome/altezza/piede/ruolo e verifica che si
riflettano subito sulla schermata Profilo; carica una foto e verifica che
compaia sulla schermata Profilo, sulla propria riga in un roster partite,
e sul proprio profilo visto da un altro utente in Persone (tre punti
diversi del codice che già leggono `profile_image_url`, nessuno dei quali
questa spec modifica direttamente — verifica che l'aggiornamento si
propaghi senza bisogno di toccarli).

## 9. Rischi / decisioni aperte

- Nessuna compressione/resize immagine lato client — se in futuro le foto
  risultassero troppo pesanti (tempi di upload, banda), andrebbe aggiunta
  un'opzione di resize in `launchImageLibraryAsync` o una libreria
  dedicata; non necessario ora.
- L'URL pubblico della nuova foto è diverso da quello vecchio (grazie al
  timestamp nel nome file), quindi nessuna schermata già aperta con la
  vecchia immagine "vede" un cambiamento a sorpresa mentre l'utente sta
  ancora modificando il proprio profilo — ma le foto vecchie caricate
  restano nel bucket indefinitamente (nessun cleanup delle foto
  sostituite). Accettabile al volume d'uso di questo progetto; un
  meccanismo di pulizia (es. una funzione che cancella la foto precedente
  dopo un upload riuscito) è un miglioramento rimandabile, non richiesto
  ora.
- Il trigger preesistente `protect_users_row` (§3.1) già gestisce
  correttamente il caso di un futuro pannello di amministrazione: è
  gated su `auth.uid() is not null`, quindi un update da un contesto
  service-role/non autenticato (come già fa
  `transition_match_statuses()` per i contatori a fine partita) non
  viene bloccato. Nessuna azione richiesta da questa spec su questo
  fronte.
