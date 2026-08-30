# App Calcio — Design MVP

Data: 2026-08-30
Stato: approvato in chat, in attesa di revisione finale sul documento scritto

## 1. Contesto e obiettivo

App mobile (iOS + Android) per creare, cercare e partecipare a partite di calcio a 5/7/8 giocatori,
trovando altre persone disponibili nella propria zona. Il problema che risolve:
"Voglio giocare a calcio ma mi mancano alcuni giocatori."

Questo documento copre **solo l'MVP**. Le funzionalità avanzate (formazioni drag&drop, pannello
admin completo, lista d'attesa, statistiche avanzate) sono rimandate a una Spec 2 successiva —
vedi sezione 11 "Fuori scope (Spec 2)".

Contesto del progetto: founder solo, non tecnico, nessun account developer o servizio già
configurato. Questo ha guidato la scelta di uno stack fortemente managed.

## 2. Stack tecnologico

- **Frontend**: React Native + Expo (managed workflow), Expo Router per la navigazione,
  Expo Notifications per le push, `expo-location` per il GPS, `expo-secure-store` per la sessione.
- **Backend**: Supabase — Postgres reale (non NoSQL) + PostGIS per la geolocalizzazione,
  Auth con OTP via SMS, Realtime (basato su replica logica Postgres) per le chat,
  Storage per le foto profilo, `pg_cron` per le transizioni automatiche di stato partita,
  `pg_net` per l'invio delle push direttamente da trigger di database (vedi nota sotto).
- **Maps**: Google Maps Platform (Places Autocomplete per l'indirizzo del campo, Maps SDK
  per la visualizzazione, `react-native-maps` lato client).
- **Build & pubblicazione**: EAS Build / EAS Submit per generare e pubblicare le build
  iOS/Android senza richiedere Xcode/Android Studio locali.

### Perché questo stack e non le alternative

- **Flutter + Firebase** scartato: Firestore (NoSQL) rende scomodo lo schema relazionale
  con join multipli (partecipazioni, stati, storico, amicizie) richiesto da questo dominio;
  ecosistema di sviluppatori più piccolo di React Native.
- **React Native bare + backend custom (Node/NestJS)** scartato: massimo controllo ma
  richiede gestire hosting, scaling e sicurezza server senza un team — rischio troppo alto
  per un founder solo non tecnico.
- Il mix Expo + Supabase minimizza la superficie di infrastruttura da mantenere, mantenendo
  comunque un vero database relazionale e margine per scalare in futuro.

## 3. Architettura generale

```
App Mobile (RN/Expo) --HTTPS/WebSocket--> Supabase
                                            ├─ Auth (OTP)
                                            ├─ Postgres + PostGIS + RLS
                                            ├─ Realtime (chat)
                                            ├─ Storage (foto)
                                            └─ Edge Functions (logica critica)
                                                  │
                                                  ▼
                                    Expo Push Notification Service
```

**Principio di sicurezza cardine**: ogni regola di business critica (approvazione partecipanti,
limite di 2 uscite per partita, permessi di modifica/cancellazione partita, accesso alle chat)
è imposta a livello di database tramite Row Level Security e/o Edge Functions — mai solo lato
client. L'app React Native non è mai la fonte di verità delle autorizzazioni.

## 4. Schema database (MVP)

### `users`
`id` (uuid, = auth.users.id), `unique_user_id` (text, es. `FC-482719`, generato da trigger,
immutabile), `phone` (univoco), `first_name`, `last_name`, `birth_date`, `height_cm`,
`preferred_foot` (`left`/`right`/`both`), `player_role` (`player`/`goalkeeper`/`both`),
`profile_image_url`, `matches_played_count`, `matches_completed_count`,
`matches_abandoned_count`, `created_at`, `updated_at`.
Password e sessione gestite da Supabase Auth, non replicate qui.

### `matches`
`id`, `creator_id` (fk users), `match_type` (`5`/`7`/`8`), `field_name`, `address`,
`location` (`geography(Point,4326)`, generata da lat/lng), `match_date`, `start_time`,
`end_time`, `max_players`, `description`, `status`
(`draft`/`open`/`full`/`started`/`completed`/`cancelled`), `created_at`, `updated_at`.

### `match_participants`
`id`, `match_id`, `user_id`, `status`
(`requested`/`approved`/`rejected`/`active`/`left`/`completed`), `join_count`, `leave_count`,
`requested_at`, `approved_at`, `left_at`.
Vincolo unico su (`match_id`, `user_id`).

### `match_participant_events`
Log append-only di ogni cambio di stato: `id`, `match_participant_id`, `from_status`,
`to_status`, `changed_at`. Alimenta lo storico persistente del profilo.

### `friendships`
`id`, `requester_id`, `receiver_id`, `status` (`pending`/`accepted`/`rejected`), `created_at`.
Vincolo unico sulla coppia (indipendentemente dall'ordine).

### `match_invitations`
`id`, `match_id`, `inviter_id`, `invitee_id`, `status` (`sent`/`viewed`/`ignored`),
`created_at`. L'invito notifica soltanto: non garantisce l'accesso, resta soggetto
all'approvazione del creatore.

### `match_messages`
`id`, `match_id`, `sender_id`, `body`, `created_at`.

### `private_conversations`
`id`, `user_a_id`, `user_b_id`, `created_at`. Vincolo unico sulla coppia.

### `private_messages`
`id`, `conversation_id`, `sender_id`, `body`, `read_at`, `created_at`.

### `notifications`
`id`, `user_id`, `type` (enum), `payload` (jsonb), `read_at`, `created_at`.

### `user_push_tokens`
`id`, `user_id`, `push_token`, `created_at`.

### `reports`
`id`, `reporter_id`, `reported_user_id` (nullable), `reported_match_id` (nullable),
`reason`, `status` (`open`/`reviewed`/`dismissed`), `created_at`.
Per l'MVP la revisione è manuale via Supabase Studio; una UI admin dedicata è in Spec 2.

### `user_blocks`
`id`, `blocker_id`, `blocked_id`, `created_at`. Un utente bloccato non compare più nelle
ricerche dell'utente che ha bloccato e non può inviargli messaggi (enforced via RLS).

### Nota privacy (posizione utente)
La posizione dell'utente **non viene mai salvata** nel database. Il client invia lat/lng
correnti solo come parametro della query "cerca partite vicine" (RPC/Edge Function), che
calcola le distanze al volo. Solo `matches.location` (posizione del campo, non della persona)
è persistita, ed è per sua natura un dato pubblico (indirizzo del campo).

## 5. Regole critiche ed enforcement lato backend

| Regola | Dove vive | Come funziona |
|---|---|---|
| Solo il creatore approva richieste | RLS su `match_participants` | `UPDATE` di `status` da `requested` consentito solo se `auth.uid() = matches.creator_id` |
| Nessun ingresso automatico | RLS su `match_participants` | `INSERT` da utente crea sempre `status='requested'`; nessuna policy permette insert diretto con `approved` |
| Max 2 uscite per coppia utente↔match | Trigger `BEFORE UPDATE` su `match_participants` | Prima di un nuovo `requested` (rientro dopo un `left`), verifica `leave_count >= 2` e rifiuta esplicitamente — nessuna Edge Function intermedia: l'enforcement vale per qualunque client, non solo per chi passa da una funzione specifica |
| Modifica/cancellazione partita | RLS su `matches` | `UPDATE`/`DELETE` solo se `auth.uid() = creator_id` |
| Accesso chat di stanza solo autorizzati | RLS su `match_messages` | richiede riga in `match_participants` con status approvato per quel match/utente |
| Accesso chat privata | RLS su `private_messages` | permesso solo per `user_a_id`/`user_b_id` della conversazione, e solo se non c'è un `user_blocks` reciproco |
| Password mai in chiaro | Supabase Auth | hashing gestito internamente (bcrypt) |
| ID univoco immutabile | Trigger `BEFORE INSERT` su `users` + policy `UPDATE` che esclude la colonna | genera `FC-XXXXXX` una sola volta |
| Transizioni automatiche stato partita | `pg_cron` + funzione `plpgsql` | job periodico (ogni minuto) che aggiorna `status` in base a `start_time`/`end_time`, propaga i contatori sugli utenti e genera i promemoria "partita imminente" |

## 6. Struttura frontend

```
app/
  (auth)/login.tsx, register-phone.tsx, verify-otp.tsx, create-password.tsx, create-profile.tsx
  (tabs)/
    home/index.tsx, filters.tsx, match/[id].tsx, create-match.tsx
    my-matches/index.tsx
    people/index.tsx, friend-requests.tsx, user/[id].tsx
    messages/index.tsx, chat/[conversationId].tsx
    profile/index.tsx, edit.tsx, settings/(index, account, notifications, privacy, security).tsx
  match-room/[matchId]/index.tsx, requests.tsx, chat.tsx
src/
  api/        client Supabase tipizzato, una funzione per query/RPC
  hooks/      useAuth, useMatches, useFriends, ecc.
  components/ componenti UI riutilizzabili (Card, Avatar, Badge...)
  stores/     stato globale leggero (sessione/utente)
  types/      tipi TS generati da Supabase + tipi di dominio
```

Ogni feature isolata sotto `(tabs)/` comunica solo tramite gli hook in `src/hooks`, mai
direttamente con Supabase nel componente, per mantenere la logica testabile indipendentemente
dall'UI.

Bottom navigation: Home / Le mie partite / Persone / Messaggi / Profilo (sezione 19 del
prompt originale — struttura già ottimale per questo caso d'uso).

## 7. Sistemi trasversali

**Autenticazione**: Supabase Auth con OTP via SMS (provider Twilio o simile, costo per SMS
da configurare — richiede che l'utente crei un account presso il provider SMS scelto).
Flusso: numero → OTP → verifica → password → sessione JWT salvata in `expo-secure-store`.
Subito dopo, il client inserisce direttamente la riga in `users` (con RLS che verifica
`auth.uid() = id`); il trigger `generate_unique_user_id` genera l'`unique_user_id` a livello
di database — non serve una Edge Function intermedia.

**Notifiche push**: `push_token` registrato in `user_push_tokens` al login. Un trigger
`AFTER INSERT` su `notifications` chiama `net.http_post` (estensione `pg_net`) verso l'Expo
Push API direttamente dal database — più semplice di una Edge Function dedicata e con lo
stesso risultato, dato che si tratta di un'unica chiamata HTTP fire-and-forget.

**Chat realtime**: Supabase Realtime sui canali di `match_messages`/`private_messages`,
nessun server WebSocket separato da gestire.

**GPS**: `expo-location` chiede il permesso alla prima apertura di "Cerca partite" con
schermata esplicativa. Se negato, l'app resta funzionante ma senza ricerca geolocalizzata
(banner esplicativo al suo posto).

## 8. Rischio di compliance App Store (UGC)

Apple Guideline 1.2 richiede, per app con contenuti generati dagli utenti e messaggistica,
un meccanismo minimo di segnalazione e blocco degli utenti, pena il rigetto in review.
Per l'MVP questo è coperto da un'azione "Segnala"/"Blocca" sul profilo utente (tabelle
`reports` e `user_blocks` sopra), con revisione manuale via Supabase Studio — non richiede
una UI admin dedicata, che resta in Spec 2.

## 9. Schermate MVP

**Onboarding/Auth**: Splash, Onboarding, Login, Registrazione, Verifica OTP, Creazione
password, Creazione profilo.
**Home/Partite**: Home, Ricerca partite, Filtri, Dettaglio partita, Creazione partita,
Stanza partita, Richieste partecipazione, Le mie partite.
**Persone**: Profilo utente, Modifica profilo, Cerca persona tramite ID, Lista amici,
Richieste amicizia.
**Comunicazione**: Chat privata, Chat partita, Notifiche.
**Account**: Impostazioni, Privacy, Sicurezza (incl. logout ed elimina account per GDPR).
**Moderazione minima**: azione Segnala/Blocca integrata nel profilo utente (non una
schermata admin separata).

## 10. Strategia di test

- **Unit test (Jest)** su `src/hooks`/`src/api`: calcolo distanza, transizioni di stato,
  mapping dati Supabase → tipi di dominio.
- **Test delle regole di business a livello database** (pgTAP o script SQL via Supabase
  CLI locale) per ogni RLS/trigger critico, per verificare che l'operazione vietata fallisca
  davvero e non sia solo nascosta dall'UI.
- **Test E2E (Detox o Maestro)** sui flussi critici: registrazione→OTP→profilo, creazione
  partita→richiesta→approvazione→stanza, chat realtime, ricerca per ID, blocco utente.
- **Test manuali su dispositivo reale** per i permessi di sistema (GPS, notifiche), che sono
  difficili da automatizzare pienamente su iOS/Android.

## 11. Fuori scope (Spec 2)

- Formazioni Casa/Ospiti con drag & drop visuale.
- Pannello admin completo (gestione utenti, statistiche, revisione segnalazioni via UI).
- Lista d'attesa quando la partita è piena.
- Statistiche avanzate dei giocatori, sistema di reputazione, monetizzazione.

Queste funzionalità sono già previste nello schema/architettura in modo da poter essere
aggiunte senza refactoring maggiori (es. la tabella `reports` esiste già, manca solo la UI
di revisione; il campo `matches.max_players` è già generico rispetto a Casa/Ospiti/riserve).
