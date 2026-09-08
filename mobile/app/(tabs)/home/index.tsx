// mobile/app/(tabs)/home/index.tsx
import { useCallback } from 'react';
import { View, Text, FlatList, ActivityIndicator, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useNearbyMatches } from '@/hooks/useNearbyMatches';
import { useNotifications } from '@/hooks/useNotifications';
import { MatchCard } from '@/components/MatchCard';

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { matches, loading, error, permissionDenied, refresh } = useNearbyMatches();
  const { unreadCount, refresh: refreshNotifications } = useNotifications();

  useFocusEffect(
    useCallback(() => {
      refresh();
      refreshNotifications();
    }, [refresh, refreshNotifications])
  );

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
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>Partite vicino a te</Text>
        <Pressable style={styles.bellButton} onPress={() => router.push('/(tabs)/home/notifications')}>
          <Text style={styles.bellIcon}>🔔</Text>
          {unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
            </View>
          )}
        </Pressable>
      </View>
      <FlatList
        data={matches}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push({ pathname: '/(tabs)/home/match/[id]', params: { id: item.id } })}>
            <MatchCard match={item} />
          </Pressable>
        )}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
        ListEmptyComponent={<Text style={styles.subtitle}>Nessuna partita trovata nella tua zona.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  header: { fontSize: 22, fontWeight: '700' },
  bellButton: { position: 'relative', padding: 4 },
  bellIcon: { fontSize: 22 },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: '#c0392b',
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  subtitle: { color: '#666', textAlign: 'center' },
  error: { color: '#c0392b', textAlign: 'center' },
  button: { backgroundColor: '#1a7f37', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 20, marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '600' },
});
