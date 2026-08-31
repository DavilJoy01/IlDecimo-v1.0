import { View, Text, FlatList, ActivityIndicator, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { useNearbyMatches } from '@/hooks/useNearbyMatches';
import { MatchCard } from '@/components/MatchCard';

export default function HomeScreen() {
  const { matches, loading, error, permissionDenied, refresh } = useNearbyMatches();

  if (permissionDenied) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Attiva la posizione</Text>
        <Text style={styles.subtitle}>Per trovare le partite vicino a te abbiamo bisogno della tua posizione.</Text>
        <Pressable style={styles.button} onPress={refresh}>
          <Text style={styles.buttonText}>Riprova</Text>
        </Pressable>
      </View>
    );
  }

  if (loading && matches.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error}</Text>
        <Pressable style={styles.button} onPress={refresh}>
          <Text style={styles.buttonText}>Riprova</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Partite vicino a te</Text>
      <FlatList
        data={matches}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <MatchCard match={item} />}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
        ListEmptyComponent={<Text style={styles.subtitle}>Nessuna partita trovata nella tua zona.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 16 },
  header: { fontSize: 22, fontWeight: '700', paddingHorizontal: 16, marginBottom: 12 },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  subtitle: { color: '#666', textAlign: 'center' },
  error: { color: '#c0392b', textAlign: 'center' },
  button: { backgroundColor: '#1a7f37', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 20, marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '600' },
});
