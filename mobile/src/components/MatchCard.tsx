// mobile/src/components/MatchCard.tsx
import { View, Text, StyleSheet } from 'react-native';
import type { NearbyMatch } from '@/api/matches';
import { colors, typography, spacing } from '@/theme';

export function MatchCard({ match }: { match: NearbyMatch }) {
  const spotsLeft = match.max_players - match.approved_players_count;
  return (
    <View style={styles.card}>
      <Text style={styles.fieldName}>{match.field_name}</Text>
      <Text style={styles.meta}>📍 {match.distance_km.toFixed(1)} km · ⚽ Calcio a {match.match_type}</Text>
      <Text style={styles.meta}>{match.start_time.slice(0, 5)} → {match.end_time.slice(0, 5)}</Text>
      <Text style={styles.spots}>
        {match.approved_players_count}/{match.max_players} giocatori · {spotsLeft} post{spotsLeft === 1 ? 'o' : 'i'} disponibil{spotsLeft === 1 ? 'e' : 'i'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusCard, padding: spacing.spaceMd, gap: 4, marginBottom: spacing.spaceSm },
  fieldName: { ...typography.label, fontSize: 18 },
  meta: { color: colors.ink, ...typography.body },
  spots: { color: colors.primary, fontFamily: 'WorkSans_600SemiBold', fontSize: 15, marginTop: 4 },
});
