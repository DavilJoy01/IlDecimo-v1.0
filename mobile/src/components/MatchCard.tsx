// mobile/src/components/MatchCard.tsx
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { NearbyMatch } from '@/api/matches';
import { colors, typography, spacing, withPressed } from '@/theme';

export function MatchCard({ match, onPressJoin }: { match: NearbyMatch; onPressJoin: () => void }) {
  const spotsLeft = match.max_players - match.approved_players_count;
  const isUrgent = spotsLeft === 1 || spotsLeft === 2;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.fieldName}>{match.field_name}</Text>
        {isUrgent && (
          <View style={styles.urgentBadge}>
            <Text style={styles.urgentBadgeText}>{spotsLeft === 1 ? 'Manca 1!' : 'Mancano 2!'}</Text>
          </View>
        )}
      </View>
      <Text style={styles.meta}>📍 {match.distance_km.toFixed(1)} km · ⚽ Calcio a {match.match_type}</Text>
      <Text style={styles.meta}>{match.start_time.slice(0, 5)} → {match.end_time.slice(0, 5)}</Text>
      <Text style={styles.spots}>
        {match.approved_players_count}/{match.max_players} giocatori · {spotsLeft} post{spotsLeft === 1 ? 'o' : 'i'} disponibil{spotsLeft === 1 ? 'e' : 'i'}
      </Text>
      {spotsLeft > 0 && (
        <Pressable style={withPressed(isUrgent ? styles.joinButtonUrgent : styles.joinButton)} onPress={onPressJoin}>
          <Text style={isUrgent ? styles.joinButtonUrgentText : styles.joinButtonText}>
            {isUrgent ? 'Entra in campo' : 'Iscriviti'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusCard, padding: spacing.spaceMd, gap: 4, marginBottom: spacing.spaceSm },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.spaceXs },
  fieldName: { ...typography.label, fontSize: 18, flexShrink: 1 },
  urgentBadge: { backgroundColor: colors.accent, borderRadius: spacing.radiusControl, paddingVertical: 4, paddingHorizontal: spacing.spaceSm },
  urgentBadgeText: { color: colors.ink, ...typography.label, fontSize: 12 },
  meta: { color: colors.ink, ...typography.body },
  spots: { color: colors.primary, fontFamily: 'WorkSans_600SemiBold', fontSize: 15, marginTop: 4 },
  joinButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: 10, alignItems: 'center', marginTop: spacing.spaceXs },
  joinButtonText: { color: colors.onPrimary, ...typography.label },
  joinButtonUrgent: { backgroundColor: colors.accent, borderRadius: spacing.radiusControl, paddingVertical: 10, alignItems: 'center', marginTop: spacing.spaceXs },
  joinButtonUrgentText: { color: colors.ink, ...typography.label },
});
