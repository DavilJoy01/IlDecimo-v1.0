// mobile/src/components/auth/AuthCard.tsx
// White, rounded-top panel that holds an auth screen's form -- sits directly
// below AuthHeader's colour block, like a bottom sheet overlapping it.
import type { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';
import { spacing } from '@/theme';

const CARD_BG = '#FAFAF7';

export function AuthCard({ children }: PropsWithChildren) {
  return <View style={styles.card}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: CARD_BG,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    marginTop: -20,
    padding: spacing.spaceLg,
    paddingBottom: spacing.spaceLg * 2,
    gap: spacing.spaceMd,
    justifyContent: 'center',
  },
});
