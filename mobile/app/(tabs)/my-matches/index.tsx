// mobile/app/(tabs)/my-matches/index.tsx
import { useCallback } from 'react';
import { View, Text, SectionList, ActivityIndicator, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useMyMatches } from '@/hooks/useMyMatches';
import type { Match } from '@/api/matches';
import type { ParticipantStatus } from '@/api/participants';
import { colors, typography, spacing, withPressed } from '@/theme';

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
    { title: 'Da capitano', data: created.map((match): Row => ({ match })) },
    { title: 'Convocato', data: participating.map((p): Row => ({ match: p.match, status: p.status })) },
  ].filter((section) => section.data.length > 0);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>Il mio{'\n'}calendario</Text>
        <Pressable style={withPressed(styles.createButton)} onPress={() => router.push('/(tabs)/home/create-match')}>
          <Text style={styles.createButtonText}>Convoca</Text>
        </Pressable>
      </View>
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
  container: { backgroundColor: colors.background, flex: 1, paddingHorizontal: spacing.spaceMd },
  centered: { backgroundColor: colors.background, flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.spaceSm },
  header: { ...typography.screenTitle, color: colors.ink, textTransform: 'uppercase' },
  createButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: spacing.spaceXs, paddingHorizontal: spacing.spaceMd, alignSelf: 'flex-end' },
  createButtonText: { color: colors.onPrimary, ...typography.label, textTransform: 'uppercase' },
  error: { color: colors.danger, marginBottom: spacing.spaceXs },
  sectionTitle: { ...typography.label, fontSize: 13, color: colors.muted, textTransform: 'uppercase', letterSpacing: 2, marginTop: spacing.spaceMd, marginBottom: spacing.spaceXs },
  row: { paddingVertical: spacing.spaceSm, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowTitle: { ...typography.label, color: colors.ink, textTransform: 'uppercase' },
  rowMeta: { color: colors.muted, ...typography.meta, marginTop: 2 },
  rowStatus: { color: colors.primary, ...typography.meta, fontFamily: 'Archivo_600SemiBold', marginTop: 2 },
  list: { paddingBottom: spacing.spaceLg },
  subtitle: { color: colors.muted, textAlign: 'center', marginTop: spacing.spaceLg, ...typography.body },
});
