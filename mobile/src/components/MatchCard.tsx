// mobile/src/components/MatchCard.tsx
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { NearbyMatch } from '@/api/matches';
import { PitchDecoration } from '@/components/PitchDecoration';
import { colors, typography, spacing, withPressed } from '@/theme';

export function MatchCard({ match, onPressJoin }: { match: NearbyMatch; onPressJoin: () => void }) {
  const spotsLeft = match.max_players - match.approved_players_count;
  const isLastMan = spotsLeft === 1;
  const isUrgent = spotsLeft === 1 || spotsLeft === 2;

  return (
    <View style={styles.card}>
      <PitchDecoration />
      <View style={styles.metaRow}>
        <Text style={styles.typeLabel}>Calcio a {match.match_type}</Text>
        <Text style={styles.distance}>{match.distance_km.toFixed(1)} km</Text>
      </View>
      <Text style={styles.fieldName}>{match.field_name}</Text>
      <Text style={styles.time}>
        {match.start_time.slice(0, 5)} <Text style={styles.timeSep}>→ {match.end_time.slice(0, 5)}</Text>
      </Text>
      <View style={styles.slotsRow}>
        {Array.from({ length: match.max_players }).map((_, i) => {
          const filled = i < match.approved_players_count;
          return (
            <View
              key={i}
              style={[
                styles.slot,
                filled ? styles.slotFilled : isLastMan ? styles.slotLastMan : styles.slotEmpty,
              ]}
            />
          );
        })}
      </View>
      <View style={styles.footerRow}>
        <Text style={styles.playerCount}>{match.approved_players_count} / {match.max_players} in campo</Text>
        {isLastMan ? (
          <View style={styles.urgentBadge}>
            <Text style={styles.urgentBadgeText}>Ultimo uomo</Text>
          </View>
        ) : spotsLeft > 0 ? (
          <Text style={styles.spotsLabel}>{spotsLeft} post{spotsLeft === 1 ? 'o' : 'i'} liber{spotsLeft === 1 ? 'o' : 'i'}</Text>
        ) : null}
      </View>
      {spotsLeft > 0 && (
        <Pressable style={withPressed(styles.joinButton)} onPress={onPressJoin}>
          <Text style={styles.joinButtonText}>Scendi in campo</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusCard, padding: spacing.spaceMd, gap: 4, marginBottom: spacing.spaceSm, overflow: 'hidden' },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  typeLabel: { ...typography.meta, color: colors.accent, textTransform: 'uppercase', letterSpacing: 2 },
  distance: { ...typography.meta, color: colors.muted, letterSpacing: 0.8 },
  fieldName: { ...typography.label, fontSize: 20, textTransform: 'uppercase', color: colors.ink, marginTop: 4 },
  time: { ...typography.label, fontSize: 20, color: colors.ink, marginTop: 6, fontVariant: ['tabular-nums'] },
  timeSep: { ...typography.meta, color: colors.muted, textTransform: 'uppercase', letterSpacing: 1.2 },
  slotsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 12 },
  slot: { width: 9, height: 9, borderRadius: 5, borderWidth: 1.5 },
  slotFilled: { backgroundColor: colors.ink, borderColor: colors.ink },
  slotLastMan: { backgroundColor: colors.accent, borderColor: colors.accent },
  slotEmpty: { backgroundColor: 'transparent', borderColor: colors.border },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  playerCount: { ...typography.meta, color: colors.muted, textTransform: 'uppercase', letterSpacing: 1.2, fontVariant: ['tabular-nums'] },
  spotsLabel: { ...typography.meta, color: colors.success, textTransform: 'uppercase', letterSpacing: 1.2 },
  urgentBadge: { backgroundColor: colors.accent, borderRadius: spacing.radiusControl, paddingVertical: 5, paddingHorizontal: 11 },
  urgentBadgeText: { ...typography.caption, color: colors.accentText, textTransform: 'uppercase', letterSpacing: 1.6 },
  joinButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusCard, paddingVertical: 14, alignItems: 'center', marginTop: spacing.spaceSm },
  joinButtonText: { ...typography.label, color: colors.onPrimary, textTransform: 'uppercase', letterSpacing: 2 },
});
