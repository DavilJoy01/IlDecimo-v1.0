#!/usr/bin/env bash
# Seeds (or reuses) a single fixed test account against the LOCAL Supabase
# stack for E2E flows to log in with. Idempotent: safe to run before every
# E2E run. Never touches anything but http://127.0.0.1:54321 -- the service
# role key below is Supabase CLI's fixed, publicly documented local-dev demo
# key, identical across every local Supabase project; it has no power
# against a real project and is not a secret.
set -euo pipefail

SUPABASE_URL="http://127.0.0.1:54321"
SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"

E2E_PHONE="+390000000900"
E2E_PASSWORD="MaestroTest123!"

EXISTING_ID=$(docker exec -i supabase_db_backend-foundation psql -U postgres -d postgres -tA -c \
  "select id from auth.users where phone = '${E2E_PHONE#+}';" 2>/dev/null | tr -d '[:space:]')

if [ -n "$EXISTING_ID" ]; then
  echo "E2E test user already exists ($EXISTING_ID) -- reusing it."
  exit 0
fi

echo "Creating E2E test user..."
RESPONSE=$(curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"$E2E_PHONE\",\"password\":\"$E2E_PASSWORD\",\"phone_confirm\":true}")

USER_ID=$(echo "$RESPONSE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id))")

if [ -z "$USER_ID" ] || [ "$USER_ID" = "undefined" ]; then
  echo "Failed to create auth user. Response was:"
  echo "$RESPONSE"
  exit 1
fi

docker exec -i supabase_db_backend-foundation psql -U postgres -d postgres -c "
insert into public.users (id, phone, first_name, last_name, birth_date, height_cm, preferred_foot, player_role)
values ('$USER_ID', '$E2E_PHONE', 'Maestro', 'E2E', '1995-01-01', 180, 'right', 'player');
"

echo "E2E test user created: $USER_ID"
