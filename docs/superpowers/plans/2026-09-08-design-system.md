# App-Calcio Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce shared color/typography/spacing tokens (`mobile/src/theme/`) and retrofit every screen and shared component in the app to use them, replacing 23 files' worth of independently-hardcoded hex literals and default-font text with one coherent, versioned design system.

**Architecture:** A new `mobile/src/theme/` module (`colors.ts`, `typography.ts`, `spacing.ts`, `index.ts`) is the single source of truth. Two Google Font families (`Sora`, `Work Sans`) load via `@expo-google-fonts/*` packages and `expo-font`'s `useFonts` in the root layout. Every other task is a mechanical migration: replace each screen's/component's hardcoded values with the matching token, add `hitSlop` to small tap targets, and add press-state feedback to solid-fill buttons. No JSX structure, layout, navigation, or business logic changes anywhere in this plan.

**Tech Stack:** Expo Router, React Native, `@expo-google-fonts/sora`, `@expo-google-fonts/work-sans`, `expo-font`, `expo-splash-screen`.

**Spec:** [docs/superpowers/specs/2026-09-08-design-system-design.md](../specs/2026-09-08-design-system-design.md)

## Global Constraints

- Exact color tokens (from the spec, §3.1): `primary #1B7A4A`, `onPrimary #FFFFFF`, `background #F7F8F3`, `surface #FFFFFF`, `border #E1E5DA`, `ink #16211B`, `muted #66756C`, `accent #E2A63B`, `accentBg #FBF1DD`, `accentText #8A5A12`, `danger #C23B2E`, `dangerBg #FBEAE7`.
- **Ruling — one token added beyond the spec, found while planning:** `primaryTint #EAF3EC`, a light wash of `primary`. The spec's `accentBg`/`dangerBg` pattern covers "available" and "error" tints, but `home/notifications.tsx`'s existing unread-row highlight (`#f0f8f2`, a light green wash unrelated to `accent`'s "availability" meaning) has no matching token in the spec. Adding one `{role}Tint` token for this exact "unread/highlighted, tied to primary" role is consistent with the spec's own `{role}Bg` pattern, not a new invention. Used in exactly one place (Task 4).
- **Ruling — neutral/cancel buttons:** `friend-requests.tsx`'s "Annulla" button (background `#888`, a neutral gray, neither primary nor danger) has no dedicated token in the spec. Rather than invent a new role for one button, it maps to `colors.muted` background + `colors.surface` (white) text — reasonable given `muted` is already the app's one neutral-gray token.
- Exact typography tokens (spec §3.2), as `mobile/src/theme/typography.ts` exports — each a plain object spreadable into a `Text` style: `screenTitle` (`Sora_700Bold`, 22), `authTitle` (`Sora_700Bold`, 27), `label` (`Sora_600SemiBold`, 15), `body` (`WorkSans_400Regular`, 15), `meta` (`WorkSans_400Regular`, 12.5), `caption` (`WorkSans_500Medium`, 10.5). No `fontWeight` alongside `fontFamily` — each Google Font weight is its own family name; a separate `fontWeight` is redundant and can conflict on some platforms.
- Exact spacing/radius tokens (spec §3.3): `radiusCard 14`, `radiusControl 10`, `radiusPill 20`, `spaceXs 6`, `spaceSm 12`, `spaceMd 16`, `spaceLg 24`.
- **hitSlop scope (spec §5.1):** every icon-only Pressable (the Home notification bell) and every plain-text "← Torna..." / "← Annulla" back-link Pressable gets `hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}` — these render as a single line of text with little to no padding, well under the 44×44pt guideline.
- **Press-feedback scope, refined during planning (spec §5.2):** the spec said "every Pressable"; having now read all 23 files, that is ~60 call sites across every screen, most of them plain text links where a solid-fill button's opacity change would be the meaningful signal. **Ruling:** apply press-state feedback only to solid-fill buttons (any Pressable whose style sets `backgroundColor` to `primary`, `danger`, or `muted`) via `mobile/src/theme/pressedStyle.ts`'s `withPressed` helper (Task 1). Plain text links (back links, "Annulla", "Segnala", "Blocca") are not touched — they already have `hitSlop` where they qualify above, and a solid button's opacity feedback is the higher-value signal for the effort. This is a scope reduction from the spec, made explicit here rather than silently applied task-by-task.
- **`accent`/`accentBg`/`accentText`/`dangerBg` are defined in Task 1 but consumed by no task in this plan.** The spec's mockups showed them on a "posti liberi" pill-shaped badge on match cards — a JSX element that does not exist in `MatchCard.tsx` today (it currently renders that same information as plain text, no badge). Adding that badge would be a JSX/layout change, which §1 of the spec and this plan both explicitly exclude ("screens keep their own JSX structure"). These four tokens are intentionally defined now, for a small, focused follow-up plan to introduce that badge later — not a gap in this plan's execution.
- No new automated tests are written in this plan — every task is a styling-only change with no new logic branch to cover. Each task's acceptance is: `tsc --noEmit` clean, the existing 202-test Jest suite still green, and the touched file's `StyleSheet.create` block contains no raw hex string and no un-tokenized `fontSize`/`fontWeight` on a `Text`-bearing style (the task reviewer checks this directly against the diff).
- Every task's commit message ends with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

### Task 1: Theme foundation and font loading

**Files:**
- Create: `mobile/src/theme/colors.ts`
- Create: `mobile/src/theme/typography.ts`
- Create: `mobile/src/theme/spacing.ts`
- Create: `mobile/src/theme/pressedStyle.ts`
- Create: `mobile/src/theme/index.ts`
- Modify: `mobile/app/_layout.tsx`
- Modify: `mobile/package.json` (new dependencies)

**Interfaces:**
- Produces: `colors`, `typography`, `spacing` objects and `withPressed(baseStyle, pressedStyle?)` helper, all importable as `import { colors, typography, spacing, withPressed } from '@/theme'`. Every later task consumes these exact names.

- [ ] **Step 1: Install the font packages**

```bash
cd mobile
npx expo install @expo-google-fonts/sora @expo-google-fonts/work-sans expo-font expo-splash-screen
```

(`expo-font` and `expo-splash-screen` may already be present as transitive deps of the Expo SDK — `expo install` is idempotent and will no-op if so.)

- [ ] **Step 2: Write `colors.ts`**

```ts
// mobile/src/theme/colors.ts
export const colors = {
  primary: '#1B7A4A',
  onPrimary: '#FFFFFF',
  primaryTint: '#EAF3EC',
  background: '#F7F8F3',
  surface: '#FFFFFF',
  border: '#E1E5DA',
  ink: '#16211B',
  muted: '#66756C',
  accent: '#E2A63B',
  accentBg: '#FBF1DD',
  accentText: '#8A5A12',
  danger: '#C23B2E',
  dangerBg: '#FBEAE7',
} as const;
```

- [ ] **Step 3: Write `typography.ts`**

```ts
// mobile/src/theme/typography.ts
export const typography = {
  screenTitle: { fontFamily: 'Sora_700Bold', fontSize: 22 },
  authTitle: { fontFamily: 'Sora_700Bold', fontSize: 27 },
  label: { fontFamily: 'Sora_600SemiBold', fontSize: 15 },
  body: { fontFamily: 'WorkSans_400Regular', fontSize: 15 },
  meta: { fontFamily: 'WorkSans_400Regular', fontSize: 12.5 },
  caption: { fontFamily: 'WorkSans_500Medium', fontSize: 10.5 },
} as const;
```

- [ ] **Step 4: Write `spacing.ts`**

```ts
// mobile/src/theme/spacing.ts
export const spacing = {
  radiusCard: 14,
  radiusControl: 10,
  radiusPill: 20,
  spaceXs: 6,
  spaceSm: 12,
  spaceMd: 16,
  spaceLg: 24,
} as const;
```

- [ ] **Step 5: Write `pressedStyle.ts`**

```ts
// mobile/src/theme/pressedStyle.ts
import type { StyleProp, ViewStyle } from 'react-native';

// Used as: style={withPressed(styles.button)} on any solid-fill Pressable
// (backgroundColor: primary/danger/muted). Returns a style FUNCTION, matching
// Pressable's own `style={({ pressed }) => ...}` signature -- a plain style
// object cannot react to press state at all.
export function withPressed(baseStyle: StyleProp<ViewStyle>) {
  return ({ pressed }: { pressed: boolean }): StyleProp<ViewStyle> => [
    baseStyle,
    pressed && { opacity: 0.7 },
  ];
}
```

- [ ] **Step 6: Write `index.ts`**

```ts
// mobile/src/theme/index.ts
export { colors } from './colors';
export { typography } from './typography';
export { spacing } from './spacing';
export { withPressed } from './pressedStyle';
```

- [ ] **Step 7: Wire font loading into the root layout**

`mobile/app/_layout.tsx` currently has one loading gate (`status === 'loading'`, the auth bootstrap). Add a second, independent gate for fonts, and combine both into a single loading check so neither flashes before the other resolves.

Replace:
```tsx
import { useEffect } from 'react';
import { Slot, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { supabase } from '@/api/supabase';
import { useSessionStore } from '@/stores/sessionStore';
import { useProfileBootstrap } from '@/hooks/useProfileBootstrap';

export default function RootLayout() {
  const { session, status, setSession } = useSessionStore();
```

with:
```tsx
import { useCallback, useEffect } from 'react';
import { Slot, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts, Sora_600SemiBold, Sora_700Bold } from '@expo-google-fonts/sora';
import { WorkSans_400Regular, WorkSans_500Medium, WorkSans_600SemiBold } from '@expo-google-fonts/work-sans';
import { supabase } from '@/api/supabase';
import { useSessionStore } from '@/stores/sessionStore';
import { useProfileBootstrap } from '@/hooks/useProfileBootstrap';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { session, status, setSession } = useSessionStore();
  const [fontsLoaded] = useFonts({
    Sora_600SemiBold,
    Sora_700Bold,
    WorkSans_400Regular,
    WorkSans_500Medium,
    WorkSans_600SemiBold,
  });
  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded && status !== 'loading') await SplashScreen.hideAsync();
  }, [fontsLoaded, status]);
```

Then, near the end of the component, replace:
```tsx
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

with:
```tsx
  if (status === 'loading' || !fontsLoaded) {
    return (
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        onLayout={onLayoutRootView}
      >
        <ActivityIndicator />
      </View>
    );
  }

  return <Slot onLayout={onLayoutRootView} />;
}
```

- [ ] **Step 8: Run typecheck**

Run: `cd mobile && npm run typecheck`
Expected: clean.

- [ ] **Step 9: Run the full test suite**

Run: `cd mobile && npm test`
Expected: 202/202 passing, unchanged (this task touches no tested logic).

- [ ] **Step 10: Commit**

```bash
cd mobile
git add package.json package-lock.json src/theme app/_layout.tsx
git commit -m "$(cat <<'EOF'
feat: add design system theme foundation and font loading

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Retrofit the auth screens

**Files:**
- Modify: `mobile/app/(auth)/login.tsx`
- Modify: `mobile/app/(auth)/register-phone.tsx`
- Modify: `mobile/app/(auth)/verify-otp.tsx`
- Modify: `mobile/app/(auth)/create-password.tsx`
- Modify: `mobile/app/(auth)/create-profile.tsx`

**Interfaces:**
- Consumes: `colors`, `typography`, `spacing`, `withPressed` from `@/theme` (Task 1).

`login.tsx`, `register-phone.tsx`, `verify-otp.tsx`, and `create-password.tsx` share an almost byte-identical `StyleSheet.create` block today (`container`/`title`/`input`/`button`/`buttonText`/`error`, same values in all four). All four get the same replacement block below, plus each file's one or two unique keys (`subtitle` in `register-phone.tsx`).

- [ ] **Step 1: Update `login.tsx`**

Add the import (alongside the existing `useLogin` import):
```tsx
import { colors, typography, spacing } from '@/theme';
```

Replace the `button` and `buttonText` usage's `<ActivityIndicator color="#fff" />` with `<ActivityIndicator color={colors.onPrimary} />` (same substitution in every file below, not repeated per-file after this point).

Replace the entire `const styles = StyleSheet.create({...})` block with:
```tsx
const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.spaceLg, gap: spacing.spaceSm },
  title: { ...typography.authTitle, marginBottom: spacing.spaceSm },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusControl, padding: spacing.spaceSm, ...typography.body },
  button: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, padding: 14, alignItems: 'center', marginTop: spacing.spaceXs },
  buttonText: { color: colors.onPrimary, ...typography.label },
  error: { color: colors.danger },
  link: { textAlign: 'center', marginTop: spacing.spaceMd, color: colors.primary },
});
```

- [ ] **Step 2: Update `register-phone.tsx`**

Add the same theme import. Replace its `StyleSheet.create` block with:
```tsx
const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.spaceLg, gap: spacing.spaceSm },
  title: typography.authTitle,
  subtitle: { color: colors.muted, marginBottom: spacing.spaceSm, ...typography.body },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusControl, padding: spacing.spaceSm, ...typography.body },
  button: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, padding: 14, alignItems: 'center', marginTop: spacing.spaceXs },
  buttonText: { color: colors.onPrimary, ...typography.label },
  error: { color: colors.danger },
});
```

- [ ] **Step 3: Update `verify-otp.tsx`**

Add the same theme import. Replace its `StyleSheet.create` block with:
```tsx
const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.spaceLg, gap: spacing.spaceSm },
  title: { ...typography.authTitle, marginBottom: spacing.spaceSm },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusControl, padding: spacing.spaceSm, fontFamily: 'WorkSans_400Regular', fontSize: 24, textAlign: 'center', letterSpacing: 8 },
  button: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, padding: 14, alignItems: 'center', marginTop: spacing.spaceXs },
  buttonText: { color: colors.onPrimary, ...typography.label },
  error: { color: colors.danger },
});
```
(The 6-digit input keeps its own large 24px size — it's a distinct, deliberately oversized OTP field, not the app's standard `body` text size — but now uses the Work Sans family instead of the platform default.)

- [ ] **Step 4: Update `create-password.tsx`**

Add the same theme import. Replace its `StyleSheet.create` block with the exact same block as `login.tsx`'s in Step 1, minus the `link` key (this screen has no link):
```tsx
const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.spaceLg, gap: spacing.spaceSm },
  title: { ...typography.authTitle, marginBottom: spacing.spaceSm },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusControl, padding: spacing.spaceSm, ...typography.body },
  button: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, padding: 14, alignItems: 'center', marginTop: spacing.spaceXs },
  buttonText: { color: colors.onPrimary, ...typography.label },
  error: { color: colors.danger },
});
```

- [ ] **Step 5: Update `create-profile.tsx`**

Add the same theme import. Replace its `StyleSheet.create` block:
```tsx
const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1 },
  title: { ...typography.authTitle, paddingHorizontal: spacing.spaceLg },
});
```

- [ ] **Step 6: Run typecheck**

Run: `cd mobile && npm run typecheck`
Expected: clean.

- [ ] **Step 7: Run the full test suite**

Run: `cd mobile && npm test`
Expected: 202/202 passing.

- [ ] **Step 8: Commit**

```bash
cd mobile
git add "app/(auth)"
git commit -m "$(cat <<'EOF'
style: apply design system tokens to the auth screens

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Retrofit Home — index and create-match

**Files:**
- Modify: `mobile/app/(tabs)/home/index.tsx`
- Modify: `mobile/app/(tabs)/home/create-match.tsx`

**Interfaces:**
- Consumes: `colors`, `typography`, `spacing`, `withPressed` from `@/theme`.

- [ ] **Step 1: Update `home/index.tsx`**

Add the import:
```tsx
import { colors, typography, spacing, withPressed } from '@/theme';
```

Add `hitSlop` to the notification bell (it's icon-only, well under 44×44):
```tsx
<Pressable
  style={styles.bellButton}
  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
  onPress={() => router.push('/(tabs)/home/notifications')}
>
```

Apply press feedback to the two solid `button` Pressables (the "Riprova" retry buttons in the `permissionDenied` and `error` branches) — both currently `<Pressable style={styles.button} onPress={refresh}>`, change both occurrences to:
```tsx
<Pressable style={withPressed(styles.button)} onPress={refresh}>
```

Replace the `StyleSheet.create` block:
```tsx
const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.spaceMd,
    marginBottom: spacing.spaceSm,
  },
  header: typography.screenTitle,
  bellButton: { position: 'relative', padding: 4 },
  bellIcon: { fontSize: 22 },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: colors.danger,
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: colors.onPrimary, ...typography.caption },
  list: { paddingHorizontal: spacing.spaceMd, paddingBottom: spacing.spaceLg },
  centered: { backgroundColor: colors.background, flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.spaceLg, gap: spacing.spaceSm },
  title: { ...typography.label, fontSize: 20, textAlign: 'center' },
  subtitle: { color: colors.muted, textAlign: 'center', ...typography.body },
  error: { color: colors.danger, textAlign: 'center' },
  button: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: 10, paddingHorizontal: 20, marginTop: spacing.spaceXs },
  buttonText: { color: colors.onPrimary, ...typography.label },
});
```

- [ ] **Step 2: Update `home/create-match.tsx`**

Add the same import. Add `hitSlop` to the "← Annulla" back link:
```tsx
<Pressable onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
  <Text style={styles.backLink}>← Annulla</Text>
</Pressable>
```

Apply press feedback to the "Torna indietro" button:
```tsx
<Pressable style={withPressed(styles.button)} onPress={() => router.back()}>
```

Replace the `StyleSheet.create` block:
```tsx
const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, paddingHorizontal: spacing.spaceLg },
  centered: { backgroundColor: colors.background, flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.spaceLg, gap: spacing.spaceSm },
  title: { ...typography.label, fontSize: 24, marginBottom: spacing.spaceXs },
  subtitle: { color: colors.muted, textAlign: 'center', ...typography.body },
  backLink: { color: colors.primary, marginBottom: spacing.spaceXs },
  button: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: 10, paddingHorizontal: 20, marginTop: spacing.spaceXs },
  buttonText: { color: colors.onPrimary, ...typography.label },
});
```

- [ ] **Step 3: Run typecheck**

Run: `cd mobile && npm run typecheck`
Expected: clean.

- [ ] **Step 4: Run the full test suite**

Run: `cd mobile && npm test`
Expected: 202/202 passing.

- [ ] **Step 5: Commit**

```bash
cd mobile
git add "app/(tabs)/home/index.tsx" "app/(tabs)/home/create-match.tsx"
git commit -m "$(cat <<'EOF'
style: apply design system tokens to Home and create-match

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Retrofit Home — notifications

**Files:**
- Modify: `mobile/app/(tabs)/home/notifications.tsx`

**Interfaces:**
- Consumes: `colors`, `typography`, `spacing` from `@/theme`.

- [ ] **Step 1: Update the screen**

Add the import:
```tsx
import { colors, typography, spacing } from '@/theme';
```

Add `hitSlop` to the "← Torna alla Home" back link:
```tsx
<Pressable onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
  <Text style={styles.backLink}>← Torna alla Home</Text>
</Pressable>
```

Replace the `StyleSheet.create` block:
```tsx
const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, paddingHorizontal: spacing.spaceMd },
  centered: { backgroundColor: colors.background, flex: 1, alignItems: 'center', justifyContent: 'center' },
  backLink: { color: colors.primary, marginBottom: spacing.spaceXs },
  header: { ...typography.screenTitle, marginBottom: spacing.spaceSm },
  error: { color: colors.danger, marginBottom: spacing.spaceXs },
  list: { paddingBottom: spacing.spaceLg },
  item: { paddingVertical: spacing.spaceSm, borderBottomWidth: 1, borderBottomColor: colors.border },
  itemUnread: { backgroundColor: colors.primaryTint },
  message: typography.body,
  date: { color: colors.muted, ...typography.caption, marginTop: 4 },
  subtitle: { color: colors.muted, textAlign: 'center', marginTop: spacing.spaceLg, ...typography.body },
});
```

(`colors.primaryTint` is the one token added in this plan's Global Constraints beyond the spec — see the ruling there.)

- [ ] **Step 2: Run typecheck**

Run: `cd mobile && npm run typecheck`
Expected: clean.

- [ ] **Step 3: Run the full test suite**

Run: `cd mobile && npm test`
Expected: 202/202 passing.

- [ ] **Step 4: Commit**

```bash
cd mobile
git add "app/(tabs)/home/notifications.tsx"
git commit -m "$(cat <<'EOF'
style: apply design system tokens to Notifiche

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Retrofit Home — match detail

**Files:**
- Modify: `mobile/app/(tabs)/home/match/[id]/index.tsx`

**Interfaces:**
- Consumes: `colors`, `typography`, `spacing`, `withPressed` from `@/theme`.

This is the largest single screen in the app (12 button-shaped styles). Every `backgroundColor: '#1a7f37'` button below gets `withPressed`; every `backgroundColor: '#c0392b'` (destructive) button also gets `withPressed` per the muted/primary/danger press-feedback scope in Global Constraints.

- [ ] **Step 1: Add the import and hitSlop**

```tsx
import { colors, typography, spacing, withPressed } from '@/theme';
```

Add `hitSlop` to both "← Torna alla Home" back links (one in the `!match` branch, one in the main render):
```tsx
<Pressable onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
```

- [ ] **Step 2: Apply `withPressed` to every solid button**

Change each of these six `<Pressable style={styles.X} ...>` opening tags (leaving every other prop on the tag untouched) to `<Pressable style={withPressed(styles.X)} ...>`: `backButton`, `chatButton`, `editButton`, `deleteButton`, `inviteButton`, `approveButton`, `rejectButton`, `requestButton`, `leaveButton`. (Nine tags total — every button-shaped Pressable in this file.)

- [ ] **Step 3: Replace the `StyleSheet.create` block**

```tsx
const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, paddingHorizontal: spacing.spaceLg, paddingBottom: spacing.spaceLg, gap: spacing.spaceXs },
  centered: { backgroundColor: colors.background, flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.spaceLg, gap: spacing.spaceSm },
  backLink: { color: colors.primary, marginBottom: spacing.spaceXs },
  backButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: 10, paddingHorizontal: 20, marginTop: spacing.spaceXs },
  backButtonText: { color: colors.onPrimary, ...typography.label },
  title: { ...typography.label, fontSize: 24 },
  meta: { color: colors.ink, ...typography.body },
  description: { color: colors.ink, marginTop: spacing.spaceXs, ...typography.body },
  error: { color: colors.danger, textAlign: 'center' },
  chatButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: 12, alignItems: 'center', marginTop: spacing.spaceXs },
  chatButtonText: { color: colors.onPrimary, ...typography.label, fontSize: 16 },
  actions: { marginTop: spacing.spaceLg, gap: spacing.spaceSm },
  editButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, padding: 14, alignItems: 'center' },
  editButtonText: { color: colors.onPrimary, ...typography.label, fontSize: 16 },
  deleteButton: { backgroundColor: colors.danger, borderRadius: spacing.radiusControl, padding: 14, alignItems: 'center' },
  deleteButtonText: { color: colors.onPrimary, ...typography.label, fontSize: 16 },
  inviteButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, padding: 14, alignItems: 'center', marginTop: spacing.spaceSm },
  inviteButtonText: { color: colors.onPrimary, ...typography.label, fontSize: 16 },
  section: { marginTop: spacing.spaceLg, gap: 4 },
  sectionTitle: { ...typography.label, fontSize: 16, marginBottom: 4 },
  requestActions: { flexDirection: 'row', gap: spacing.spaceXs },
  approveButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: spacing.spaceXs, paddingHorizontal: spacing.spaceSm },
  approveButtonText: { color: colors.onPrimary, ...typography.label },
  rejectButton: { backgroundColor: colors.danger, borderRadius: spacing.radiusControl, paddingVertical: spacing.spaceXs, paddingHorizontal: spacing.spaceSm },
  rejectButtonText: { color: colors.onPrimary, ...typography.label },
  requestButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, padding: 14, alignItems: 'center', marginTop: spacing.spaceXs },
  requestButtonText: { color: colors.onPrimary, ...typography.label, fontSize: 16 },
  leaveButton: { backgroundColor: colors.danger, borderRadius: spacing.radiusControl, padding: 14, alignItems: 'center', marginTop: spacing.spaceSm },
  leaveButtonText: { color: colors.onPrimary, ...typography.label, fontSize: 16 },
  statusText: { color: colors.ink, ...typography.body },
  statusTextSuccess: { color: colors.primary, ...typography.label, fontSize: 16 },
});
```

- [ ] **Step 4: Run typecheck**

Run: `cd mobile && npm run typecheck`
Expected: clean.

- [ ] **Step 5: Run the full test suite**

Run: `cd mobile && npm test`
Expected: 202/202 passing.

- [ ] **Step 6: Commit**

```bash
cd mobile
git add "app/(tabs)/home/match/[id]/index.tsx"
git commit -m "$(cat <<'EOF'
style: apply design system tokens to match detail

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Retrofit Home — match chat and invite

**Files:**
- Modify: `mobile/app/(tabs)/home/match/[id]/chat.tsx`
- Modify: `mobile/app/(tabs)/home/match/[id]/invite.tsx`

**Interfaces:**
- Consumes: `colors`, `typography`, `spacing`, `withPressed` from `@/theme`.

- [ ] **Step 1: Update `chat.tsx`**

Add the import:
```tsx
import { colors, typography, spacing, withPressed } from '@/theme';
```

Add `hitSlop` to the "← Torna alla partita" back link. Apply `withPressed` to `retryButton` and `sendButton`.

`timestamp` was a single style shared by both `isOwn` and non-`isOwn` bubbles in the original file — `#ccc` was a compromise gray legible (barely) on both the green `bubbleOwn` and the light-gray `bubbleOther`. Splitting it in two, mirroring the existing `bubbleTextOwn`/`bubbleTextOther` split, reads correctly on each background instead of picking one token that fails contrast on the other. In `MessageBubble`, change:
```tsx
<Text style={styles.timestamp}>{new Date(message.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</Text>
```
to:
```tsx
<Text style={isOwn ? styles.timestampOwn : styles.timestampOther}>{new Date(message.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</Text>
```

Replace the `StyleSheet.create` block:
```tsx
const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, paddingHorizontal: spacing.spaceMd },
  centered: { backgroundColor: colors.background, flex: 1, alignItems: 'center', justifyContent: 'center' },
  backLink: { color: colors.primary, marginBottom: spacing.spaceXs },
  header: { ...typography.screenTitle, marginBottom: spacing.spaceXs },
  error: { color: colors.danger, marginBottom: spacing.spaceXs },
  retryButton: { alignSelf: 'flex-start', backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: spacing.spaceXs, paddingHorizontal: spacing.spaceMd, marginBottom: spacing.spaceXs },
  retryButtonText: { color: colors.onPrimary, ...typography.label },
  messageList: { paddingVertical: spacing.spaceXs, gap: spacing.spaceXs },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowOwn: { justifyContent: 'flex-end' },
  bubbleRowOther: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', borderRadius: spacing.radiusCard, paddingHorizontal: spacing.spaceSm, paddingVertical: spacing.spaceXs },
  bubbleOwn: { backgroundColor: colors.primary },
  bubbleOther: { backgroundColor: colors.border },
  senderName: { ...typography.caption, color: colors.muted, marginBottom: 2 },
  bubbleTextOwn: { color: colors.onPrimary, ...typography.body },
  bubbleTextOther: { color: colors.ink, ...typography.body },
  timestampOwn: { fontSize: 10, color: colors.primaryTint, marginTop: 4, alignSelf: 'flex-end' },
  timestampOther: { fontSize: 10, color: colors.muted, marginTop: 4, alignSelf: 'flex-end' },
  mentionList: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusControl, marginBottom: 4, maxHeight: 160 },
  mentionItem: { paddingVertical: spacing.spaceXs, paddingHorizontal: spacing.spaceSm, borderBottomWidth: 1, borderBottomColor: colors.border },
  mentionItemText: typography.body,
  inputRow: { flexDirection: 'row', gap: spacing.spaceXs, paddingVertical: spacing.spaceXs, alignItems: 'flex-end' },
  input: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusPill, paddingHorizontal: spacing.spaceMd, paddingVertical: 10, maxHeight: 100, ...typography.body },
  sendButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusPill, paddingHorizontal: spacing.spaceMd, paddingVertical: 10, justifyContent: 'center' },
  sendButtonText: { color: colors.onPrimary, ...typography.label },
});
```

- [ ] **Step 2: Update `invite.tsx`**

Add the same import. Apply `withPressed` to `inviteButton`.

Replace the `StyleSheet.create` block:
```tsx
const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, paddingHorizontal: spacing.spaceMd },
  centered: { backgroundColor: colors.background, flex: 1, alignItems: 'center', justifyContent: 'center' },
  backLink: { color: colors.primary, marginBottom: spacing.spaceXs },
  header: { ...typography.screenTitle, marginBottom: spacing.spaceSm },
  error: { color: colors.danger, marginBottom: spacing.spaceXs },
  subtitle: { color: colors.muted, textAlign: 'center', marginTop: spacing.spaceLg, ...typography.body },
  list: { paddingBottom: spacing.spaceLg },
  friendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.spaceSm, borderBottomWidth: 1, borderBottomColor: colors.border },
  friendName: typography.label,
  inviteButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: spacing.spaceXs, paddingHorizontal: spacing.spaceMd, minWidth: 80, alignItems: 'center' },
  inviteButtonText: { color: colors.onPrimary, ...typography.label },
});
```

- [ ] **Step 3: Run typecheck**

Run: `cd mobile && npm run typecheck`
Expected: clean.

- [ ] **Step 4: Run the full test suite**

Run: `cd mobile && npm test`
Expected: 202/202 passing.

- [ ] **Step 5: Commit**

```bash
cd mobile
git add "app/(tabs)/home/match/[id]/chat.tsx" "app/(tabs)/home/match/[id]/invite.tsx"
git commit -m "$(cat <<'EOF'
style: apply design system tokens to match chat and invite

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Retrofit Le mie partite

**Files:**
- Modify: `mobile/app/(tabs)/my-matches/index.tsx`

**Interfaces:**
- Consumes: `colors`, `typography`, `spacing`, `withPressed` from `@/theme`.

- [ ] **Step 1: Update the screen**

Add the import:
```tsx
import { colors, typography, spacing, withPressed } from '@/theme';
```

Apply `withPressed` to `createButton`.

Replace the `StyleSheet.create` block:
```tsx
const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, paddingHorizontal: spacing.spaceMd },
  centered: { backgroundColor: colors.background, flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.spaceSm },
  header: typography.screenTitle,
  createButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: spacing.spaceXs, paddingHorizontal: spacing.spaceMd },
  createButtonText: { color: colors.onPrimary, ...typography.label },
  error: { color: colors.danger, marginBottom: spacing.spaceXs },
  sectionTitle: { ...typography.label, fontSize: 16, marginTop: spacing.spaceMd, marginBottom: spacing.spaceXs },
  row: { paddingVertical: spacing.spaceSm, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowTitle: typography.label,
  rowMeta: { color: colors.muted, ...typography.meta, marginTop: 2 },
  rowStatus: { color: colors.primary, ...typography.meta, fontFamily: 'WorkSans_600SemiBold', marginTop: 2 },
  list: { paddingBottom: spacing.spaceLg },
  subtitle: { color: colors.muted, textAlign: 'center', marginTop: spacing.spaceLg, ...typography.body },
});
```

- [ ] **Step 2: Run typecheck**

Run: `cd mobile && npm run typecheck`
Expected: clean.

- [ ] **Step 3: Run the full test suite**

Run: `cd mobile && npm test`
Expected: 202/202 passing.

- [ ] **Step 4: Commit**

```bash
cd mobile
git add "app/(tabs)/my-matches/index.tsx"
git commit -m "$(cat <<'EOF'
style: apply design system tokens to Le mie partite

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Retrofit Persone — search and friend requests

**Files:**
- Modify: `mobile/app/(tabs)/people/index.tsx`
- Modify: `mobile/app/(tabs)/people/friend-requests.tsx`

**Interfaces:**
- Consumes: `colors`, `typography`, `spacing`, `withPressed` from `@/theme`.

- [ ] **Step 1: Update `people/index.tsx`**

Add the import:
```tsx
import { colors, typography, spacing, withPressed } from '@/theme';
```

Apply `withPressed` to `searchButton`.

Replace the `StyleSheet.create` block:
```tsx
const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, paddingHorizontal: spacing.spaceMd },
  header: { ...typography.screenTitle, marginBottom: spacing.spaceSm },
  searchRow: { flexDirection: 'row', gap: spacing.spaceXs, marginBottom: spacing.spaceXs },
  searchInput: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusControl, paddingHorizontal: spacing.spaceSm, paddingVertical: 10, ...typography.body },
  searchButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingHorizontal: spacing.spaceMd, justifyContent: 'center' },
  searchButtonText: { color: colors.onPrimary, ...typography.label },
  error: { color: colors.danger, marginBottom: spacing.spaceXs },
  subtitle: { color: colors.muted, marginBottom: spacing.spaceXs, ...typography.body },
  resultCard: { borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusControl, padding: spacing.spaceSm, marginBottom: spacing.spaceMd },
  resultName: typography.label,
  resultCode: { color: colors.muted, ...typography.meta },
  resultLink: { color: colors.primary, marginTop: 4, fontFamily: 'WorkSans_600SemiBold', fontSize: 15 },
  requestsLink: { paddingVertical: spacing.spaceXs, marginBottom: spacing.spaceXs },
  requestsLinkText: { color: colors.primary, fontFamily: 'WorkSans_600SemiBold', fontSize: 15 },
  sectionTitle: { ...typography.label, fontSize: 18 },
  list: { paddingBottom: spacing.spaceLg },
  friendRow: { paddingVertical: spacing.spaceSm, borderBottomWidth: 1, borderBottomColor: colors.border },
  friendName: typography.label,
  friendCode: { color: colors.muted, ...typography.meta, marginTop: 2 },
});
```

- [ ] **Step 2: Update `friend-requests.tsx`**

Add the same import. Add `hitSlop` to the "← Torna a Persone" back link. Apply `withPressed` to `acceptButton`, `rejectButton`, and `cancelButton`.

Replace the `StyleSheet.create` block:
```tsx
const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, paddingHorizontal: spacing.spaceMd },
  backLink: { color: colors.primary, marginBottom: spacing.spaceXs },
  header: { ...typography.screenTitle, marginBottom: spacing.spaceSm },
  error: { color: colors.danger, marginBottom: spacing.spaceXs },
  subtitle: { color: colors.muted, marginBottom: spacing.spaceMd, ...typography.body },
  sectionTitle: { ...typography.label, fontSize: 18, marginTop: spacing.spaceXs, marginBottom: spacing.spaceXs },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.spaceSm, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowInfo: { flex: 1 },
  rowName: typography.label,
  rowCode: { color: colors.muted, ...typography.meta, marginTop: 2 },
  rowActions: { flexDirection: 'row', gap: spacing.spaceXs },
  acceptButton: { backgroundColor: colors.primary, borderRadius: 6, paddingVertical: 6, paddingHorizontal: spacing.spaceSm },
  acceptButtonText: { color: colors.onPrimary, fontFamily: 'WorkSans_600SemiBold', fontSize: 13 },
  rejectButton: { backgroundColor: colors.danger, borderRadius: 6, paddingVertical: 6, paddingHorizontal: spacing.spaceSm },
  rejectButtonText: { color: colors.onPrimary, fontFamily: 'WorkSans_600SemiBold', fontSize: 13 },
  cancelButton: { backgroundColor: colors.muted, borderRadius: 6, paddingVertical: 6, paddingHorizontal: spacing.spaceSm },
  cancelButtonText: { color: colors.surface, fontFamily: 'WorkSans_600SemiBold', fontSize: 13 },
});
```

- [ ] **Step 3: Run typecheck**

Run: `cd mobile && npm run typecheck`
Expected: clean.

- [ ] **Step 4: Run the full test suite**

Run: `cd mobile && npm test`
Expected: 202/202 passing.

- [ ] **Step 5: Commit**

```bash
cd mobile
git add "app/(tabs)/people/index.tsx" "app/(tabs)/people/friend-requests.tsx"
git commit -m "$(cat <<'EOF'
style: apply design system tokens to Persone and friend requests

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Retrofit Persone — friend profile

**Files:**
- Modify: `mobile/app/(tabs)/people/user/[id].tsx`

**Interfaces:**
- Consumes: `colors`, `typography`, `spacing`, `withPressed` from `@/theme`.

- [ ] **Step 1: Update the screen**

Add the import:
```tsx
import { colors, typography, spacing, withPressed } from '@/theme';
```

Add `hitSlop` to both "← Torna indietro" back links. Apply `withPressed` to `backButton`, `messageButton`, `primaryButton`, and `secondaryButton` (the `disabledButton` View is not a `Pressable` and is untouched).

Replace the `StyleSheet.create` block:
```tsx
const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flexGrow: 1, alignItems: 'center', padding: spacing.spaceLg },
  centered: { backgroundColor: colors.background, flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.spaceLg, gap: spacing.spaceSm },
  backLink: { color: colors.primary, alignSelf: 'flex-start', marginBottom: spacing.spaceMd },
  backButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: 10, paddingHorizontal: 20, marginTop: spacing.spaceXs },
  backButtonText: { color: colors.onPrimary, ...typography.label },
  error: { color: colors.danger, marginBottom: spacing.spaceXs, textAlign: 'center' },
  avatar: { width: 88, height: 88, borderRadius: 44, marginBottom: spacing.spaceSm },
  avatarPlaceholder: { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: colors.onPrimary, fontFamily: 'Sora_700Bold', fontSize: 36 },
  name: { ...typography.screenTitle },
  uniqueId: { color: colors.muted, marginBottom: spacing.spaceLg, ...typography.meta },
  statsRow: { flexDirection: 'row', gap: spacing.spaceLg, marginBottom: spacing.spaceMd },
  stat: { alignItems: 'center' },
  statValue: { ...typography.label, fontSize: 18 },
  statLabel: { color: colors.muted, ...typography.caption },
  actions: { flexDirection: 'row', gap: spacing.spaceSm, marginTop: spacing.spaceMd },
  messageButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: 12, alignItems: 'center', marginTop: spacing.spaceMd, width: '100%' },
  messageButtonText: { color: colors.onPrimary, ...typography.label, fontSize: 16 },
  primaryButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: 12, paddingHorizontal: 20, alignItems: 'center' },
  primaryButtonText: { color: colors.onPrimary, ...typography.label },
  secondaryButton: { backgroundColor: colors.danger, borderRadius: spacing.radiusControl, paddingVertical: 12, paddingHorizontal: 20, alignItems: 'center' },
  secondaryButtonText: { color: colors.onPrimary, ...typography.label },
  disabledButton: { backgroundColor: colors.border, borderRadius: spacing.radiusControl, paddingVertical: 12, paddingHorizontal: 20, alignItems: 'center' },
  disabledButtonText: { color: colors.muted, ...typography.label },
  moderation: { flexDirection: 'row', gap: spacing.spaceLg, marginTop: spacing.spaceLg + spacing.spaceXs, alignItems: 'center' },
  reportLink: { color: colors.muted, fontFamily: 'WorkSans_600SemiBold', fontSize: 15 },
  blockLink: { color: colors.danger, fontFamily: 'WorkSans_600SemiBold', fontSize: 15 },
  reportForm: { gap: spacing.spaceXs, width: '100%' },
  reportInput: { borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusControl, padding: spacing.spaceSm, minHeight: 80, textAlignVertical: 'top', ...typography.body },
});
```

- [ ] **Step 2: Run typecheck**

Run: `cd mobile && npm run typecheck`
Expected: clean.

- [ ] **Step 3: Run the full test suite**

Run: `cd mobile && npm test`
Expected: 202/202 passing.

- [ ] **Step 4: Commit**

```bash
cd mobile
git add "app/(tabs)/people/user/[id].tsx"
git commit -m "$(cat <<'EOF'
style: apply design system tokens to the friend profile screen

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Retrofit Messaggi

**Files:**
- Modify: `mobile/app/(tabs)/messages/index.tsx`
- Modify: `mobile/app/(tabs)/messages/[id].tsx`

**Interfaces:**
- Consumes: `colors`, `typography`, `spacing`, `withPressed` from `@/theme`.

- [ ] **Step 1: Update `messages/index.tsx`**

Add the import:
```tsx
import { colors, typography, spacing } from '@/theme';
```

Replace the `StyleSheet.create` block:
```tsx
const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, paddingHorizontal: spacing.spaceMd },
  centered: { backgroundColor: colors.background, flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { ...typography.screenTitle, marginBottom: spacing.spaceSm },
  error: { color: colors.danger, marginBottom: spacing.spaceXs },
  subtitle: { color: colors.muted, textAlign: 'center', marginTop: spacing.spaceLg, ...typography.body },
  list: { paddingBottom: spacing.spaceLg },
  row: { paddingVertical: spacing.spaceSm, borderBottomWidth: 1, borderBottomColor: colors.border },
  name: typography.label,
  preview: { color: colors.muted, ...typography.body, fontSize: 14, marginTop: 2 },
  unreadText: { fontFamily: 'WorkSans_600SemiBold', color: colors.ink },
  date: { color: colors.muted, ...typography.caption, marginTop: 2 },
});
```

- [ ] **Step 2: Update `messages/[id].tsx`**

Add the import:
```tsx
import { colors, typography, spacing, withPressed } from '@/theme';
```

Add `hitSlop` to the "← Torna ai messaggi" back link. Apply `withPressed` to `retryButton` and `sendButton`.

Same `timestamp` split as `chat.tsx` in Task 6, same reason. In `MessageBubble`, change:
```tsx
<Text style={styles.timestamp}>{new Date(message.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</Text>
```
to:
```tsx
<Text style={isOwn ? styles.timestampOwn : styles.timestampOther}>{new Date(message.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</Text>
```

Replace the `StyleSheet.create` block:
```tsx
const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, paddingHorizontal: spacing.spaceMd },
  centered: { backgroundColor: colors.background, flex: 1, alignItems: 'center', justifyContent: 'center' },
  backLink: { color: colors.primary, marginBottom: spacing.spaceXs },
  header: { ...typography.screenTitle, marginBottom: spacing.spaceXs },
  error: { color: colors.danger, marginBottom: spacing.spaceXs },
  retryButton: { alignSelf: 'flex-start', backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: spacing.spaceXs, paddingHorizontal: spacing.spaceMd, marginBottom: spacing.spaceXs },
  retryButtonText: { color: colors.onPrimary, ...typography.label },
  messageList: { paddingVertical: spacing.spaceXs, gap: spacing.spaceXs },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowOwn: { justifyContent: 'flex-end' },
  bubbleRowOther: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', borderRadius: spacing.radiusCard, paddingHorizontal: spacing.spaceSm, paddingVertical: spacing.spaceXs },
  bubbleOwn: { backgroundColor: colors.primary },
  bubbleOther: { backgroundColor: colors.border },
  bubbleTextOwn: { color: colors.onPrimary, ...typography.body },
  bubbleTextOther: { color: colors.ink, ...typography.body },
  timestampOwn: { fontSize: 10, color: colors.primaryTint, marginTop: 4, alignSelf: 'flex-end' },
  timestampOther: { fontSize: 10, color: colors.muted, marginTop: 4, alignSelf: 'flex-end' },
  inputRow: { flexDirection: 'row', gap: spacing.spaceXs, paddingVertical: spacing.spaceXs, alignItems: 'flex-end' },
  input: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusPill, paddingHorizontal: spacing.spaceMd, paddingVertical: 10, maxHeight: 100, ...typography.body },
  sendButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusPill, paddingHorizontal: spacing.spaceMd, paddingVertical: 10, justifyContent: 'center' },
  sendButtonText: { color: colors.onPrimary, ...typography.label },
});
```

- [ ] **Step 3: Run typecheck**

Run: `cd mobile && npm run typecheck`
Expected: clean.

- [ ] **Step 4: Run the full test suite**

Run: `cd mobile && npm test`
Expected: 202/202 passing.

- [ ] **Step 5: Commit**

```bash
cd mobile
git add "app/(tabs)/messages"
git commit -m "$(cat <<'EOF'
style: apply design system tokens to Messaggi

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Retrofit Profilo

**Files:**
- Modify: `mobile/app/(tabs)/profile/index.tsx`
- Modify: `mobile/app/(tabs)/profile/edit.tsx`

**Interfaces:**
- Consumes: `colors`, `typography`, `spacing`, `withPressed` from `@/theme`.

- [ ] **Step 1: Update `profile/index.tsx`**

Add the import:
```tsx
import { colors, typography, spacing, withPressed } from '@/theme';
```

Apply `withPressed` to `editButton` and `logoutButton`.

Replace the `StyleSheet.create` block:
```tsx
const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, alignItems: 'center', padding: spacing.spaceLg, paddingTop: 48 },
  avatar: { width: 88, height: 88, borderRadius: 44, marginBottom: spacing.spaceSm },
  avatarPlaceholder: { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: colors.onPrimary, fontFamily: 'Sora_700Bold', fontSize: 36 },
  name: typography.screenTitle,
  uniqueId: { color: colors.muted, marginBottom: spacing.spaceLg, ...typography.meta },
  statsRow: { flexDirection: 'row', gap: spacing.spaceLg, marginBottom: spacing.spaceMd },
  stat: { alignItems: 'center' },
  statValue: { ...typography.label, fontSize: 18 },
  statLabel: { color: colors.muted, ...typography.caption },
  editButton: { marginTop: spacing.spaceLg, backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: 10, paddingHorizontal: spacing.spaceLg },
  editButtonText: { color: colors.onPrimary, ...typography.label },
  logoutButton: { marginTop: spacing.spaceLg + spacing.spaceXs, borderWidth: 1, borderColor: colors.danger, borderRadius: spacing.radiusControl, paddingVertical: 10, paddingHorizontal: spacing.spaceLg },
  logoutText: { color: colors.danger, ...typography.label },
});
```

- [ ] **Step 2: Update `profile/edit.tsx`**

Add the import. Add `hitSlop` to the "← Torna al profilo" back link.

Replace the `StyleSheet.create` block:
```tsx
const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, paddingHorizontal: spacing.spaceMd },
  backLink: { color: colors.primary, marginBottom: spacing.spaceXs },
  header: { ...typography.screenTitle, marginBottom: 4 },
});
```

- [ ] **Step 3: Run typecheck**

Run: `cd mobile && npm run typecheck`
Expected: clean.

- [ ] **Step 4: Run the full test suite**

Run: `cd mobile && npm test`
Expected: 202/202 passing.

- [ ] **Step 5: Commit**

```bash
cd mobile
git add "app/(tabs)/profile"
git commit -m "$(cat <<'EOF'
style: apply design system tokens to Profilo

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Retrofit shared components, delete dead code

**Files:**
- Modify: `mobile/src/components/MatchCard.tsx`
- Modify: `mobile/src/components/MatchForm.tsx`
- Modify: `mobile/src/components/ParticipantRow.tsx`
- Modify: `mobile/src/components/ProfileForm.tsx`
- Delete: `mobile/src/components/ScreenPlaceholder.tsx`

**Interfaces:**
- Consumes: `colors`, `typography`, `spacing`, `withPressed` from `@/theme`.

- [ ] **Step 1: Delete the dead component**

```bash
cd mobile
git rm src/components/ScreenPlaceholder.tsx
```

(Already confirmed unreferenced anywhere in `app/` or `src/` — see the design spec §6.)

- [ ] **Step 2: Update `MatchCard.tsx`**

Add the import:
```tsx
import { colors, typography, spacing } from '@/theme';
```

Replace the `StyleSheet.create` block:
```tsx
const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusCard, padding: spacing.spaceMd, gap: 4, marginBottom: spacing.spaceSm },
  fieldName: { ...typography.label, fontSize: 18 },
  meta: { color: colors.ink, ...typography.body },
  spots: { color: colors.primary, fontFamily: 'WorkSans_600SemiBold', fontSize: 15, marginTop: 4 },
});
```

- [ ] **Step 3: Update `MatchForm.tsx`**

Add the import:
```tsx
import { colors, typography, spacing, withPressed } from '@/theme';
```

Apply `withPressed` to `button` (the submit button).

Replace the `StyleSheet.create` block:
```tsx
const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, padding: spacing.spaceLg, gap: spacing.spaceSm },
  label: { fontFamily: 'WorkSans_600SemiBold', fontSize: 15, marginTop: spacing.spaceXs },
  row: { flexDirection: 'row', gap: spacing.spaceXs },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusPill, paddingVertical: spacing.spaceXs, paddingHorizontal: spacing.spaceMd },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.ink, ...typography.body },
  chipTextSelected: { color: colors.onPrimary, ...typography.body },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusControl, padding: spacing.spaceSm, ...typography.body },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  button: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, padding: 14, alignItems: 'center', marginTop: spacing.spaceMd },
  buttonText: { color: colors.onPrimary, ...typography.label, fontSize: 16 },
  error: { color: colors.danger },
});
```

- [ ] **Step 4: Update `ParticipantRow.tsx`**

Add the import:
```tsx
import { colors, typography, spacing } from '@/theme';
```

Replace the `StyleSheet.create` block:
```tsx
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.spaceSm, paddingVertical: spacing.spaceXs },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarPlaceholder: { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: colors.onPrimary, fontFamily: 'Sora_700Bold' },
  info: { flex: 1 },
  name: typography.label,
  role: { color: colors.muted, ...typography.meta },
});
```

- [ ] **Step 5: Update `ProfileForm.tsx`**

Add the import:
```tsx
import { colors, typography, spacing, withPressed } from '@/theme';
```

Apply `withPressed` to `button` (the submit button).

Replace the `StyleSheet.create` block:
```tsx
const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, padding: spacing.spaceLg, gap: spacing.spaceSm },
  avatarWrapper: { alignItems: 'center', marginBottom: spacing.spaceSm },
  avatar: { width: 88, height: 88, borderRadius: 44 },
  avatarPlaceholder: { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarPlaceholderText: { color: colors.onPrimary, fontFamily: 'Sora_700Bold', fontSize: 36 },
  avatarHint: { color: colors.primary, ...typography.meta, marginTop: spacing.spaceXs, fontFamily: 'WorkSans_600SemiBold' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusControl, padding: spacing.spaceSm, ...typography.body },
  dateValue: { ...typography.body, color: colors.ink },
  datePlaceholder: { ...typography.body, color: colors.muted },
  iosDatePicker: { alignSelf: 'center' },
  dateDoneButton: { alignSelf: 'flex-end', paddingVertical: 4, paddingHorizontal: spacing.spaceXs, marginTop: -8 },
  dateDoneText: { color: colors.primary, fontFamily: 'WorkSans_600SemiBold', fontSize: 15 },
  label: { fontFamily: 'WorkSans_600SemiBold', fontSize: 15, marginTop: spacing.spaceXs },
  row: { flexDirection: 'row', gap: spacing.spaceXs },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusPill, paddingVertical: spacing.spaceXs, paddingHorizontal: spacing.spaceMd },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.ink, ...typography.body },
  chipTextSelected: { color: colors.onPrimary, ...typography.body },
  button: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, padding: 14, alignItems: 'center', marginTop: spacing.spaceMd },
  buttonText: { color: colors.onPrimary, ...typography.label, fontSize: 16 },
  error: { color: colors.danger },
});
```

Also add `hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}` to the "Fatto" date-picker-done button (`dateDoneButton`) — it's a small text-only tap target on iOS.

- [ ] **Step 6: Run typecheck**

Run: `cd mobile && npm run typecheck`
Expected: clean.

- [ ] **Step 7: Run the full test suite**

Run: `cd mobile && npm test`
Expected: 202/202 passing (no test imports `ScreenPlaceholder` or asserts on any of these components' styles).

- [ ] **Step 8: Commit**

```bash
cd mobile
git add src/components
git commit -m "$(cat <<'EOF'
style: apply design system tokens to shared components, remove dead ScreenPlaceholder

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Manual verification

**Files:** none (manual walkthrough, no code changes)

- [ ] **Step 1: Run the full automated suite one more time**

Run: `cd mobile && npm run typecheck && npm test`
Expected: typecheck clean; 202/202 Jest tests passing (this plan adds no new tests — see Global Constraints).

- [ ] **Step 2: Grep for any remaining raw hex literals**

Run: `cd mobile && grep -rn "#[0-9a-fA-F]\{3,6\}" app src/components --include="*.tsx" | grep -v "theme/colors.ts"`
Expected: no output. Any match is a screen or component this plan missed — fix it before continuing (extend it with the matching token from `@/theme`, following the same pattern as its neighbors in this plan).

- [ ] **Step 3: Live walkthrough in the iOS Simulator**

Using an existing test user:
1. Cold-start the app. Confirm the splash screen holds briefly (fonts loading) rather than flashing unstyled text, then the login screen renders in Sora/Work Sans.
2. Walk every tab (Home, Le mie partite, Persone, Messaggi, Profilo) and confirm: green is `#1B7A4A` (not the old `#1a7f37` — close enough that this is a spot-check, not a pixel-diff), text uses the new fonts (headings visibly heavier/more geometric than plain system font), backgrounds read as a warm off-white rather than pure white or gray.
3. On Home, confirm the notification bell and any "← Torna..." link still register a tap when touched slightly outside their visible text (the `hitSlop` from this plan).
4. Press and hold any solid green or red button (e.g. "Accedi", "Modifica profilo", "Cancella partita") and confirm a visible opacity dip while held (the `withPressed` feedback from this plan).
5. Open a match chat and a private message thread; confirm bubble colors and the unread-notification highlight (Task 4's `primaryTint`) look intentional, not washed out or too similar to the surrounding background.
6. Re-run the create-profile and edit-profile flows once each; confirm the date picker and height-validation error message (from the `modifica-profilo` plan, untouched here) still work — this plan changed their `StyleSheet.create` values only, never their logic.

- [ ] **Step 4: Record the outcome**

If every check in Step 3 passes, this plan is done. If Step 2's grep or Step 3's walkthrough finds a real miss, fix it as a small follow-up commit (not a new task) before treating this plan as complete.
