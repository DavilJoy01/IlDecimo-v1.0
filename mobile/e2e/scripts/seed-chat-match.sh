#!/usr/bin/env bash
# Seeds (or reuses) the same fixed "creator" account as
# seed-participation-match.sh (+390000000997, "Creatore E2E") plus a
# SEPARATE fixed open match, dedicated to the chat E2E flow so the two
# flows' seed-reset logic never fights over the same match_id. Unlike
# seed-participation-match.sh, this script seeds the fixed E2E account
# (+390000000900, "Maestro E2E") straight to an APPROVED participant --
# bypassing the request/approve UI dance entirely, since that state
# machine is already covered end-to-end by match-participation-lifecycle.
# This flow exists to test chat access and message persistence, not
# participation approval, so starting pre-approved keeps it focused.
#
# The state machine trigger (enforce_participant_state_machine) requires
# every INSERT to have status='requested' and auth.uid() = user_id, and
# every 'requested'->'approved' transition to run as the match's creator
# -- both enforced via auth.uid(), which only resolves from a JWT. Since
# this script writes as the postgres superuser (no JWT), each write below
# temporarily impersonates the right user via `set local role
# authenticated` + `set local request.jwt.claims`, exactly like a real
# authenticated request would present itself, rather than bypassing the
# trigger.
#
# Also clears any leftover match_messages for this match on every run, so
# the flow's message-count/text assertions always start from an empty
# chat. Idempotent: safe to run before every E2E run. Never touches
# anything but http://127.0.0.1:54321 -- see seed-test-user.sh for why the
# service role key below is safe to commit.
set -euo pipefail

SUPABASE_URL="http://127.0.0.1:54321"
SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"

E2E_CREATOR_PHONE="+390000000997"
E2E_CREATOR_PASSWORD="MaestroCreator123!"
E2E_PHONE="+390000000900"
MATCH_ID="77777777-7777-7777-7777-777777777777"

EXISTING_CREATOR_ID=$(docker exec -i supabase_db_backend-foundation psql -U postgres -d postgres -tA -c \
  "select id from auth.users where phone = '${E2E_CREATOR_PHONE#+}';" 2>/dev/null | tr -d '[:space:]')

if [ -z "$EXISTING_CREATOR_ID" ]; then
  RESPONSE=$(curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users" \
    -H "apikey: $SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"phone\":\"$E2E_CREATOR_PHONE\",\"password\":\"$E2E_CREATOR_PASSWORD\",\"phone_confirm\":true}")

  CREATOR_ID=$(echo "$RESPONSE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id))")

  if [ -z "$CREATOR_ID" ] || [ "$CREATOR_ID" = "undefined" ]; then
    echo "Failed to create creator auth user. Response was: $RESPONSE" >&2
    exit 1
  fi

  docker exec -i supabase_db_backend-foundation psql -U postgres -d postgres -c "
  insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
  values ('$CREATOR_ID', '$E2E_CREATOR_PHONE', 'Creatore', 'E2E', '1988-03-20', 178, 'right', 'player');
  " >/dev/null
else
  CREATOR_ID="$EXISTING_CREATOR_ID"
fi

E2E_ID=$(docker exec -i supabase_db_backend-foundation psql -U postgres -d postgres -tA -c \
  "select id from auth.users where phone = '${E2E_PHONE#+}';" 2>/dev/null | tr -d '[:space:]')

if [ -z "$E2E_ID" ]; then
  echo "Fixed E2E account (+390000000900) not found -- run 'npm run e2e:seed' first." >&2
  exit 1
fi

# Upsert the fixed match: created fresh the first time, and reset back to a
# clean 'open' state (with tomorrow's date, so it never drifts into the past
# across sessions) on every subsequent run.
docker exec -i supabase_db_backend-foundation psql -U postgres -d postgres -c "
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players, status)
values ('$MATCH_ID', '$CREATOR_ID', 5, 'Campo Chat E2E', 'Via Test Chat 1, Palermo', 38.1157, 13.3615, (current_date + interval '1 day')::date, '20:00', '21:30', 10, 'open')
on conflict (id) do update set
  status = 'open',
  match_date = (current_date + interval '1 day')::date;
" >/dev/null

# Clear any messages left over from a previous run of this flow.
docker exec -i supabase_db_backend-foundation psql -U postgres -d postgres -c "
delete from public.match_messages where match_id = '$MATCH_ID';
" >/dev/null

# Seed the fixed E2E account straight to an approved participant. A plain
# UPDATE from 'requested'/'left' would need a prior INSERT anyway, so this
# always starts from a clean delete + insert-as-requester + approve-as-
# creator, each step impersonating the right user via request.jwt.claims.
docker exec -i supabase_db_backend-foundation psql -U postgres -d postgres <<SQL
begin;
delete from public.match_participants where match_id = '$MATCH_ID' and user_id = '$E2E_ID';

set local role authenticated;
set local request.jwt.claims = '{"sub":"$E2E_ID","role":"authenticated"}';
insert into public.match_participants (match_id, user_id, status)
values ('$MATCH_ID', '$E2E_ID', 'requested');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"$CREATOR_ID","role":"authenticated"}';
update public.match_participants set status = 'approved'
where match_id = '$MATCH_ID' and user_id = '$E2E_ID';
reset role;
commit;
SQL
