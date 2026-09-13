import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MatchForm } from '@/components/MatchForm';
import { useCreateMatch } from '@/hooks/useCreateMatch';
import { colors, typography, spacing } from '@/theme';

export default function CreateMatchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { create, loading, error } = useCreateMatch();

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
  title: { ...typography.label, fontSize: 24, marginBottom: spacing.spaceXs },
  backLink: { color: colors.primary, marginBottom: spacing.spaceXs },
});
