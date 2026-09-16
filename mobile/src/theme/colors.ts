// mobile/src/theme/colors.ts
export const colors = {
  primary: '#F5C518',
  onPrimary: '#0B3D2E',
  primaryTint: 'rgba(245,197,24,0.14)',
  background: '#0B3D2E',
  surface: '#0F4A37',
  border: 'rgba(242,245,240,0.22)',
  ink: '#F2F5F0',
  muted: '#9DBBAE',
  // `muted` clears WCAG AA against `background` (~5.9:1) and `surface`
  // (~4.94:1), but drops to ~3.88:1 on the darker "own message" chat
  // bubble background (#175B44) -- use `accentMuted` there instead
  // (~4.8:1 on that same bubble).
  mutedStrong: '#C3D8CE',
  accentMuted: '#9FD4B5',
  // `accent` doubles as the "urgent" highlight (pulsing "Ultimo uomo"
  // badge) and shares primary's gold -- always paired with `accentText`
  // (dark), never `ink` (near-white on gold fails contrast).
  accent: '#F5C518',
  accentBg: 'rgba(245,197,24,0.14)',
  accentText: '#0B3D2E',
  success: '#6FD07E',
  danger: '#FF9AA8',
  dangerBg: 'rgba(255,154,168,0.14)',
} as const;
