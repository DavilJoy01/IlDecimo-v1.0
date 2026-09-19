// mobile/src/components/auth/AuthCard.tsx
// White, rounded-top panel that holds an auth screen's form -- sits directly
// below AuthHeader's colour block, like a bottom sheet overlapping it.
import type { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { spacing } from '@/theme';

const CARD_BG = '#FAFAF7';

interface AuthCardProps extends PropsWithChildren {
  // Short forms (one or two fields) center their content in the card so
  // they don't look stranded at the top. Longer forms (create-profile) need
  // to scroll instead -- centering a form taller than the card would just
  // clip its top off-screen.
  scroll?: boolean;
}

export function AuthCard({ children, scroll }: AuthCardProps) {
  if (scroll) {
    return (
      <ScrollView style={styles.card} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    );
  }
  return <View style={[styles.card, styles.centered]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: CARD_BG,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    marginTop: -20,
  },
  centered: {
    padding: spacing.spaceLg,
    paddingBottom: spacing.spaceLg * 2,
    gap: spacing.spaceMd,
    justifyContent: 'center',
  },
  scrollContent: {
    padding: spacing.spaceLg,
    paddingBottom: spacing.spaceLg * 2,
    gap: spacing.spaceMd,
  },
});
