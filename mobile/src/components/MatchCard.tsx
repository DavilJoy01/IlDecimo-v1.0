// mobile/src/components/MatchCard.tsx
import { View, Text, StyleSheet } from 'react-native';
import type { NearbyMatch } from '@/api/matches';

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
  card: { borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 12, padding: 16, gap: 4, marginBottom: 12 },
  fieldName: { fontSize: 18, fontWeight: '700' },
  meta: { color: '#444' },
  spots: { color: '#1a7f37', fontWeight: '600', marginTop: 4 },
});
