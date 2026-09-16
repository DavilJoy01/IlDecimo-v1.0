import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MatchForm, type MatchFormValues } from '@/components/MatchForm';
import { useCreateMatch } from '@/hooks/useCreateMatch';
import { colors, typography, spacing } from '@/theme';

export default function CreateMatchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { resolveLocation, create, loading, error } = useCreateMatch();

  async function handleSubmit(values: MatchFormValues) {
    const resolved = await resolveLocation(values.address);
    if (!resolved) return;
    Alert.alert(
      'Conferma posizione',
      `Abbiamo trovato: "${resolved.label}". È questa la posizione giusta per la partita?`,
      [
        { text: 'Modifica indirizzo', style: 'cancel' },
        { text: 'Sì, crea partita', onPress: () => create(values, resolved) },
      ]
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 24 }]}>
      <Pressable onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.backLink}>← Annulla</Text>
      </Pressable>
      <Text style={styles.title}>Convoca{'\n'}una partita</Text>
      <MatchForm onSubmit={handleSubmit} submitLabel="Pubblica la convocazione" loading={loading} error={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, paddingHorizontal: spacing.spaceLg },
  title: { ...typography.screenTitle, color: colors.ink, textTransform: 'uppercase', marginBottom: spacing.spaceSm },
  backLink: { color: colors.primary, marginBottom: spacing.spaceXs },
});
