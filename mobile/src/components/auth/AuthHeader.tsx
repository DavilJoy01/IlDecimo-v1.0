// mobile/src/components/auth/AuthHeader.tsx
// Colour-block header shared by every auth screen: a green gradient panel
// with a small wordmark and a greeting, sitting above the white AuthCard.
import { Image, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, typography, spacing } from '@/theme';

const GRADIENT_FROM = '#1C6B4A';
const GRADIENT_TO = '#06231A';

export function AuthHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <LinearGradient colors={[GRADIENT_FROM, GRADIENT_TO]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.header}>
      <View style={styles.brandRow}>
        <Image source={require('../../../assets/images/splash-icon.png')} style={styles.mark} resizeMode="contain" />
        <Text style={styles.eyebrow}>{eyebrow}</Text>
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.spaceLg,
    paddingTop: spacing.spaceLg * 2,
    paddingBottom: spacing.spaceLg,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.spaceXs, marginBottom: spacing.spaceMd },
  mark: { width: 26, height: 26 },
  eyebrow: { color: colors.accentMuted, ...typography.meta, textTransform: 'uppercase', letterSpacing: 1 },
  title: { color: colors.ink, ...typography.screenTitle, fontSize: 30, marginTop: spacing.spaceXs },
  subtitle: { color: colors.accentMuted, ...typography.body, marginTop: spacing.spaceXs },
});
