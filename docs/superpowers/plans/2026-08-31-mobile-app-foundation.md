# Mobile App Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the React Native/Expo mobile app shell that proves the whole stack end to end: a real user can register (phone → OTP → password → profile), land on a tab-based Home screen, and see real nearby matches fetched from the already-implemented Supabase backend.

**Architecture:** Expo Router (file-based navigation) with two top-level route groups — `(auth)` for the unauthenticated flow and `(tabs)` for the signed-in app — gated by a root layout that reads session state from a Zustand store populated by a Supabase auth-state listener. All Supabase access goes through typed wrapper functions in `src/api/`; screens never call `supabase.*` directly. Business/data logic lives in `src/hooks/`; screens stay presentational.

**Tech Stack:** Expo (managed workflow, latest stable SDK via `create-expo-app`), Expo Router, TypeScript (strict), `@supabase/supabase-js`, `expo-secure-store` (session persistence), `expo-location` (GPS), Zustand (session store), Jest + `jest-expo` + `@testing-library/react-native` (unit/hook tests).

**Spec:** [docs/superpowers/specs/2026-08-30-app-calcio-mvp-design.md](../specs/2026-08-30-app-calcio-mvp-design.md)
**Backend this app consumes:** [docs/superpowers/plans/2026-08-30-backend-foundation.md](2026-08-30-backend-foundation.md) — already implemented and merged to `main` (`supabase/` at repo root).

## Global Constraints

- The mobile app lives in `mobile/` at the repo root, alongside the existing `supabase/` and `docs/` directories — a separate project sharing the same git repo.
- TypeScript strict mode; no `any` in new code without a comment explaining why it's unavoidable.
- Every Supabase call lives in `mobile/src/api/*.ts`; components and hooks never import `supabase` directly except through those wrappers (the one exception: `mobile/src/api/supabase.ts` itself, which constructs the client).
- Screens are presentational; state and Supabase calls live in `mobile/src/hooks/*.ts`. A screen file should read like a description of the UI, not contain fetch logic.
- Session tokens are stored via `expo-secure-store`, never `AsyncStorage` or plain JS memory that survives app restarts — this matches the spec's requirement that auth tokens are handled securely.
- Environment values (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`) are read via `EXPO_PUBLIC_*` env vars (Expo inlines these at build time) from a gitignored `mobile/.env.local` — never hardcoded, never the service-role key (which never belongs on a client at all).
- Every screen handles loading and error states explicitly — no bare `data!` assumptions, no silently swallowed errors.
- Bottom tab labels/order match spec section 19 exactly: Home, Le mie partite, Persone, Messaggi, Profilo.
- This plan's tests run against the local Supabase stack from the backend-foundation plan (`supabase start` must be running) — the app talks to real Postgres/RLS, not a mocked backend, for anything that isn't a pure unit test of client-side logic.
- `mobile/src/api/supabase.ts` imports `react-native-url-polyfill`, an ESM package Jest's `transformIgnorePatterns` doesn't cover. Every test in this plan that touches a module importing `supabase.ts` (directly or transitively) already uses the factory form of `jest.mock('./supabase', () => ({ supabase: { ... } }))` (or mocks the one intermediate module, e.g. `@/api/users`) rather than a partial/auto mock — the factory form replaces the module entirely, so Jest never executes the real file or its polyfill import. Keep using that pattern for any new API-wrapper test; don't import the real `supabase.ts` unmocked in a Jest test.
- `@testing-library/react-native`'s `renderHook` is `async` in the installed version (14.0.1) and returns a `Promise<RenderHookResult>` — verified against the package's own source, not a style preference. Every `renderHook(...)` call in this plan's tests is `await`ed; write any new hook test the same way.

---

### Task 1: Expo project scaffold

**Files:**
- Create: `mobile/` (entire Expo project via CLI)
- Create: `mobile/tsconfig.json` (strict mode)
- Create: `mobile/jest.config.js`
- Create: `mobile/src/` (empty, for later tasks)

**Interfaces:**
- Produces: a runnable Expo app skeleton with TypeScript, Expo Router, and Jest configured — every later task adds files under `mobile/app/` and `mobile/src/`.

**Toolchain note:** this machine's default npm (12.0.2, via `nvm`) has a real bug in
`npm pack --dry-run --json` (it changed from returning an array to an object for a
single package) that breaks `create-expo-app@latest`'s own parsing of that output —
confirmed against npm's source, not just observed. Node 24.13.0 (npm 11.6.2), already
installed via `nvm` on this machine, doesn't have the bug. `nvm alias default 24.13.0`
has been set so new shells pick it up automatically; if a shell still resolves to the
buggy npm, prefix commands with:
```bash
export PATH="/Users/giovanni/.nvm/versions/node/v24.13.0/bin:$PATH"
```
This only matters for commands that hit the npm registry (`create-expo-app`,
`expo install`) — `npm test`/`npm run typecheck` are unaffected either way.

- [ ] **Step 1: Scaffold the Expo project**

Run (from the repo root):
```bash
npx create-expo-app@latest mobile --template default
cd mobile
```

This produces an Expo Router-based TypeScript template by default (current
`create-expo-app` templates ship Expo Router pre-wired) — but as of
`expo-template-default@57.0.20`, routes live under `mobile/src/app/` and shared code
under `mobile/src/components/`, `mobile/src/hooks/`, `mobile/src/constants/`, not at
`mobile/app/`/`mobile/components/` as older template versions used. Step 6 below
accounts for this.

- [ ] **Step 2: Enable TypeScript strict mode**

The template already sets `strict: true` and a `@/*` → `./src/*` path alias. Edit
`mobile/tsconfig.json` to ensure it reads:
```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "baseUrl": ".",
    "ignoreDeprecations": "6.0",
    "types": ["jest"],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"]
}
```
`ignoreDeprecations: "6.0"` silences TypeScript 6's `TS5101` deprecation error on
`baseUrl` (still required here for the `@/*` alias to resolve); `types: ["jest"]` is
needed because `@types/jest`'s globals (`describe`/`it`/`expect`) aren't picked up
automatically under this template's resolved config.

- [ ] **Step 3: Install the packages this plan needs**

```bash
cd mobile
npx expo install @supabase/supabase-js expo-secure-store expo-location expo-constants zustand
npx expo install --dev jest-expo @testing-library/react-native @types/jest
```

- [ ] **Step 4: Configure Jest**

```js
// mobile/jest.config.js
module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?[\\w.-]*|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)/)',
  ],
  setupFilesAfterEnv: [],
};
```
The `expo(nent)?[\w.-]*` alternative (not just `expo(nent)?`) matters: without it, only
the literal `expo`/`exponent` package name is excluded from transformation, and every
other unscoped `expo-*` package (`expo-modules-core`, `expo-router`, `expo-constants`,
etc.) falls through untranspiled and breaks with `SyntaxError: Cannot use import
statement outside a module`. `setupFilesAfterEnv` (not `setupFilesAfterEach`, which
isn't a real Jest option) is the correct key name.

Add to `mobile/package.json` scripts:
```json
"scripts": {
  "test": "jest",
  "typecheck": "tsc --noEmit"
}
```

- [ ] **Step 5: Write and run a smoke test**

```ts
// mobile/src/smoke.test.ts
describe('project scaffold', () => {
  it('runs a basic assertion under the jest-expo preset', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `cd mobile && npm test`
Expected: 1 passing test.

Run: `cd mobile && npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Reconcile the template's file layout with this plan's expected structure**

Per Step 1's note, the current template puts everything under `mobile/src/`. This plan
(and Task 3 onward) expects routes at `mobile/app/` and shared code at `mobile/src/*`
(matching the `@/*` alias). Reconcile:
1. Move `mobile/src/app/_layout.tsx` to `mobile/app/_layout.tsx`, rewritten as a
   minimal, dependency-free root layout (it will be fully replaced by Task 3's
   session-gating logic anyway — a bare `<Stack />` is enough here):
   ```tsx
   // mobile/app/_layout.tsx
   import { Stack } from 'expo-router';

   export default function RootLayout() {
     return <Stack screenOptions={{ headerShown: false }} />;
   }
   ```
2. Delete the template's example route screens (`mobile/src/app/index.tsx`,
   `mobile/src/app/explore.tsx` or equivalent tab-demo files), and delete
   `mobile/src/components/`, `mobile/src/constants/`, `mobile/src/hooks/`,
   `mobile/src/global.css` if present — none of this plan's later tasks build on the
   template's example UI.
3. Result: `mobile/app/` contains only `_layout.tsx` (Task 3 adds `(auth)/` and
   `(tabs)/` alongside it), and `mobile/src/` contains only `smoke.test.ts` — a clean
   slate for both directories.

Leave `mobile/scripts/reset-project.js` and `mobile/assets/` (icons, splash) untouched.

- [ ] **Step 7: Commit**

```bash
cd "/Users/giovanni/Desktop/app calcio"
git add mobile
git commit -m "chore: scaffold Expo mobile app with TypeScript, Expo Router, and Jest"
```

---

### Task 2: Supabase client, secure session storage, and local test OTP

**Files:**
- Create: `mobile/src/api/supabase.ts`
- Create: `mobile/src/api/secureStorageAdapter.ts`
- Create: `mobile/src/api/secureStorageAdapter.test.ts`
- Create: `mobile/.env.local` (gitignored)
- Modify: `mobile/.gitignore` (ensure `.env.local` is excluded — the template already ignores `.env*.local` by default; verify)
- Modify: `/Users/giovanni/Desktop/app calcio/supabase/config.toml` (add a local-only test OTP mapping)

**Interfaces:**
- Consumes: the local Supabase stack's URL/anon key (`supabase status -o env`).
- Produces: `supabase` (named export, a configured `SupabaseClient`) from `mobile/src/api/supabase.ts`, imported as `import { supabase } from './supabase'` (or `@/api/supabase`) by every other `src/api/*` module and screen in this plan.

- [ ] **Step 1: Write the failing test for the storage adapter**

```ts
// mobile/src/api/secureStorageAdapter.test.ts
import * as SecureStore from 'expo-secure-store';
import { secureStorageAdapter } from './secureStorageAdapter';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

describe('secureStorageAdapter', () => {
  afterEach(() => jest.clearAllMocks());

  it('reads a value through SecureStore.getItemAsync', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('stored-value');
    const result = await secureStorageAdapter.getItem('my-key');
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith('my-key');
    expect(result).toBe('stored-value');
  });

  it('writes a value through SecureStore.setItemAsync', async () => {
    await secureStorageAdapter.setItem('my-key', 'my-value');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('my-key', 'my-value');
  });

  it('removes a value through SecureStore.deleteItemAsync', async () => {
    await secureStorageAdapter.removeItem('my-key');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('my-key');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- secureStorageAdapter`
Expected: FAIL — `Cannot find module './secureStorageAdapter'`.

- [ ] **Step 3: Implement the storage adapter**

```ts
// mobile/src/api/secureStorageAdapter.ts
import * as SecureStore from 'expo-secure-store';

// Supabase's auth client expects a storage object with this shape (a subset
// of the web Storage interface, async-friendly). expo-secure-store has a
// ~2KB per-value limit on some platforms; a standard Supabase session
// (access + refresh token) fits comfortably under that in practice, so no
// chunking is implemented here -- revisit only if this becomes a real issue.
export const secureStorageAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- secureStorageAdapter`
Expected: 3 passing tests.

- [ ] **Step 5: Create the Supabase client**

```ts
// mobile/src/api/supabase.ts
import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { secureStorageAdapter } from './secureStorageAdapter';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. Copy mobile/.env.local.example to mobile/.env.local and fill in `supabase status -o env` values.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: secureStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
```

`react-native-url-polyfill` is required because Supabase JS relies on `URL`, which React Native's JS engine doesn't provide natively:

```bash
npx expo install react-native-url-polyfill
```

- [ ] **Step 6: Wire local environment values**

Run against the already-running local backend:
```bash
cd "/Users/giovanni/Desktop/app calcio" && supabase status -o env
```

Create `mobile/.env.local` (gitignored) with the printed `API_URL` and `ANON_KEY`, renamed to the Expo-prefixed names:
```
EXPO_PUBLIC_SUPABASE_URL=<API_URL from supabase status>
EXPO_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY from supabase status>
```

Also create `mobile/.env.local.example` (committed, no real values) documenting the two required variables for whoever sets up the project next.

- [ ] **Step 7: Add a local-only test OTP so registration is testable without a real SMS provider**

The spec explicitly defers configuring a real SMS provider to the user (a Twilio/similar account creation Claude cannot do on their behalf). For local development and this plan's own end-to-end verification (Task 9), configure Supabase's built-in local test-OTP bypass — this only affects the local CLI stack (`supabase start`), never a linked/hosted project, since `supabase db push`/deploy don't propagate `config.toml`'s `[auth]` section.

Edit `/Users/giovanni/Desktop/app calcio/supabase/config.toml`, in the `[auth.sms]` section, add:
```toml
[auth.sms.test_otp]
# Local development only. A real SMS provider must be configured before this
# app can be used with real phone numbers -- see the plan's "what this does
# not cover" note.
"+390000000001" = "123456"
```

Run `supabase stop && supabase start` (from the repo root) to apply the config change, then confirm the extensions test suite is still green: `supabase test db`.

- [ ] **Step 8: Commit**

```bash
cd "/Users/giovanni/Desktop/app calcio"
git add mobile/src/api mobile/package.json mobile/.env.local.example supabase/config.toml
git commit -m "feat: add Supabase client with secure session storage and local test OTP"
```

---

### Task 3: Navigation shell (auth stack + tab navigator, session-gated)

**Files:**
- Create: `mobile/src/stores/sessionStore.ts`
- Create: `mobile/src/stores/sessionStore.test.ts`
- Modify: `mobile/app/_layout.tsx`
- Create: `mobile/app/(auth)/_layout.tsx`
- Create: `mobile/app/(tabs)/_layout.tsx`
- Create: `mobile/app/(tabs)/my-matches/index.tsx` (placeholder)
- Create: `mobile/app/(tabs)/people/index.tsx` (placeholder)
- Create: `mobile/app/(tabs)/messages/index.tsx` (placeholder)
- Create: `mobile/src/components/ScreenPlaceholder.tsx`

**Interfaces:**
- Consumes: `supabase` (Task 2).
- Produces: `useSessionStore()` (Zustand hook exposing `{ session, profile, status, setSession, setProfile }`), used by every screen in this plan and every later plan to know who's signed in.

- [ ] **Step 1: Write the failing test for the session store**

```ts
// mobile/src/stores/sessionStore.test.ts
import { useSessionStore } from './sessionStore';

describe('useSessionStore', () => {
  beforeEach(() => {
    useSessionStore.setState({ session: null, profile: null, status: 'loading' });
  });

  it('starts in the loading status with no session', () => {
    const state = useSessionStore.getState();
    expect(state.status).toBe('loading');
    expect(state.session).toBeNull();
  });

  it('setSession(null) moves status to signed-out', () => {
    useSessionStore.getState().setSession(null);
    expect(useSessionStore.getState().status).toBe('signed-out');
  });

  it('setSession(a session) with no profile moves status to needs-profile', () => {
    useSessionStore.getState().setSession({ user: { id: 'u1' } } as never);
    expect(useSessionStore.getState().status).toBe('needs-profile');
  });

  it('setProfile after a session moves status to signed-in', () => {
    useSessionStore.getState().setSession({ user: { id: 'u1' } } as never);
    useSessionStore.getState().setProfile({ id: 'u1', unique_user_id: 'FC-100000' } as never);
    expect(useSessionStore.getState().status).toBe('signed-in');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- sessionStore`
Expected: FAIL — `Cannot find module './sessionStore'`.

- [ ] **Step 3: Implement the session store**

```ts
// mobile/src/stores/sessionStore.ts
import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

type UserProfile = Database['public']['Tables']['users']['Row'];

export type SessionStatus = 'loading' | 'signed-out' | 'needs-profile' | 'signed-in';

interface SessionState {
  session: Session | null;
  profile: UserProfile | null;
  status: SessionStatus;
  setSession: (session: Session | null) => void;
  setProfile: (profile: UserProfile | null) => void;
}

function computeStatus(session: Session | null, profile: UserProfile | null): SessionStatus {
  if (!session) return 'signed-out';
  if (!profile) return 'needs-profile';
  return 'signed-in';
}

export const useSessionStore = create<SessionState>((set, get) => ({
  session: null,
  profile: null,
  status: 'loading',
  setSession: (session) => set({ session, status: computeStatus(session, get().profile) }),
  setProfile: (profile) => set({ profile, status: computeStatus(get().session, profile) }),
}));
```

This plan hand-writes the `Database['public']['Tables']['users']['Row']` shape rather than generating it, to keep this task self-contained:

```ts
// mobile/src/types/database.ts
export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          unique_user_id: string;
          phone: string;
          first_name: string;
          last_name: string;
          birth_date: string;
          height_cm: number;
          preferred_foot: 'left' | 'right' | 'both';
          player_role: 'player' | 'goalkeeper' | 'both';
          profile_image_url: string | null;
          matches_played_count: number;
          matches_completed_count: number;
          matches_abandoned_count: number;
          created_at: string;
          updated_at: string;
        };
      };
    };
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- sessionStore`
Expected: 4 passing tests.

- [ ] **Step 5: Wire the root layout to listen for auth changes and gate navigation**

```tsx
// mobile/app/_layout.tsx
import { useEffect } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { supabase } from '@/api/supabase';
import { useSessionStore } from '@/stores/sessionStore';

export default function RootLayout() {
  const { session, status, setSession } = useSessionStore();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.subscription.unsubscribe();
  }, [setSession]);

  useEffect(() => {
    if (status === 'loading') return;
    const inAuthGroup = segments[0] === '(auth)';

    if (status === 'signed-out' && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (status === 'needs-profile' && segments[1] !== 'create-profile') {
      router.replace('/(auth)/create-profile');
    } else if (status === 'signed-in' && inAuthGroup) {
      router.replace('/(tabs)/home');
    }
  }, [status, segments, router]);

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return <Slot />;
}
```

Note: `status === 'needs-profile'` is set once `setSession` runs; Task 4/5 are responsible for calling `setProfile` after fetching or creating the profile row so this effect can move past `needs-profile`.

- [ ] **Step 6: Create the auth stack layout**

```tsx
// mobile/app/(auth)/_layout.tsx
import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="register-phone" />
      <Stack.Screen name="verify-otp" />
      <Stack.Screen name="create-password" />
      <Stack.Screen name="create-profile" />
    </Stack>
  );
}
```

- [ ] **Step 7: Create the tab navigator with the 5 required tabs**

```tsx
// mobile/app/(tabs)/_layout.tsx
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen
        name="home"
        options={{ title: 'Home', tabBarIcon: ({ color, size }) => <Ionicons name="home" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="my-matches"
        options={{ title: 'Le mie partite', tabBarIcon: ({ color, size }) => <Ionicons name="football" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="people"
        options={{ title: 'Persone', tabBarIcon: ({ color, size }) => <Ionicons name="people" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="messages"
        options={{ title: 'Messaggi', tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profilo', tabBarIcon: ({ color, size }) => <Ionicons name="person" color={color} size={size} /> }}
      />
    </Tabs>
  );
}
```

- [ ] **Step 8: Placeholder screens for the three tabs this plan doesn't implement**

```tsx
// mobile/src/components/ScreenPlaceholder.tsx
import { View, Text, StyleSheet } from 'react-native';

export function ScreenPlaceholder({ title }: { title: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>{title}</Text>
      <Text style={styles.subtext}>In arrivo in un prossimo aggiornamento.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  text: { fontSize: 18, fontWeight: '600' },
  subtext: { color: '#666' },
});
```

```tsx
// mobile/app/(tabs)/my-matches/index.tsx
import { ScreenPlaceholder } from '@/components/ScreenPlaceholder';
export default function MyMatchesScreen() {
  return <ScreenPlaceholder title="Le mie partite" />;
}
```

Repeat identically for `mobile/app/(tabs)/people/index.tsx` (title `"Persone"`) and `mobile/app/(tabs)/messages/index.tsx` (title `"Messaggi"`).

- [ ] **Step 9: Run the full test suite and typecheck**

Run: `cd mobile && npm test && npm run typecheck`
Expected: all tests passing (including Task 1/2's), no type errors. (`home`/`profile`/auth screens don't exist yet — Tasks 4/5/7/8 add them — so this step is about the store/layout logic compiling and testing cleanly, not a full app boot yet.)

- [ ] **Step 10: Commit**

```bash
cd "/Users/giovanni/Desktop/app calcio"
git add mobile/src/stores mobile/src/types mobile/src/components mobile/app/_layout.tsx mobile/app/\(auth\) mobile/app/\(tabs\)
git commit -m "feat: add session-gated navigation shell with 5-tab layout"
```

---

### Task 4: Login screen (returning users — phone + password)

**Files:**
- Create: `mobile/src/api/auth.ts`
- Create: `mobile/src/api/auth.test.ts`
- Create: `mobile/src/hooks/useLogin.ts`
- Create: `mobile/app/(auth)/login.tsx`

**Interfaces:**
- Consumes: `supabase` (Task 2).
- Produces: `signInWithPassword(phone, password)` from `src/api/auth.ts`, used by `useLogin`; both reused conceptually (not literally imported) by later plans' password-related settings screens.

- [ ] **Step 1: Write the failing test**

```ts
// mobile/src/api/auth.test.ts
import { supabase } from './supabase';
import { signInWithPassword, requestPhoneOtp, verifyPhoneOtp, setPassword } from './auth';

jest.mock('./supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: jest.fn(),
      signInWithOtp: jest.fn(),
      verifyOtp: jest.fn(),
      updateUser: jest.fn(),
    },
  },
}));

describe('auth api', () => {
  afterEach(() => jest.clearAllMocks());

  it('signInWithPassword calls supabase with phone and password, returns data', async () => {
    (supabase.auth.signInWithPassword as jest.Mock).mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    const result = await signInWithPassword('+390000000001', 'hunter2');
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({ phone: '+390000000001', password: 'hunter2' });
    expect(result.user?.id).toBe('u1');
  });

  it('signInWithPassword throws the Supabase error message on failure', async () => {
    (supabase.auth.signInWithPassword as jest.Mock).mockResolvedValue({ data: null, error: { message: 'Invalid login credentials' } });
    await expect(signInWithPassword('+390000000001', 'wrong')).rejects.toThrow('Invalid login credentials');
  });

  it('requestPhoneOtp calls signInWithOtp with the phone number', async () => {
    (supabase.auth.signInWithOtp as jest.Mock).mockResolvedValue({ data: {}, error: null });
    await requestPhoneOtp('+390000000001');
    expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({ phone: '+390000000001' });
  });

  it('verifyPhoneOtp calls verifyOtp with phone, token, and sms type', async () => {
    (supabase.auth.verifyOtp as jest.Mock).mockResolvedValue({ data: { session: { access_token: 't' } }, error: null });
    const result = await verifyPhoneOtp('+390000000001', '123456');
    expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({ phone: '+390000000001', token: '123456', type: 'sms' });
    expect(result.session?.access_token).toBe('t');
  });

  it('setPassword calls updateUser with the new password', async () => {
    (supabase.auth.updateUser as jest.Mock).mockResolvedValue({ data: {}, error: null });
    await setPassword('newpass123');
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'newpass123' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- auth.test`
Expected: FAIL — `Cannot find module './auth'`.

- [ ] **Step 3: Implement the auth API wrapper**

```ts
// mobile/src/api/auth.ts
import { supabase } from './supabase';
import type { Session, User } from '@supabase/supabase-js';

export async function signInWithPassword(phone: string, password: string): Promise<{ user: User | null }> {
  const { data, error } = await supabase.auth.signInWithPassword({ phone, password });
  if (error) throw new Error(error.message);
  return { user: data?.user ?? null };
}

export async function requestPhoneOtp(phone: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({ phone });
  if (error) throw new Error(error.message);
}

export async function verifyPhoneOtp(phone: string, token: string): Promise<{ session: Session | null }> {
  const { data, error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
  if (error) throw new Error(error.message);
  return { session: data?.session ?? null };
}

export async function setPassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- auth.test`
Expected: 5 passing tests.

- [ ] **Step 5: Write the login hook**

```ts
// mobile/src/hooks/useLogin.ts
import { useState } from 'react';
import { signInWithPassword } from '@/api/auth';

export function useLogin() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function login(phone: string, password: string) {
    setLoading(true);
    setError(null);
    try {
      await signInWithPassword(phone, password);
      // No navigation here: the root layout's auth-state listener (Task 3)
      // reacts to the resulting session change and redirects.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Accesso non riuscito.');
    } finally {
      setLoading(false);
    }
  }

  return { login, loading, error };
}
```

- [ ] **Step 6: Build the login screen**

```tsx
// mobile/app/(auth)/login.tsx
import { useState } from 'react';
import { View, TextInput, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Link } from 'expo-router';
import { useLogin } from '@/hooks/useLogin';

export default function LoginScreen() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const { login, loading, error } = useLogin();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Accedi</Text>
      <TextInput
        style={styles.input}
        placeholder="Numero di telefono"
        keyboardType="phone-pad"
        autoComplete="tel"
        value={phone}
        onChangeText={setPhone}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        autoComplete="password"
        value={password}
        onChangeText={setPassword}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={styles.button} onPress={() => login(phone, password)} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Accedi</Text>}
      </Pressable>
      <Link href="/(auth)/register-phone" style={styles.link}>
        Non hai un account? Registrati
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 16 },
  button: { backgroundColor: '#1a7f37', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  error: { color: '#c0392b' },
  link: { textAlign: 'center', marginTop: 16, color: '#1a7f37' },
});
```

- [ ] **Step 7: Run full test suite and typecheck**

Run: `cd mobile && npm test && npm run typecheck`
Expected: all passing, no type errors.

- [ ] **Step 8: Commit**

```bash
cd "/Users/giovanni/Desktop/app calcio"
git add mobile/src/api/auth.ts mobile/src/api/auth.test.ts mobile/src/hooks/useLogin.ts "mobile/app/(auth)/login.tsx"
git commit -m "feat: add login screen for returning users (phone + password)"
```

---

### Task 5: Registration flow (phone → OTP → password → profile)

**Files:**
- Create: `mobile/src/hooks/useRegistration.ts`
- Create: `mobile/src/hooks/useRegistration.test.ts`
- Create: `mobile/src/api/users.ts`
- Create: `mobile/src/api/users.test.ts`
- Create: `mobile/app/(auth)/register-phone.tsx`
- Create: `mobile/app/(auth)/verify-otp.tsx`
- Create: `mobile/app/(auth)/create-password.tsx`
- Create: `mobile/app/(auth)/create-profile.tsx`

**Interfaces:**
- Consumes: `requestPhoneOtp`, `verifyPhoneOtp`, `setPassword` (Task 4's `src/api/auth.ts`); `useSessionStore` (Task 3).
- Produces: `createOwnProfile(profile)` and `fetchOwnProfile(userId)` from `src/api/users.ts`, used again by Task 8 (profile screen) and later plans (settings).

- [ ] **Step 1: Write the failing test for the users API**

```ts
// mobile/src/api/users.test.ts
import { supabase } from './supabase';
import { createOwnProfile, fetchOwnProfile } from './users';

jest.mock('./supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

describe('users api', () => {
  afterEach(() => jest.clearAllMocks());

  it('createOwnProfile inserts a row into public.users and returns it', async () => {
    const single = jest.fn().mockResolvedValue({
      data: { id: 'u1', unique_user_id: 'FC-100000', first_name: 'Mario' },
      error: null,
    });
    const select = jest.fn().mockReturnValue({ single });
    const insert = jest.fn().mockReturnValue({ select });
    (supabase.from as jest.Mock).mockReturnValue({ insert });

    const result = await createOwnProfile({
      id: 'u1',
      phone: '+390000000001',
      first_name: 'Mario',
      last_name: 'Rossi',
      birth_date: '1990-01-01',
      height_cm: 180,
      preferred_foot: 'right',
      player_role: 'player',
    });

    expect(supabase.from).toHaveBeenCalledWith('users');
    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'u1', first_name: 'Mario' }),
    ]);
    expect(result.unique_user_id).toBe('FC-100000');
  });

  it('createOwnProfile throws the Supabase error message on failure', async () => {
    const single = jest.fn().mockResolvedValue({ data: null, error: { message: 'duplicate key value' } });
    const select = jest.fn().mockReturnValue({ single });
    const insert = jest.fn().mockReturnValue({ select });
    (supabase.from as jest.Mock).mockReturnValue({ insert });

    await expect(
      createOwnProfile({
        id: 'u1',
        phone: '+390000000001',
        first_name: 'Mario',
        last_name: 'Rossi',
        birth_date: '1990-01-01',
        height_cm: 180,
        preferred_foot: 'right',
        player_role: 'player',
      })
    ).rejects.toThrow('duplicate key value');
  });

  it('fetchOwnProfile selects a single row by id', async () => {
    const single = jest.fn().mockResolvedValue({ data: { id: 'u1' }, error: null });
    const eq = jest.fn().mockReturnValue({ single });
    const select = jest.fn().mockReturnValue({ eq });
    (supabase.from as jest.Mock).mockReturnValue({ select });

    const result = await fetchOwnProfile('u1');
    expect(supabase.from).toHaveBeenCalledWith('users');
    expect(eq).toHaveBeenCalledWith('id', 'u1');
    expect(result?.id).toBe('u1');
  });

  it('fetchOwnProfile returns null when no row exists yet (new user mid-registration)', async () => {
    const single = jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'no rows' } });
    const eq = jest.fn().mockReturnValue({ single });
    const select = jest.fn().mockReturnValue({ eq });
    (supabase.from as jest.Mock).mockReturnValue({ select });

    const result = await fetchOwnProfile('u1');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- users.test`
Expected: FAIL — `Cannot find module './users'`.

- [ ] **Step 3: Implement the users API wrapper**

```ts
// mobile/src/api/users.ts
import { supabase } from './supabase';
import type { Database } from '@/types/database';

type UserProfile = Database['public']['Tables']['users']['Row'];
type NewUserProfile = Pick<
  UserProfile,
  'id' | 'phone' | 'first_name' | 'last_name' | 'birth_date' | 'height_cm' | 'preferred_foot' | 'player_role'
>;

export async function createOwnProfile(profile: NewUserProfile): Promise<UserProfile> {
  const { data, error } = await supabase.from('users').insert([profile]).select().single();
  if (error) throw new Error(error.message);
  return data as UserProfile;
}

export async function fetchOwnProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase.from('users').select().eq('id', userId).single();
  // PGRST116 = "no rows returned" -- expected when a user has a session but
  // hasn't finished profile creation yet, not a real error.
  if (error && error.code !== 'PGRST116') throw new Error(error.message);
  return (data as UserProfile) ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- users.test`
Expected: 4 passing tests.

- [ ] **Step 5: Write the registration hook**

```ts
// mobile/src/hooks/useRegistration.ts
import { useState } from 'react';
import { router } from 'expo-router';
import { requestPhoneOtp, verifyPhoneOtp, setPassword } from '@/api/auth';
import { createOwnProfile } from '@/api/users';
import { useSessionStore } from '@/stores/sessionStore';

export function useRegistration() {
  const [phone, setPhoneState] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setProfile = useSessionStore((s) => s.setProfile);

  async function sendOtp(phoneNumber: string) {
    setLoading(true);
    setError(null);
    try {
      await requestPhoneOtp(phoneNumber);
      setPhoneState(phoneNumber);
      router.push('/(auth)/verify-otp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invio del codice non riuscito.');
    } finally {
      setLoading(false);
    }
  }

  async function confirmOtp(token: string) {
    setLoading(true);
    setError(null);
    try {
      await verifyPhoneOtp(phone, token);
      router.push('/(auth)/create-password');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Codice non valido.');
    } finally {
      setLoading(false);
    }
  }

  async function choosePassword(password: string) {
    setLoading(true);
    setError(null);
    try {
      await setPassword(password);
      router.push('/(auth)/create-profile');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impostazione password non riuscita.');
    } finally {
      setLoading(false);
    }
  }

  async function completeProfile(input: {
    userId: string;
    firstName: string;
    lastName: string;
    birthDate: string;
    heightCm: number;
    preferredFoot: 'left' | 'right' | 'both';
    playerRole: 'player' | 'goalkeeper' | 'both';
  }) {
    setLoading(true);
    setError(null);
    try {
      const profile = await createOwnProfile({
        id: input.userId,
        phone,
        first_name: input.firstName,
        last_name: input.lastName,
        birth_date: input.birthDate,
        height_cm: input.heightCm,
        preferred_foot: input.preferredFoot,
        player_role: input.playerRole,
      });
      setProfile(profile);
      // Root layout (Task 3) redirects to /(tabs)/home once status becomes 'signed-in'.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Creazione del profilo non riuscita.');
    } finally {
      setLoading(false);
    }
  }

  return { phone, loading, error, sendOtp, confirmOtp, choosePassword, completeProfile };
}
```

- [ ] **Step 6: Write and run the test for the registration hook**

This plan's Files list for this task always intended `useRegistration.test.ts` to exist,
but the original text never actually specified its content — a real gap, caught during
implementation. This is the most consequential hook in the app (it drives the entire
registration UX across 4 screens), so it gets real coverage now rather than staying
untested:

```ts
// mobile/src/hooks/useRegistration.test.ts
import { renderHook, act } from '@testing-library/react-native';
import { router } from 'expo-router';
import { useRegistration } from './useRegistration';
import { requestPhoneOtp, verifyPhoneOtp } from '@/api/auth';
import { createOwnProfile } from '@/api/users';
import { useSessionStore } from '@/stores/sessionStore';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/api/auth', () => ({
  requestPhoneOtp: jest.fn(),
  verifyPhoneOtp: jest.fn(),
  setPassword: jest.fn(),
}));
jest.mock('@/api/users', () => ({ createOwnProfile: jest.fn() }));

describe('useRegistration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSessionStore.setState({ session: null, profile: null, status: 'loading' });
  });

  it('sendOtp requests an OTP, stores the phone, and navigates to verify-otp', async () => {
    (requestPhoneOtp as jest.Mock).mockResolvedValue(undefined);
    // @testing-library/react-native@14's renderHook returns a Promise -- await it
    // (a real version-specific requirement, verified against the installed package's
    // own source, not a style choice -- applies to every renderHook call in this plan).
    const { result } = await renderHook(() => useRegistration());

    await act(async () => {
      await result.current.sendOtp('+390000000001');
    });

    expect(requestPhoneOtp).toHaveBeenCalledWith('+390000000001');
    expect(router.push).toHaveBeenCalledWith('/(auth)/verify-otp');
    expect(result.current.error).toBeNull();
  });

  it('sendOtp sets an error and does not navigate when the request fails', async () => {
    (requestPhoneOtp as jest.Mock).mockRejectedValue(new Error('rate limited'));
    // @testing-library/react-native@14's renderHook returns a Promise -- await it
    // (a real version-specific requirement, verified against the installed package's
    // own source, not a style choice -- applies to every renderHook call in this plan).
    const { result } = await renderHook(() => useRegistration());

    await act(async () => {
      await result.current.sendOtp('+390000000001');
    });

    expect(result.current.error).toBe('rate limited');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('confirmOtp verifies the code against the phone stored by sendOtp, and navigates to create-password', async () => {
    (requestPhoneOtp as jest.Mock).mockResolvedValue(undefined);
    (verifyPhoneOtp as jest.Mock).mockResolvedValue({ session: { access_token: 't' } });
    // @testing-library/react-native@14's renderHook returns a Promise -- await it
    // (a real version-specific requirement, verified against the installed package's
    // own source, not a style choice -- applies to every renderHook call in this plan).
    const { result } = await renderHook(() => useRegistration());

    await act(async () => {
      await result.current.sendOtp('+390000000001');
    });
    (router.push as jest.Mock).mockClear();

    await act(async () => {
      await result.current.confirmOtp('123456');
    });

    expect(verifyPhoneOtp).toHaveBeenCalledWith('+390000000001', '123456');
    expect(router.push).toHaveBeenCalledWith('/(auth)/create-password');
  });

  it('completeProfile creates the profile, stores it in the session store, and clears any prior error', async () => {
    (createOwnProfile as jest.Mock).mockResolvedValue({ id: 'u1', unique_user_id: 'FC-100000' });
    // @testing-library/react-native@14's renderHook returns a Promise -- await it
    // (a real version-specific requirement, verified against the installed package's
    // own source, not a style choice -- applies to every renderHook call in this plan).
    const { result } = await renderHook(() => useRegistration());

    await act(async () => {
      await result.current.completeProfile({
        userId: 'u1',
        firstName: 'Mario',
        lastName: 'Rossi',
        birthDate: '1990-01-01',
        heightCm: 180,
        preferredFoot: 'right',
        playerRole: 'player',
      });
    });

    expect(createOwnProfile).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1', first_name: 'Mario' })
    );
    expect(useSessionStore.getState().profile?.unique_user_id).toBe('FC-100000');
    expect(result.current.error).toBeNull();
  });
});
```

Run: `cd mobile && npm test -- useRegistration`
Expected: 4 passing tests.

- [ ] **Step 7: Build the four registration screens**

```tsx
// mobile/app/(auth)/register-phone.tsx
import { useState } from 'react';
import { View, TextInput, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useRegistration } from '@/hooks/useRegistration';

export default function RegisterPhoneScreen() {
  const [phone, setPhone] = useState('');
  const { sendOtp, loading, error } = useRegistration();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Il tuo numero</Text>
      <Text style={styles.subtitle}>Ti invieremo un codice via SMS per verificarlo.</Text>
      <TextInput
        style={styles.input}
        placeholder="Numero di telefono"
        keyboardType="phone-pad"
        autoComplete="tel"
        value={phone}
        onChangeText={setPhone}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={styles.button} onPress={() => sendOtp(phone)} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Invia codice</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#666', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 16 },
  button: { backgroundColor: '#1a7f37', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  error: { color: '#c0392b' },
});
```

```tsx
// mobile/app/(auth)/verify-otp.tsx
import { useState } from 'react';
import { View, TextInput, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useRegistration } from '@/hooks/useRegistration';

export default function VerifyOtpScreen() {
  const [token, setToken] = useState('');
  const { confirmOtp, loading, error } = useRegistration();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Verifica il codice</Text>
      <TextInput
        style={styles.input}
        placeholder="Codice a 6 cifre"
        keyboardType="number-pad"
        maxLength={6}
        value={token}
        onChangeText={setToken}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={styles.button} onPress={() => confirmOtp(token)} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verifica</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 24, textAlign: 'center', letterSpacing: 8 },
  button: { backgroundColor: '#1a7f37', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  error: { color: '#c0392b' },
});
```

```tsx
// mobile/app/(auth)/create-password.tsx
import { useState } from 'react';
import { View, TextInput, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useRegistration } from '@/hooks/useRegistration';

export default function CreatePasswordScreen() {
  const [password, setPassword] = useState('');
  const { choosePassword, loading, error } = useRegistration();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Crea una password</Text>
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        autoComplete="new-password"
        value={password}
        onChangeText={setPassword}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={styles.button} onPress={() => choosePassword(password)} disabled={loading || password.length < 8}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Continua</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 16 },
  button: { backgroundColor: '#1a7f37', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  error: { color: '#c0392b' },
});
```

```tsx
// mobile/app/(auth)/create-profile.tsx
import { useState } from 'react';
import { View, TextInput, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { useRegistration } from '@/hooks/useRegistration';
import { useSessionStore } from '@/stores/sessionStore';

const FEET = ['left', 'right', 'both'] as const;
const ROLES = ['player', 'goalkeeper', 'both'] as const;

export default function CreateProfileScreen() {
  const userId = useSessionStore((s) => s.session?.user.id);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [preferredFoot, setPreferredFoot] = useState<(typeof FEET)[number]>('right');
  const [playerRole, setPlayerRole] = useState<(typeof ROLES)[number]>('player');
  const { completeProfile, loading, error } = useRegistration();

  const canSubmit = !!userId && firstName && lastName && birthDate && heightCm;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Crea il tuo profilo</Text>
      <TextInput style={styles.input} placeholder="Nome" value={firstName} onChangeText={setFirstName} />
      <TextInput style={styles.input} placeholder="Cognome" value={lastName} onChangeText={setLastName} />
      <TextInput style={styles.input} placeholder="Data di nascita (AAAA-MM-GG)" value={birthDate} onChangeText={setBirthDate} />
      <TextInput style={styles.input} placeholder="Altezza (cm)" keyboardType="number-pad" value={heightCm} onChangeText={setHeightCm} />
      <Text style={styles.label}>Piede preferito</Text>
      <View style={styles.row}>
        {FEET.map((foot) => (
          <Pressable key={foot} style={[styles.chip, preferredFoot === foot && styles.chipSelected]} onPress={() => setPreferredFoot(foot)}>
            <Text style={preferredFoot === foot ? styles.chipTextSelected : styles.chipText}>{foot}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.label}>Ruolo</Text>
      <View style={styles.row}>
        {ROLES.map((role) => (
          <Pressable key={role} style={[styles.chip, playerRole === role && styles.chipSelected]} onPress={() => setPlayerRole(role)}>
            <Text style={playerRole === role ? styles.chipTextSelected : styles.chipText}>{role}</Text>
          </Pressable>
        ))}
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        style={styles.button}
        disabled={loading || !canSubmit}
        onPress={() =>
          userId &&
          completeProfile({
            userId,
            firstName,
            lastName,
            birthDate,
            heightCm: Number(heightCm),
            preferredFoot,
            playerRole,
          })
        }
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Crea profilo</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 16 },
  label: { fontWeight: '600', marginTop: 8 },
  row: { flexDirection: 'row', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#ccc', borderRadius: 20, paddingVertical: 8, paddingHorizontal: 16 },
  chipSelected: { backgroundColor: '#1a7f37', borderColor: '#1a7f37' },
  chipText: { color: '#333' },
  chipTextSelected: { color: '#fff' },
  button: { backgroundColor: '#1a7f37', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 16 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  error: { color: '#c0392b' },
});
```

- [ ] **Step 8: Run full test suite and typecheck**

Run: `cd mobile && npm test && npm run typecheck`
Expected: all passing (including `useRegistration.test.ts`'s 4 assertions from Step 6), no type errors.

- [ ] **Step 9: Commit**

```bash
cd "/Users/giovanni/Desktop/app calcio"
git add mobile/src/api/users.ts mobile/src/api/users.test.ts mobile/src/hooks/useRegistration.ts mobile/src/hooks/useRegistration.test.ts "mobile/app/(auth)/register-phone.tsx" "mobile/app/(auth)/verify-otp.tsx" "mobile/app/(auth)/create-password.tsx" "mobile/app/(auth)/create-profile.tsx"
git commit -m "feat: add registration flow (phone, OTP, password, profile creation)"
```

---

### Task 6: Resolve profile status on session restore

**Files:**
- Modify: `mobile/app/_layout.tsx`
- Create: `mobile/src/hooks/useProfileBootstrap.ts`
- Create: `mobile/src/hooks/useProfileBootstrap.test.ts`

**Interfaces:**
- Consumes: `fetchOwnProfile` (Task 5), `useSessionStore` (Task 3).
- Produces: nothing new consumed by later tasks — this closes a gap in Task 3's root layout (a returning user with a session but an un-fetched profile would otherwise be stuck at `needs-profile` forever, since Task 3 only calls `setProfile` from the registration flow).

- [ ] **Step 1: Write the failing test**

```ts
// mobile/src/hooks/useProfileBootstrap.test.ts
import { renderHook, waitFor } from '@testing-library/react-native';
import { useProfileBootstrap } from './useProfileBootstrap';
import { useSessionStore } from '@/stores/sessionStore';
import { fetchOwnProfile } from '@/api/users';

jest.mock('@/api/users', () => ({ fetchOwnProfile: jest.fn() }));

describe('useProfileBootstrap', () => {
  beforeEach(() => {
    useSessionStore.setState({ session: null, profile: null, status: 'loading' });
    jest.clearAllMocks();
  });

  it('does nothing when there is no session', async () => {
    // @testing-library/react-native@14's renderHook returns a Promise -- await it,
    // same as every other renderHook call in this plan (see Task 5's note).
    await renderHook(() => useProfileBootstrap());
    expect(fetchOwnProfile).not.toHaveBeenCalled();
  });

  it('fetches and stores the profile once a session with no profile appears', async () => {
    (fetchOwnProfile as jest.Mock).mockResolvedValue({ id: 'u1', unique_user_id: 'FC-100000' });
    useSessionStore.getState().setSession({ user: { id: 'u1' } } as never);

    await renderHook(() => useProfileBootstrap());

    await waitFor(() => expect(fetchOwnProfile).toHaveBeenCalledWith('u1'));
    await waitFor(() => expect(useSessionStore.getState().status).toBe('signed-in'));
  });

  it('leaves status at needs-profile when the fetch finds no row yet (mid-registration)', async () => {
    (fetchOwnProfile as jest.Mock).mockResolvedValue(null);
    useSessionStore.getState().setSession({ user: { id: 'u1' } } as never);

    await renderHook(() => useProfileBootstrap());

    await waitFor(() => expect(fetchOwnProfile).toHaveBeenCalledWith('u1'));
    expect(useSessionStore.getState().status).toBe('needs-profile');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- useProfileBootstrap`
Expected: FAIL — `Cannot find module './useProfileBootstrap'`.

- [ ] **Step 3: Implement the hook**

```ts
// mobile/src/hooks/useProfileBootstrap.ts
import { useEffect } from 'react';
import { fetchOwnProfile } from '@/api/users';
import { useSessionStore } from '@/stores/sessionStore';

// Runs once per session change: if we have a session but haven't loaded (or
// created) a profile row yet, try to fetch one. Covers the "app restarted
// with a valid session from a previous, completed registration" case, which
// the registration flow itself (Task 5) never exercises.
export function useProfileBootstrap() {
  const session = useSessionStore((s) => s.session);
  const profile = useSessionStore((s) => s.profile);
  const setProfile = useSessionStore((s) => s.setProfile);

  useEffect(() => {
    if (!session || profile) return;
    let cancelled = false;
    fetchOwnProfile(session.user.id).then((fetched) => {
      if (!cancelled && fetched) setProfile(fetched);
    });
    return () => {
      cancelled = true;
    };
  }, [session, profile, setProfile]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- useProfileBootstrap`
Expected: 3 passing tests.

- [ ] **Step 5: Wire it into the root layout**

```tsx
// mobile/app/_layout.tsx
// ...existing imports...
import { useProfileBootstrap } from '@/hooks/useProfileBootstrap';

export default function RootLayout() {
  const { session, status, setSession } = useSessionStore();
  const router = useRouter();
  const segments = useSegments();

  useProfileBootstrap();

  // ...rest unchanged from Task 3...
```

- [ ] **Step 6: Run full test suite and typecheck**

Run: `cd mobile && npm test && npm run typecheck`
Expected: all passing, no type errors.

- [ ] **Step 7: Commit**

```bash
cd "/Users/giovanni/Desktop/app calcio"
git add mobile/src/hooks/useProfileBootstrap.ts mobile/src/hooks/useProfileBootstrap.test.ts mobile/app/_layout.tsx
git commit -m "feat: fetch existing profile on session restore so returning users aren't stuck at create-profile"
```

---

### Task 7: Home screen — GPS permission + nearby matches list

**Files:**
- Create: `mobile/src/api/matches.ts`
- Create: `mobile/src/api/matches.test.ts`
- Create: `mobile/src/hooks/useNearbyMatches.ts`
- Create: `mobile/src/hooks/useNearbyMatches.test.ts`
- Create: `mobile/src/components/MatchCard.tsx`
- Create: `mobile/app/(tabs)/home/index.tsx`

**Interfaces:**
- Consumes: `supabase` (Task 2), the `nearby_open_matches` RPC (backend-foundation Task 14).
- Produces: `fetchNearbyMatches(lat, lng, radiusKm)` from `src/api/matches.ts`, reused by later plans' filters/search screens.

- [ ] **Step 1: Write the failing test for the matches API**

```ts
// mobile/src/api/matches.test.ts
import { supabase } from './supabase';
import { fetchNearbyMatches } from './matches';

jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn() } }));

describe('matches api', () => {
  afterEach(() => jest.clearAllMocks());

  it('calls the nearby_open_matches RPC with the given coordinates and default radius', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: [{ id: 'm1', field_name: 'Campo Test' }], error: null });
    const result = await fetchNearbyMatches(38.1157, 13.3615);
    expect(supabase.rpc).toHaveBeenCalledWith('nearby_open_matches', {
      user_lat: 38.1157,
      user_lng: 13.3615,
      radius_km: 20,
    });
    expect(result).toHaveLength(1);
  });

  it('accepts a custom radius', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: [], error: null });
    await fetchNearbyMatches(38.1157, 13.3615, 5);
    expect(supabase.rpc).toHaveBeenCalledWith('nearby_open_matches', {
      user_lat: 38.1157,
      user_lng: 13.3615,
      radius_km: 5,
    });
  });

  it('throws the Supabase error message on failure', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: { message: 'connection failed' } });
    await expect(fetchNearbyMatches(0, 0)).rejects.toThrow('connection failed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- matches.test`
Expected: FAIL — `Cannot find module './matches'`.

- [ ] **Step 3: Implement the matches API wrapper**

```ts
// mobile/src/api/matches.ts
import { supabase } from './supabase';

export interface NearbyMatch {
  id: string;
  field_name: string;
  match_type: 5 | 7 | 8;
  match_date: string;
  start_time: string;
  end_time: string;
  max_players: number;
  distance_km: number;
  approved_players_count: number;
}

export async function fetchNearbyMatches(lat: number, lng: number, radiusKm = 20): Promise<NearbyMatch[]> {
  const { data, error } = await supabase.rpc('nearby_open_matches', {
    user_lat: lat,
    user_lng: lng,
    radius_km: radiusKm,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as NearbyMatch[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- matches.test`
Expected: 3 passing tests.

- [ ] **Step 5: Write the failing test for the location + data hook**

```ts
// mobile/src/hooks/useNearbyMatches.test.ts
import { renderHook, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { useNearbyMatches } from './useNearbyMatches';
import { fetchNearbyMatches } from '@/api/matches';

jest.mock('expo-location');
jest.mock('@/api/matches', () => ({ fetchNearbyMatches: jest.fn() }));

describe('useNearbyMatches', () => {
  afterEach(() => jest.clearAllMocks());

  it('requests location permission, then fetches matches at the current position', async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
      coords: { latitude: 38.1157, longitude: 13.3615 },
    });
    (fetchNearbyMatches as jest.Mock).mockResolvedValue([{ id: 'm1' }]);

    // @testing-library/react-native@14's renderHook returns a Promise -- await it.
    const { result } = await renderHook(() => useNearbyMatches());

    await waitFor(() => expect(result.current.matches).toHaveLength(1));
    expect(fetchNearbyMatches).toHaveBeenCalledWith(38.1157, 13.3615, 20);
    expect(result.current.permissionDenied).toBe(false);
  });

  it('sets permissionDenied and does not fetch when permission is refused', async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });

    // @testing-library/react-native@14's renderHook returns a Promise -- await it.
    const { result } = await renderHook(() => useNearbyMatches());

    await waitFor(() => expect(result.current.permissionDenied).toBe(true));
    expect(fetchNearbyMatches).not.toHaveBeenCalled();
  });

  it('exposes an error when fetching matches fails', async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
      coords: { latitude: 38.1157, longitude: 13.3615 },
    });
    (fetchNearbyMatches as jest.Mock).mockRejectedValue(new Error('boom'));

    // @testing-library/react-native@14's renderHook returns a Promise -- await it.
    const { result } = await renderHook(() => useNearbyMatches());

    await waitFor(() => expect(result.current.error).toBe('boom'));
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd mobile && npm test -- useNearbyMatches`
Expected: FAIL — `Cannot find module './useNearbyMatches'`.

- [ ] **Step 7: Implement the hook**

```ts
// mobile/src/hooks/useNearbyMatches.ts
import { useCallback, useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { fetchNearbyMatches, type NearbyMatch } from '@/api/matches';

export function useNearbyMatches(radiusKm = 20) {
  const [matches, setMatches] = useState<NearbyMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPermissionDenied(false);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setPermissionDenied(true);
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      const results = await fetchNearbyMatches(position.coords.latitude, position.coords.longitude, radiusKm);
      setMatches(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile caricare le partite.');
    } finally {
      setLoading(false);
    }
  }, [radiusKm]);

  useEffect(() => {
    load();
  }, [load]);

  return { matches, loading, error, permissionDenied, refresh: load };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd mobile && npm test -- useNearbyMatches`
Expected: 3 passing tests.

- [ ] **Step 9: Build the match card and Home screen**

```tsx
// mobile/src/components/MatchCard.tsx
import { View, Text, StyleSheet } from 'react-native';
import type { NearbyMatch } from '@/api/matches';

export function MatchCard({ match }: { match: NearbyMatch }) {
  const spotsLeft = match.max_players - match.approved_players_count;
  return (
    <View style={styles.card}>
      <Text style={styles.fieldName}>{match.field_name}</Text>
      <Text style={styles.meta}>📍 {match.distance_km.toFixed(1)} km · ⚽ Calcio a {match.match_type}</Text>
      <Text style={styles.meta}>{match.start_time.slice(0, 5)} → {match.end_time.slice(0, 5)}</Text>
      <Text style={styles.spots}>
        {match.approved_players_count}/{match.max_players} giocatori · {spotsLeft} post{spotsLeft === 1 ? 'o' : 'i'} disponibil{spotsLeft === 1 ? 'e' : 'i'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 12, padding: 16, gap: 4, marginBottom: 12 },
  fieldName: { fontSize: 18, fontWeight: '700' },
  meta: { color: '#444' },
  spots: { color: '#1a7f37', fontWeight: '600', marginTop: 4 },
});
```

```tsx
// mobile/app/(tabs)/home/index.tsx
import { View, Text, FlatList, ActivityIndicator, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { useNearbyMatches } from '@/hooks/useNearbyMatches';
import { MatchCard } from '@/components/MatchCard';

export default function HomeScreen() {
  const { matches, loading, error, permissionDenied, refresh } = useNearbyMatches();

  if (permissionDenied) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Attiva la posizione</Text>
        <Text style={styles.subtitle}>Per trovare le partite vicino a te abbiamo bisogno della tua posizione.</Text>
        <Pressable style={styles.button} onPress={refresh}>
          <Text style={styles.buttonText}>Riprova</Text>
        </Pressable>
      </View>
    );
  }

  if (loading && matches.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error}</Text>
        <Pressable style={styles.button} onPress={refresh}>
          <Text style={styles.buttonText}>Riprova</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Partite vicino a te</Text>
      <FlatList
        data={matches}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <MatchCard match={item} />}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
        ListEmptyComponent={<Text style={styles.subtitle}>Nessuna partita trovata nella tua zona.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 16 },
  header: { fontSize: 22, fontWeight: '700', paddingHorizontal: 16, marginBottom: 12 },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  subtitle: { color: '#666', textAlign: 'center' },
  error: { color: '#c0392b', textAlign: 'center' },
  button: { backgroundColor: '#1a7f37', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 20, marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '600' },
});
```

- [ ] **Step 10: Run full test suite and typecheck**

Run: `cd mobile && npm test && npm run typecheck`
Expected: all passing, no type errors.

- [ ] **Step 11: Commit**

```bash
cd "/Users/giovanni/Desktop/app calcio"
git add mobile/src/api/matches.ts mobile/src/api/matches.test.ts mobile/src/hooks/useNearbyMatches.ts mobile/src/hooks/useNearbyMatches.test.ts mobile/src/components/MatchCard.tsx "mobile/app/(tabs)/home"
git commit -m "feat: add Home screen with GPS-based nearby matches list"
```

---

### Task 8: Profile screen

**Files:**
- Create: `mobile/app/(tabs)/profile/index.tsx`

**Interfaces:**
- Consumes: `useSessionStore` (Task 3) for the already-loaded profile — no new fetch needed, since the profile is already in the store by the time this screen is reachable (`status === 'signed-in'` per Task 3/6).

- [ ] **Step 1: Build the profile screen**

```tsx
// mobile/app/(tabs)/profile/index.tsx
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useSessionStore } from '@/stores/sessionStore';
import { supabase } from '@/api/supabase';

const FOOT_LABELS: Record<string, string> = { left: 'Sinistro', right: 'Destro', both: 'Entrambi' };
const ROLE_LABELS: Record<string, string> = { player: 'Giocatore', goalkeeper: 'Portiere', both: 'Entrambi' };

function calculateAge(birthDate: string): number {
  const birth = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

export default function ProfileScreen() {
  const profile = useSessionStore((s) => s.profile);

  if (!profile) return null; // unreachable in practice: this screen is only mounted once status === 'signed-in'

  return (
    <View style={styles.container}>
      <View style={styles.avatarPlaceholder}>
        <Text style={styles.avatarInitial}>{profile.first_name.charAt(0)}</Text>
      </View>
      <Text style={styles.name}>{profile.first_name} {profile.last_name}</Text>
      <Text style={styles.uniqueId}>{profile.unique_user_id}</Text>

      <View style={styles.statsRow}>
        <Stat label="Età" value={String(calculateAge(profile.birth_date))} />
        <Stat label="Altezza" value={`${profile.height_cm} cm`} />
        <Stat label="Piede" value={FOOT_LABELS[profile.preferred_foot]} />
      </View>
      <View style={styles.statsRow}>
        <Stat label="Ruolo" value={ROLE_LABELS[profile.player_role]} />
        <Stat label="Giocate" value={String(profile.matches_played_count)} />
        <Stat label="Completate" value={String(profile.matches_completed_count)} />
      </View>

      <Pressable style={styles.logoutButton} onPress={() => supabase.auth.signOut()}>
        <Text style={styles.logoutText}>Esci</Text>
      </Pressable>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', padding: 24, paddingTop: 48 },
  avatarPlaceholder: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#1a7f37', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarInitial: { color: '#fff', fontSize: 36, fontWeight: '700' },
  name: { fontSize: 22, fontWeight: '700' },
  uniqueId: { color: '#666', marginBottom: 24 },
  statsRow: { flexDirection: 'row', gap: 24, marginBottom: 16 },
  stat: { alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '700' },
  statLabel: { color: '#666', fontSize: 12 },
  logoutButton: { marginTop: 32, borderWidth: 1, borderColor: '#c0392b', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 24 },
  logoutText: { color: '#c0392b', fontWeight: '600' },
});
```

- [ ] **Step 2: Run full test suite and typecheck**

Run: `cd mobile && npm test && npm run typecheck`
Expected: all passing, no type errors.

- [ ] **Step 3: Commit**

```bash
cd "/Users/giovanni/Desktop/app calcio"
git add "mobile/app/(tabs)/profile"
git commit -m "feat: add profile screen showing the signed-in user's own data"
```

---

### Task 9: End-to-end manual verification in the iOS Simulator

**Files:** none (verification only).

**Interfaces:** none — this task exercises every interface produced by Tasks 1-8 together, against the real local Supabase backend.

- [ ] **Step 1: Confirm the backend is up**

Run: `cd "/Users/giovanni/Desktop/app calcio" && supabase status`
Expected: all services running. If not, `supabase start`.

- [ ] **Step 2: Boot the Expo dev server and open it in the iOS Simulator**

Use the iOS Simulator tool (`attach` first so the panel is visible, then `launch`/build via Expo's own tooling: `cd mobile && npx expo run:ios`, or `npx expo start` and press `i`).

- [ ] **Step 3: Walk the registration flow with the local test phone number**

Using the number configured in Task 2's Step 7 (`+39 0000000001`, test OTP `123456`):
1. Tap "Non hai un account? Registrati" from the login screen.
2. Enter the test phone number, submit.
3. Enter `123456` on the OTP screen, submit.
4. Set a password (8+ characters), submit.
5. Fill in the profile form (name, birth date `1990-01-01`, height, foot, role), submit.

Expected: lands on the Home tab with the bottom navigation showing all 5 tabs.

- [ ] **Step 4: Verify the profile screen**

Tap the Profilo tab. Expected: shows the just-entered name, the generated `FC-XXXXXX` unique ID, correct age computed from the birth date, and the stats row (all zero).

- [ ] **Step 5: Verify Home shows real data**

Using the Supabase CLI or `supabase db query --local`, insert a test match near the simulator's default location (Apple's simulator defaults to a fixed San Francisco-area location unless changed — set a custom location via the Simulator's Features → Location menu to Palermo-area coordinates, e.g. `38.1157, 13.3615`, first). Confirm the inserted match appears on the Home tab with the correct distance, type, and player count.

- [ ] **Step 6: Verify sign-out and session restore**

Tap "Esci" on the profile screen — expect to land back on the login screen. Force-quit and relaunch the app, log back in with the phone+password from Step 3 — expect to land directly on Home (not create-profile), confirming Task 6's session-restore fix works.

- [ ] **Step 7: Record the outcome**

If every check in Steps 3-6 passes, this task (and the plan) is complete. If anything fails, treat it as a normal bug: fix the specific hook/screen/API wrapper responsible, re-run the affected Jest tests, and repeat this task's manual walkthrough from the failing step.

---

## What this plan does not cover (by design)

- Match creation, the match room (participants, approval requests, chat), friends/people search, private messages, and settings screens — spec-covered, each becomes its own follow-up plan once this foundation is in place.
- A real SMS provider (Twilio or similar) — the app is fully testable locally via the test-OTP bypass (Task 2), but real phone numbers won't receive an OTP until the user configures a provider in the Supabase dashboard themselves.
- Google Maps Platform integration (map view, address autocomplete) — Home shows a plain list sorted by distance for this MVP slice; the spec's map-based creation flow is part of the match-creation follow-up plan.
- Push notification registration (`user_push_tokens`) — needs a real Expo push token from a physical device or properly provisioned simulator push capability; deferred to whichever follow-up plan first needs to *display* a notification-driven flow.
- E2E test automation (Detox/Maestro) — this plan relies on Jest unit/hook tests plus the manual simulator walkthrough in Task 9; full E2E scripting is worth its own investment once there are enough screens to make it pay off.
