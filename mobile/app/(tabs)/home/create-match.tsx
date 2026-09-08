import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MatchForm } from '@/components/MatchForm';
import { useCreateMatch } from '@/hooks/useCreateMatch';
import { colors, typography, spacing, withPressed } from '@/theme';

export default function CreateMatchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { create, loading, error, permissionDenied } = useCreateMatch();

  if (permissionDenied) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Attiva la posizione</Text>
        <Text style={styles.subtitle}>
          Per creare una partita abbiamo bisogno della posizione del tuo dispositivo, che useremo
          come posizione del campo.
        </Text>
        <Pressable style={withPressed(styles.button)} onPress={() => router.back()}>
          <Text style={styles.buttonText}>Torna indietro</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 24 }]}>
      <Pressable onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.backLink}>← Annulla</Text>
      </Pressable>
      <Text style={styles.title}>Crea partita</Text>
      <MatchForm onSubmit={create} submitLabel="Crea partita" loading={loading} error={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, paddingHorizontal: spacing.spaceLg },
  centered: { backgroundColor: colors.background, flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.spaceLg, gap: spacing.spaceSm },
  title: { ...typography.label, fontSize: 24, marginBottom: spacing.spaceXs },
  subtitle: { color: colors.muted, textAlign: 'center', ...typography.body },
  backLink: { color: colors.primary, marginBottom: spacing.spaceXs },
  button: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: 10, paddingHorizontal: 20, marginTop: spacing.spaceXs },
  buttonText: { color: colors.onPrimary, ...typography.label },
});
