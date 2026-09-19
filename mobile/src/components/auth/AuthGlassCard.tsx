// mobile/src/components/auth/AuthGlassCard.tsx
// Frosted panel that holds an auth screen's form fields, so they read as one
// deliberate surface floating over AuthBackdrop instead of bare inputs sitting
// directly on the background.
import type { PropsWithChildren } from 'react';
import { StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { spacing } from '@/theme';

export function AuthGlassCard({ children }: PropsWithChildren) {
  return (
    <BlurView intensity={40} tint="dark" style={styles.card}>
      {children}
    </BlurView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: spacing.radiusCard,
    borderWidth: 1,
    borderColor: 'rgba(242,245,240,0.14)',
    padding: spacing.spaceSm,
    gap: spacing.spaceSm,
    overflow: 'hidden',
  },
});
