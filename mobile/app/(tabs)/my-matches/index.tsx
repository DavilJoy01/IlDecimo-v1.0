// mobile/app/(tabs)/my-matches/index.tsx
import { useCallback } from 'react';
import { View, Text, SectionList, ActivityIndicator, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useMyMatches } from '@/hooks/useMyMatches';
import type { Match } from '@/api/matches';
import type { ParticipantStatus } from '@/api/participants';

interface Row {
  match: Match;
  status?: ParticipantStatus;
}

const STATUS_LABELS: Record<ParticipantStatus, string> = {
  requested: 'In attesa di approvazione',
  approved: 'Approvato',
  active: 'Attivo',
  rejected: 'Rifiutato',
  left: 'Abbandonata',
  completed: 'Completata',
};

export default function MyMatchesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { created, participating, loading, error, refresh } = useMyMatches();

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  function goToMatch(id: string) {
    router.push({ pathname: '/(tabs)/home/match/[id]', params: { id } });
  }

  if (loading && created.length === 0 && participating.length === 0) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const sections = [
    { title: 'Create da te', data: created.map((match): Row => ({ match })) },
    { title: 'A cui partecipi', data: participating.map((p): Row => ({ match: p.match, status: p.status })) },
  ].filter((section) => section.data.length > 0);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <Text style={styles.header}>Le mie partite</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.match.id}
        renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => goToMatch(item.match.id)}>
            <Text style={styles.rowTitle}>{item.match.field_name}</Text>
            <Text style={styles.rowMeta}>
              {item.match.match_date} · {item.match.start_time.slice(0, 5)} → {item.match.end_time.slice(0, 5)}
            </Text>
            {item.status && <Text style={styles.rowStatus}>{STATUS_LABELS[item.status]}</Text>}
          </Pressable>
        )}
        contentContainerStyle={styles.list}
        onRefresh={refresh}
        refreshing={loading}
        ListEmptyComponent={<Text style={styles.subtitle}>Nessuna partita al momento.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { fontSize: 22, fontWeight: '700', marginBottom: 12 },
  error: { color: '#c0392b', marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowMeta: { color: '#666', fontSize: 13, marginTop: 2 },
  rowStatus: { color: '#1a7f37', fontSize: 13, fontWeight: '600', marginTop: 2 },
  list: { paddingBottom: 24 },
  subtitle: { color: '#666', textAlign: 'center', marginTop: 24 },
});
