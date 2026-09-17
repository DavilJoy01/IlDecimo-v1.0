// mobile/src/components/LastCallSection.tsx
import { useMemo } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import type { NearbyMatch } from '@/api/matches';
import { colors, typography, spacing, withPressed } from '@/theme';

const MAX_SPOTS_LEFT = 3;
const MAX_CARDS = 10;

export function LastCallSection({ matches, onPressMatch }: { matches: NearbyMatch[]; onPressMatch: (id: string) => void }) {
  const urgentMatches = useMemo(() => {
    return matches
      .map((match) => ({ match, spotsLeft: match.max_players - match.approved_players_count }))
      .filter(({ spotsLeft }) => spotsLeft >= 1 && spotsLeft <= MAX_SPOTS_LEFT)
      .sort((a, b) => a.spotsLeft - b.spotsLeft || a.match.distance_km - b.match.distance_km)
      .slice(0, MAX_CARDS);
  }, [matches]);

  if (urgentMatches.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.headingRow}>
        <Text style={styles.flame}>🔥</Text>
        <View>
          <Text style={styles.title}>Ultima chiamata</Text>
          <Text style={styles.subtitle}>Squadre quasi al completo, manca solo qualcuno</Text>
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {urgentMatches.map(({ match, spotsLeft }) => (
          <Pressable
            key={match.id}
            style={withPressed(styles.card)}
            onPress={() => onPressMatch(match.id)}
          >
            <View style={styles.cardTopRow}>
              <Text style={styles.typeLabel}>Calcio a {match.match_type}</Text>
              <View style={styles.spotsBadge}>
                <Text style={styles.spotsBadgeText}>
                  {spotsLeft === 1 ? 'ULTIMO POSTO' : `MANCANO ${spotsLeft}`}
                </Text>
              </View>
            </View>
            <Text style={styles.fieldName} numberOfLines={1}>{match.field_name}</Text>
            <Text style={styles.time}>
              {match.start_time.slice(0, 5)} <Text style={styles.timeSep}>→ {match.end_time.slice(0, 5)}</Text>
            </Text>
            <Text style={styles.distance}>{match.distance_km.toFixed(1)} km da te</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: spacing.spaceSm },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.spaceXs,
    paddingHorizontal: spacing.spaceMd,
    marginBottom: spacing.spaceSm,
  },
  flame: { fontSize: 22 },
  title: { ...typography.label, fontSize: 17, color: colors.ink, textTransform: 'uppercase', letterSpacing: 1 },
  subtitle: { ...typography.meta, color: colors.muted, marginTop: 1 },
  scrollContent: { paddingHorizontal: spacing.spaceMd, gap: spacing.spaceSm },
  card: {
    width: 182,
    backgroundColor: colors.accentBg,
    borderWidth: 1.5,
    borderColor: colors.accent,
    borderRadius: spacing.radiusCard,
    padding: spacing.spaceSm,
    gap: 4,
  },
  cardTopRow: { gap: 6 },
  typeLabel: { ...typography.meta, color: colors.accentMuted, textTransform: 'uppercase', letterSpacing: 1.6 },
  spotsBadge: { backgroundColor: colors.accent, borderRadius: spacing.radiusControl, paddingVertical: 4, paddingHorizontal: 8, alignSelf: 'flex-start' },
  spotsBadgeText: { ...typography.caption, color: colors.accentText, textTransform: 'uppercase', letterSpacing: 1 },
  fieldName: { ...typography.label, fontSize: 16, color: colors.ink, textTransform: 'uppercase', marginTop: 4 },
  time: { ...typography.body, color: colors.ink, fontVariant: ['tabular-nums'] },
  timeSep: { ...typography.meta, color: colors.muted },
  distance: { ...typography.meta, color: colors.muted, marginTop: 2 },
});
