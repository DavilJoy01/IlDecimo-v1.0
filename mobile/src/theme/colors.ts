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
  // `muted` is calibrated against `background`/`surface` (~4.5-4.85:1,
  // WCAG AA for normal text). On the darker `border` background it drops
  // to ~3.80:1, failing AA -- use this instead for muted text that sits
  // on a `border`-colored surface (a received chat bubble, a disabled
  // button). ~5.43:1 on `border`.
  mutedStrong: '#4F5D54',
  accent: '#E2A63B',
  accentBg: '#FBF1DD',
  accentText: '#8A5A12',
  danger: '#C23B2E',
  dangerBg: '#FBEAE7',
} as const;
