#!/usr/bin/env bash
# Seeds (or reuses) a THIRD fixed test account -- a match creator, distinct
# from the fixed E2E account (the requester in this flow) and the
# search-and-block-user target -- plus one fixed open match they created,
# near Palermo (same coordinates already used elsewhere in this project's
# tests). Idempotent: safe to run before every E2E run. Never touches
# anything but http://127.0.0.1:54321 -- see seed-test-user.sh for why the
# service role key below is safe to commit.
#
# Also deletes any existing match_participants row between the fixed E2E
# account and this match on every run, so the request-approve-chat flow
# always starts from a clean "never requested" state -- without this, a
# second run would find the participant already approved (or rejected) and
# the flow's assertions on the "Richiedi di partecipare" button and the
# "Richieste in attesa" section would fail.
set -euo pipefail

SUPABASE_URL="http://127.0.0.1:54321"
SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"

E2E_CREATOR_PHONE="+390000000997"
E2E_CREATOR_PASSWORD="MaestroCreator123!"
MATCH_ID="55555555-5555-5555-5555-555555555555"

EXISTING_ID=$(docker exec -i supabase_db_backend-foundation psql -U postgres -d postgres -tA -c \
  "select id from auth.users where phone = '${E2E_CREATOR_PHONE#+}';" 2>/dev/null | tr -d '[:space:]')

if [ -z "$EXISTING_ID" ]; then
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
  CREATOR_ID="$EXISTING_ID"
fi

# Upsert the fixed match: created fresh the first time, and reset back to a
# clean 'open' state (with tomorrow's date, so it never drifts into the past
# across sessions) on every subsequent run.
docker exec -i supabase_db_backend-foundation psql -U postgres -d postgres -c "
insert into public.matches (id, creator_id, match_type, field_name, address, latitude, longitude, match_date, start_time, end_time, max_players, status)
values ('$MATCH_ID', '$CREATOR_ID', 5, 'Campo Partecipazione E2E', 'Via Test Partecipazione 1, Palermo', 38.1157, 13.3615, (current_date + interval '1 day')::date, '20:00', '21:30', 10, 'open')
on conflict (id) do update set
  status = 'open',
  match_date = (current_date + interval '1 day')::date;
" >/dev/null

# Clean slate: remove any leftover participation from the fixed E2E account
# (the requester in this flow) so the flow always starts from 'never
# requested'.
E2E_PHONE="+390000000900"
E2E_ID=$(docker exec -i supabase_db_backend-foundation psql -U postgres -d postgres -tA -c \
  "select id from auth.users where phone = '${E2E_PHONE#+}';" 2>/dev/null | tr -d '[:space:]')

if [ -n "$E2E_ID" ]; then
  docker exec -i supabase_db_backend-foundation psql -U postgres -d postgres -c "
  delete from public.match_participants where match_id = '$MATCH_ID' and user_id = '$E2E_ID';
  " >/dev/null
fi
