// mobile/src/components/ParticipantRow.tsx
import type { ReactNode } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import type { ParticipantProfile } from '@/api/participants';

const ROLE_LABELS: Record<ParticipantProfile['player_role'], string> = {
  player: 'Giocatore',
  goalkeeper: 'Portiere',
  both: 'Giocatore/Portiere',
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
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarPlaceholder: { backgroundColor: '#1a7f37', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: '#fff', fontWeight: '700' },
  info: { flex: 1 },
  name: { fontWeight: '600' },
  role: { color: '#666', fontSize: 13 },
});
