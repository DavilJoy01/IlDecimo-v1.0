// mobile/src/components/ParticipantRow.tsx
import type { ReactNode } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import type { ParticipantProfile } from '@/api/participants';
import { colors, typography, spacing } from '@/theme';

const ROLE_LABELS: Record<ParticipantProfile['player_role'], string> = {
  player: 'Giocatore',
  goalkeeper: 'Portiere',
  both: 'Giocatore/Portiere',
};

const FOOT_LABELS: Record<ParticipantProfile['preferred_foot'], string> = {
  left: 'Sinistro',
  right: 'Destro',
  both: 'Ambidestro',
};

interface ParticipantRowProps {
  profile: ParticipantProfile;
  children?: ReactNode;
}

export function ParticipantRow({ profile, children }: ParticipantRowProps) {
  return (
    <View style={styles.row}>
      {profile.profile_image_url ? (
        <Image source={{ uri: profile.profile_image_url }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarPlaceholder]}>
          <Text style={styles.avatarInitial}>{profile.first_name.charAt(0).toUpperCase()}</Text>
        </View>
      )}
      <View style={styles.info}>
        <Text style={styles.name}>
          {profile.first_name} {profile.last_name}
        </Text>
        <Text style={styles.role}>{ROLE_LABELS[profile.player_role]}</Text>
        <Text style={styles.role}>{FOOT_LABELS[profile.preferred_foot]} · piede preferito</Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.spaceSm, paddingVertical: spacing.spaceXs },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarPlaceholder: { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: colors.onPrimary, fontFamily: 'Oswald_700Bold' },
  info: { flex: 1 },
  name: typography.label,
  role: { color: colors.muted, ...typography.meta },
});
