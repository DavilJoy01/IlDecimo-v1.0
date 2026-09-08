# App-calcio Design System — Design Spec

## 1. Goal and scope

Today the app has no design system: every screen defines its own `StyleSheet.create` with inline hex colors and the platform default font, repeated (and drifting slightly) screen by screen. This plan introduces a shared, versioned set of design tokens — color, typography, spacing/radius — and retrofits **every existing screen and shared component** to use them, so the app reads as one coherent product instead of 19 independently-styled screens that happen to mostly use the same green.

This is a **visual/styling-only** change. No screen's layout structure, navigation, data flow, or business logic changes. Two small, unrelated-but-cheap quality fixes are bundled in because they were surfaced while researching this work and are trivial to apply screen-by-screen alongside the token migration (see §5). Out of scope, explicitly: dark mode (the app has never had one; introducing it is a separate future decision), any new screens or features, spacing/layout restructuring beyond adopting the new radius/spacing tokens, icons, and animation.

## 2. Direction chosen

Brainstormed three initial light-mode directions (energetic/sporty, clean/professional, warm/community) plus a dark "tech & neon" direction requested and then rejected by the user as unsuited to an app that is mostly forms, lists, and chat rather than a single flashy screen. The approved direction, "Verde campo," evolves the green the app already uses today rather than replacing it — same identity, executed with an actual color system and type scale instead of ad hoc hex literals. Validated against the real Profilo and Home screens as HTML mockups before writing this spec.

Cross-checked against the `ui-ux-pro-max` skill's design-system search: its curated palette/pattern database has no good match for this product type (a social match-scheduling utility app) — every result it returned was a sports-team-fan-site or generic-SaaS-landing-page archetype, wrong for an app that is mostly forms and lists, not a marketing page. Its typography search independently converged on `Work Sans` as a strong body-text pick for a "geometric, modern, clean, versatile" product, which is what this spec also lands on, and surfaced `Outfit` as a close cousin to the `Sora` heading face chosen here — noted as a validated fallback, not adopted (see §3.2).

## 3. Design tokens

### 3.1 Color

| Token | Hex | Role |
|---|---|---|
| `primary` | `#1B7A4A` | Buttons, active tab, links, primary icons |
| `onPrimary` | `#FFFFFF` | Text/icons on `primary` |
| `background` | `#F7F8F3` | Screen background (warm off-white, not neutral gray) |
| `surface` | `#FFFFFF` | Cards, inputs, sheets |
| `border` | `#E1E5DA` | Card/input hairlines |
| `ink` | `#16211B` | Primary text |
| `muted` | `#66756C` | Secondary text, captions, placeholders |
| `accent` | `#E2A63B` | The one secondary/"warm" color — availability indicators, badges, ratings |
| `accentBg` | `#FBF1DD` | Light tint background for an `accent` pill/badge |
| `accentText` | `#8A5A12` | Text on `accentBg` (never plain `accent` as text on its own tint — insufficient contrast) |
| `danger` | `#C23B2E` | Destructive actions, error text/borders |
| `dangerBg` | `#FBEAE7` | Light tint background for a `danger` pill/banner, mirroring `accentBg`'s pattern |

Rules:
- `primary` and `accent` never appear on the same element (e.g. never an accent-colored icon inside a primary-colored button). `accent` is reserved for the "something is available / notable" signal; overusing it as generic decoration dilutes that signal.
- Every colored pill/badge follows the `{role}Bg` + `{role}Text` pair, never a saturated fill with white text for anything except `primary`/`danger` solid buttons.
- `danger`'s hex is a deliberate close cousin of the `#c0392b` already used ad hoc in several existing screens — this is a refinement, not a behavior change; users won't perceive a shift in what "red" means in this app.

### 3.2 Typography

- **Display/headings, buttons, labels:** `Sora`, weights 600 and 700.
- **Body, meta, captions:** `Work Sans`, weights 400, 500, 600.
- Google Fonts is not an option on-device — both ship as static font files bundled via `expo-font` (see §4).
- Validated alternative, not adopted: `Outfit` (heading) is a close substitute for `Sora` if a future review prefers a slightly less distinctive face; `Work Sans` is already the first choice either way.

Type scale (name → family/weight/size, matched to what the app's screens already informally use today, made explicit and consistent):

| Token | Family / weight | Size | Used for |
|---|---|---|---|
| `screenTitle` | Sora 700 | 22px | Screen-level headers ("Le mie partite", "Partite vicino a te") |
| `authTitle` | Sora 700 | 27px | The handful of full-bleed auth screens (login, registration steps) |
| `label` | Sora 600 | 15px | Button text, card titles, person/match names |
| `body` | Work Sans 400 | 15px | Paragraphs, form input text, chat bubbles |
| `meta` | Work Sans 400 | 12.5px | Secondary line under a title (date/time/distance, "FC-xxxxxx" code) |
| `caption` | Work Sans 500 | 10.5px | Stat labels, tab bar labels, the smallest text in the app |

### 3.3 Spacing and radius

Not a new invention — codifying the sizes already informally in use across the app's `StyleSheet.create` blocks, so screens stop drifting between e.g. `10px`/`12px`/`14px` card padding for no reason:

| Token | Value | Used for |
|---|---|---|
| `radiusCard` | 14px | Cards, match rows, chat bubbles |
| `radiusControl` | 10px | Buttons, inputs, chips |
| `radiusPill` | 20px | Fully-rounded badges/pills |
| `spaceXs` / `spaceSm` / `spaceMd` / `spaceLg` | 6 / 12 / 16 / 24px | Gaps between stacked elements, in that order of frequency |

## 4. Implementation architecture

New module, `mobile/src/theme/`:
- `colors.ts` — exports the table in §3.1 as a flat `colors` object (`colors.primary`, `colors.accentBg`, etc.).
- `typography.ts` — exports the type scale in §3.2 as named `StyleSheet`-compatible objects (`typography.screenTitle`, etc., each a `{ fontFamily, fontWeight, fontSize }` object spreadable into a component's own style).
- `spacing.ts` — exports the tokens in §3.3.
- `index.ts` — re-exports all three, so screens import `{ colors, typography, spacing } from '@/theme'`.
- Font files: `Sora` (600, 700) and `Work Sans` (400, 500, 600) loaded via `expo-font`'s `useFonts` hook in the root layout (`app/_layout.tsx`), holding the splash screen (`expo-splash-screen`'s `preventAutoHideAsync`/`hideAsync`, standard Expo pattern) until fonts resolve. This is new — `app/_layout.tsx` today loads no custom fonts and has no splash-screen-hold logic at all (confirmed by reading the file); the `expo-splash-screen` package is already a config plugin in `app.json` for the native splash asset, but its JS-side hide-on-ready API isn't wired up yet. The root layout's existing `status === 'loading'` gate (auth bootstrap) and the new fonts-loading gate are two independent conditions that both need to resolve before rendering `<Slot />` — the plan should combine them into one guard, not two sequential ones, so a slow font load doesn't visibly flash the auth spinner first.

Migration rule for every screen/component touched: replace every hardcoded hex literal and every bare `fontWeight`/default-system-font text style with the matching token from `@/theme`. A screen is "done" when its `StyleSheet.create` block contains no raw hex string and no un-tokenized `fontSize`/`fontWeight` on any `Text`-bearing style.

## 5. Two bundled UX fixes

Surfaced via the `ui-ux-pro-max` skill's React Native stack guidance while researching this spec; both are cheap, screen-agnostic, and touch the same files the token migration already touches, so bundling them avoids a second full pass over 19 screens later:

1. **`hitSlop` on small touch targets.** Any icon-only or small (<44×44pt) `Pressable` — the Home notification bell, back-chevron links, the date-picker's avatar edit tap target — gets `hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}`.
2. **Press-state feedback on every `Pressable`.** Today's `Pressable` usages (already the correct primitive throughout this codebase — no `TouchableOpacity` to migrate away from) mostly pass a static `style` object with no pressed-state change. Standardize on `style={({ pressed }) => [baseStyle, pressed && styles.pressed]}` where `styles.pressed` is `{ opacity: 0.7 }`, applied via a small shared helper (`mobile/src/theme/pressedStyle.ts` or similar directly in each screen — decide during planning based on how much boilerplate the helper actually saves) so every button in the app visibly responds to touch.

## 6. Full inventory to retrofit

Every screen (19) and shared component (4) in the app today:

**Auth:** `create-password.tsx`, `create-profile.tsx`, `login.tsx`, `register-phone.tsx`, `verify-otp.tsx`

**Home tab:** `home/index.tsx`, `home/create-match.tsx`, `home/notifications.tsx`, `home/match/[id]/index.tsx`, `home/match/[id]/chat.tsx`, `home/match/[id]/invite.tsx`

**Le mie partite:** `my-matches/index.tsx`

**Persone:** `people/index.tsx`, `people/friend-requests.tsx`, `people/user/[id].tsx`

**Messaggi:** `messages/index.tsx`, `messages/[id].tsx`

**Profilo:** `profile/index.tsx`, `profile/edit.tsx`

**Shared components:** `MatchCard.tsx`, `MatchForm.tsx`, `ParticipantRow.tsx`, `ProfileForm.tsx`

**Also in scope:** delete `src/components/ScreenPlaceholder.tsx` — confirmed unreferenced anywhere in `app/` or `src/`, dead code left over from early scaffolding, unrelated to but cheap to remove while already touching every screen that might have once used it.

`_layout.tsx` files (6) are out of scope — they configure navigators, not visual style, and carry no `StyleSheet.create` of their own to migrate.

## 7. Testing and verification

No screen's logic, data flow, or test-covered behavior changes — this is a styling pass, so the existing Jest suite (currently 202 tests) and `tsc --noEmit` are the regression backstop and must stay green throughout; no new automated tests are expected (matching this codebase's existing convention of no screen-level UI tests, per `MatchForm`/`ProfileForm` having none today). Verification is a manual walkthrough in the iOS Simulator at the end, comparing each retrofitted screen against the approved Profilo/Home mockups for color and type fidelity, plus spot-checking the two UX fixes (tap a small icon slightly outside its visible bounds and confirm it registers; press and hold a button and confirm the opacity change is visible).

## 8. What this does not cover

Dark mode, any new screens or navigation changes, icon system/replacement, animation/motion, and a formal component library (e.g. no new shared `<Button>`/`<Card>` React components are mandated by this spec — screens keep their own JSX structure and only swap the *values* their existing styles reference for tokens; extracting shared primitive components is a reasonable future follow-up but not required to ship a consistent look).
