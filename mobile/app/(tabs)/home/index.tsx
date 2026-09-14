// mobile/app/(tabs)/home/index.tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, StyleSheet, Pressable, TextInput, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useNearbyMatches } from '@/hooks/useNearbyMatches';
import { useNotifications } from '@/hooks/useNotifications';
import { useSessionStore } from '@/stores/sessionStore';
import { MatchCard } from '@/components/MatchCard';
import { MatchMapView } from '@/components/MatchMapView';
import { colors, typography, spacing, withPressed } from '@/theme';

const MATCH_TYPES = [5, 7, 8] as const;

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { matches, loading, error, locationLabel, searchLocation, refresh } = useNearbyMatches();
  const { unreadCount, refresh: refreshNotifications } = useNotifications();
  const firstName = useSessionStore((state) => state.profile?.first_name);
  const [activeTypes, setActiveTypes] = useState<Set<number>>(new Set());
  const [searchText, setSearchText] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');

  useEffect(() => {
    if (locationLabel) setSearchText(locationLabel);
  }, [locationLabel]);

  function toggleType(type: number) {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }

  // matches is already ordered nearest-to-farthest by the nearby_open_matches
  // RPC; .filter() preserves that order.
  const filteredMatches = useMemo(
    () => (activeTypes.size === 0 ? matches : matches.filter((match) => activeTypes.has(match.match_type))),
    [matches, activeTypes]
  );

  useFocusEffect(
    useCallback(() => {
      refresh();
      refreshNotifications();
    }, [refresh, refreshNotifications])
  );

  if (loading && !locationLabel) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      {firstName && <Text style={styles.greeting}>Ciao {firstName}</Text>}
      <View style={styles.headerRow}>
        <Text style={styles.header}>Partite vicino a te</Text>
        <View style={styles.headerActions}>
          {locationLabel && (
            <Pressable
              style={styles.viewToggleButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => setViewMode((mode) => (mode === 'list' ? 'map' : 'list'))}
            >
              <Text style={styles.viewToggleIcon}>{viewMode === 'list' ? '🗺️' : '📋'}</Text>
            </Pressable>
          )}
          <Pressable
            style={styles.bellButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => router.push('/(tabs)/home/notifications')}
          >
            <Text style={styles.bellIcon}>🔔</Text>
            {unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Cerca una città o un indirizzo"
          value={searchText}
          onChangeText={setSearchText}
          onSubmitEditing={() => {
            if (searchText && !loading) searchLocation(searchText);
          }}
          returnKeyType="search"
        />
        <Pressable
          style={withPressed(styles.searchButton)}
          disabled={!searchText || loading}
          onPress={() => searchLocation(searchText)}
        >
          <Text style={styles.searchButtonText}>Cerca</Text>
        </Pressable>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      {!locationLabel ? (
        <Text style={styles.subtitle}>Cerca una città per trovare le partite vicino a te.</Text>
      ) : viewMode === 'map' ? (
        <MatchMapView
          pins={filteredMatches.map((match) => ({ id: match.id, latitude: match.latitude, longitude: match.longitude }))}
          onPressPin={(id) => router.push({ pathname: '/(tabs)/home/match/[id]', params: { id } })}
          style={styles.map}
        />
      ) : (
        <>
          <View style={styles.filterRow}>
            {MATCH_TYPES.map((type) => {
              const active = activeTypes.has(type);
              return (
                <Pressable
                  key={type}
                  style={withPressed([styles.filterPill, active && styles.filterPillActive])}
                  onPress={() => toggleType(type)}
                >
                  <Text style={[styles.filterPillText, active && styles.filterPillTextActive]}>Calcio a {type}</Text>
                </Pressable>
              );
            })}
          </View>
          <FlatList
            data={filteredMatches}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const openMatch = () => router.push({ pathname: '/(tabs)/home/match/[id]', params: { id: item.id } });
              return (
                <Pressable onPress={openMatch}>
                  <MatchCard match={item} onPressJoin={openMatch} />
                </Pressable>
              );
            }}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
            ListEmptyComponent={
              <Text style={styles.subtitle}>
                {activeTypes.size > 0 && matches.length > 0
                  ? 'Nessuna partita di questo tipo trovata.'
                  : 'Nessuna partita trovata nella tua zona.'}
              </Text>
            }
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1 },
  greeting: { ...typography.label, fontSize: 16, color: colors.muted, paddingHorizontal: spacing.spaceMd, marginBottom: spacing.spaceXs },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.spaceMd,
    marginBottom: spacing.spaceSm,
  },
  header: typography.screenTitle,
  searchRow: {
    flexDirection: 'row',
    gap: spacing.spaceXs,
    paddingHorizontal: spacing.spaceMd,
    marginBottom: spacing.spaceSm,
  },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.radiusControl,
    padding: spacing.spaceSm,
    ...typography.body,
  },
  searchButton: {
    backgroundColor: colors.primary,
    borderRadius: spacing.radiusControl,
    paddingHorizontal: spacing.spaceMd,
    justifyContent: 'center',
  },
  searchButtonText: { color: colors.onPrimary, ...typography.label },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.spaceXs,
    paddingHorizontal: spacing.spaceMd,
    marginBottom: spacing.spaceSm,
  },
  filterPill: { borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusControl, paddingVertical: 6, paddingHorizontal: spacing.spaceSm },
  filterPillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterPillText: { color: colors.ink, ...typography.label, fontSize: 13 },
  filterPillTextActive: { color: colors.onPrimary },
  bellButton: { position: 'relative', padding: 4 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.spaceSm },
  viewToggleButton: { padding: 4 },
  viewToggleIcon: { fontSize: 20 },
  map: { flex: 1 },
  bellIcon: { fontSize: 22 },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: colors.danger,
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: colors.onPrimary, ...typography.caption },
  list: { paddingHorizontal: spacing.spaceMd, paddingBottom: spacing.spaceLg },
  centered: { backgroundColor: colors.background, flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.spaceLg, gap: spacing.spaceSm },
  subtitle: { color: colors.muted, textAlign: 'center', ...typography.body, paddingHorizontal: spacing.spaceMd, marginTop: spacing.spaceSm },
  error: { color: colors.danger, textAlign: 'center', paddingHorizontal: spacing.spaceMd, marginBottom: spacing.spaceSm },
});
