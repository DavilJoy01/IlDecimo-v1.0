#!/usr/bin/env bash
# Runs every flow in e2e/flows/, one at a time, resetting the booted
# simulator's Keychain before each one.
#
# The reset must happen BEFORE EVERY FLOW, not just once before the whole
# batch: `maestro test e2e/flows` (the whole directory in one invocation)
# runs all flows against the same simulator session, and this Simulator's
# Keychain-backed sessions survive `launchApp: clearState: true` (a known,
# already-documented quirk of this project's dev environment) -- so
# login-happy-path leaves a session behind that silently changes the
# starting screen for whichever flow the batch runs next (confirmed: a
# single upfront reset was NOT enough, app-launches still failed when run
# after login-happy-path in the same batch). Running one flow per
# invocation, each with its own fresh Keychain, is what actually isolates
# them.
set -euo pipefail

DEVICE="${MAESTRO_DEVICE:-}"
if [ -z "$DEVICE" ]; then
  DEVICE=$(xcrun simctl list devices booted -j | node -e "
    let d='';process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>{
      const j=JSON.parse(d);
      for (const runtime of Object.values(j.devices)) {
        for (const dev of runtime) { if (dev.state === 'Booted') { console.log(dev.udid); process.exit(0); } }
      }
      process.exit(1);
    })
  ")
fi

if [ -z "$DEVICE" ]; then
  echo "No booted simulator found. Boot one (or set MAESTRO_DEVICE=<udid>) and retry."
  exit 1
fi

FLOWS_DIR="$(dirname "$0")/../flows"
FAILED=0

# Seeded once, up front, and passed to every flow invocation via -e: cheap
# and idempotent even for flows that don't reference ${TARGET_CODE}.
TARGET_CODE=$("$(dirname "$0")/seed-target-user.sh")

# Seeds the fixed creator account + fixed open match for
# match-participation-lifecycle.yaml, and resets that match's participation
# state -- cheap and idempotent even for flows that don't need it.
"$(dirname "$0")/seed-participation-match.sh"

for flow in "$FLOWS_DIR"/*.yaml; do
  name=$(basename "$flow")
  echo "--- Resetting Keychain on $DEVICE before $name ---"
  xcrun simctl keychain "$DEVICE" reset
  if ! maestro --device "$DEVICE" test -e TARGET_CODE="$TARGET_CODE" "$flow"; then
    FAILED=1
  fi
done

exit $FAILED
