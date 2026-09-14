# E2E tests (Maestro)

Real end-to-end flows driven against a running app instance (iOS Simulator
or a device) via [Maestro](https://maestro.mobile.dev) — no mocks, the real
UI, the real local Supabase backend.

Chosen over Detox: Maestro drives the already-built app through the
accessibility tree and needs no native build/config changes, which matters
on this project given its history of native-build fragility under
iCloud-synced `~/Desktop` (see the `project_ios_simulator_devclient_freeze`
project memory). Detox's deeper native hooks would add another surface for
that same class of problem.

## One-time setup

Maestro needs Java 17+ (the CLI itself, not the app):

```bash
brew install openjdk@17
curl -Ls "https://get.maestro.mobile.dev" | bash
```

Then, for every shell session that runs `maestro`:

```bash
export JAVA_HOME="/opt/homebrew/opt/openjdk@17"
export PATH="$JAVA_HOME/bin:$PATH:$HOME/.maestro/bin"
```

(Add these two lines to your shell profile to stop repeating them.)

## Running the flows

1. Local Supabase running (`npx supabase start` from `supabase/`, or
   confirm with `docker ps`).
2. Metro running for this checkout (`npm run start` from `mobile/`) with
   the dev client already installed and pointed at it on your simulator —
   the app must already be reachable exactly as it would be for manual
   testing.
3. Seed the fixed E2E test account once (idempotent — safe to re-run):
   ```bash
   npm run e2e:seed
   ```
4. Run every flow:
   ```bash
   npm run e2e
   ```
   `e2e/scripts/run.sh` runs each flow file as its own `maestro test`
   invocation, resetting the booted simulator's Keychain immediately
   before every single one — not just once before the whole batch. Both
   parts are required, not just tidy: this Simulator's Keychain-backed
   sessions survive `launchApp: clearState: true` (a known,
   already-documented quirk of this project's dev environment), so a flow
   that logs in (`login-happy-path`) leaves a session behind — confirmed
   experimentally that a single upfront reset before running the whole
   `e2e/flows` directory in one `maestro test` call was NOT enough:
   `app-launches` still failed afterward, because the reset only ran once
   for the whole batch, not between the two flows sharing that one
   simulator session. Set `MAESTRO_DEVICE=<udid>` to target a specific
   simulator instead of whichever one is currently booted.

   To run a single flow directly (skips the Keychain reset — fine if you
   already ran `npm run e2e` once this session, or if the flow doesn't
   touch login):
   ```bash
   maestro --device <udid> test e2e/flows/login-happy-path.yaml
   ```

## What's covered so far

- `flows/app-launches.yaml` — the app launches and reaches the login
  screen. No backend dependency, no test data. The floor every other flow
  builds on: if this fails, nothing else will pass either.
- `flows/login-happy-path.yaml` — the fixed E2E account logs in and reaches
  the tab bar. Requires `npm run e2e:seed` to have run against local
  Supabase first.
- `flows/search-and-block-user.yaml` — logs in, searches for a second fixed
  account by its `unique_user_id` code (`npm run e2e:seed-target`), views
  its profile, and blocks it. Covers two of the MVP spec's listed critical
  E2E flows in one pass: "ricerca per ID" and "blocco utente".
  `e2e/scripts/seed-target-user.sh` also clears any pre-existing block
  between the two fixed accounts on every run, so the flow is safe to
  re-run without manual cleanup, and prints the target's code to stdout
  for `run.sh` (or you) to pass in via `-e TARGET_CODE=...`.

All three were run via `npm run e2e` and confirmed passing, twice in a row
back to back, against `iPhone17-fresh` (`D727DB43-C7DD-4B2B-B847-F97A1521C0D9`).
Getting there surfaced several real gotchas, each now handled by the
flows/scripts themselves rather than left as traps for the next flow
author:

- The password field's `tapOn` + `inputText` silently no-op'd when matched
  by placeholder text (the field stayed empty even though both steps
  reported `COMPLETED`) — fixed by giving the login screen's two inputs and
  submit button explicit `testID`s (`login-phone-input`,
  `login-password-input`, `login-submit-button`) and selecting by `id:` in
  the flow instead of by visible text.
- **Two independent system dialogs can appear right after login, in either
  order, and dismissing one can reveal the other underneath it**: iOS's own
  "Vuoi salvare la password?" prompt, and the notification-permission
  prompt `useRegisterPushToken` fires (added by the `notifiche-push` plan,
  after these flows were first written — running the full suite again
  after that plan is what surfaced this). Every flow that logs in tries
  both dismiss taps (`"Non ora"`, `"Non consentire"`) **twice each**, all
  `optional: true`, to cover every ordering without failing when a dialog
  doesn't appear at all.
- React Navigation's bottom tab bar gives each tab a composite
  accessibility label (`"Home, tab, 1 of 5"`, not just `"Home"`), and
  Maestro's text assertions match the whole label — every tab-bar assertion
  uses a `.*Home.*`-style regex, not a bare string.
- **The same composite-label issue applies to any `Pressable` wrapping
  multiple `Text` children**, not just the tab bar — the search result
  card's name/code/"Vedi profilo →" merge into one accessibility label the
  same way, so `search-and-block-user.yaml` regex-wraps assertions against
  it instead of matching any one piece of text exactly.
- **A native `Alert.alert` button can share its exact visible text with an
  already-on-screen element behind it** (the profile screen's own "Blocca"
  link stays in the accessibility tree, merely covered, while the alert's
  destructive "Blocca" button is open) — plain text matching is ambiguous
  between the two. Maestro's `index:` selector field disambiguates
  (`{ text: "Blocca", index: 0 }` picked the alert's own button here,
  confirmed empirically, not assumed from hierarchy order — don't assume
  the same index number generalizes to a different ambiguous pair without
  re-checking).
- **A tab tap thrown right as a dialog's dismiss animation is still
  settling can silently land on nothing** — Maestro reports `tapOn`
  `COMPLETED`, but the app stays on the previous screen. A
  `waitForAnimationToEnd` step before the tap fixed it.

## Adding a new flow

- One YAML file per user-facing scenario, named for what it proves
  (`create-match-happy-path.yaml`, not `test3.yaml`).
- Start every flow with `launchApp: { clearState: true }` — flows must not
  depend on state left behind by a previous flow or a previous manual
  session.
- Prefer asserting on real, already-localized UI strings (as the app
  actually shows them, in Italian) over test IDs that don't exist yet in
  this codebase — matches how these first two flows are written. Add a
  `testID` to a component only when the visible text is genuinely
  ambiguous or absent (an icon-only button, for instance).
- A flow that needs backend state beyond the fixed E2E account (an
  existing match to join, a friend request to accept) should seed that
  state via a script under `e2e/scripts/`, following the same pattern as
  `seed-test-user.sh` — direct SQL/admin-API calls against local Supabase,
  idempotent, never touching a real project.
- This project's local Supabase demo `service_role` key
  (`eyJhbGci...I0`, used in `seed-test-user.sh`) is Supabase CLI's fixed,
  publicly documented local-dev key — identical across every local
  Supabase project, safe to commit, and powerless against a real project.
  Never substitute a real project's service role key here.
