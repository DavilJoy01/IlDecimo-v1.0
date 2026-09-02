import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MatchForm } from '@/components/MatchForm';
import { useCreateMatch } from '@/hooks/useCreateMatch';

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
        <Pressable style={styles.button} onPress={() => router.back()}>
          <Text style={styles.buttonText}>Torna alla Home</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 24 }]}>
      <Pressable onPress={() => router.back()}>
        <Text style={styles.backLink}>← Annulla</Text>
      </Pressable>
      <Text style={styles.title}>Crea partita</Text>
      <MatchForm onSubmit={create} submitLabel="Crea partita" loading={loading} error={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 8 },
  subtitle: { color: '#666', textAlign: 'center' },
  backLink: { color: '#1a7f37', marginBottom: 8 },
  button: { backgroundColor: '#1a7f37', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 20, marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '600' },
});
