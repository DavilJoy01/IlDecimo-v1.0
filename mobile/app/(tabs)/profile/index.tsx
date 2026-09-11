import { View, Text, StyleSheet, Pressable, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useSessionStore } from '@/stores/sessionStore';
import { supabase } from '@/api/supabase';
import { calculateAge, FOOT_LABELS, ROLE_LABELS } from '@/utils/profileDisplay';
import { colors, typography, spacing, withPressed } from '@/theme';

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const profile = useSessionStore((s) => s.profile);

  if (!profile) return null; // unreachable in practice: this screen is only mounted once status === 'signed-in'

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      {profile.profile_image_url ? (
        <Image source={{ uri: profile.profile_image_url }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarPlaceholder]}>
          <Text style={styles.avatarInitial}>{profile.first_name.charAt(0).toUpperCase()}</Text>
        </View>
      )}
      <Text style={styles.name}>{profile.first_name} {profile.last_name}</Text>
      <Text style={styles.uniqueId}>{profile.unique_user_id}</Text>

      <View style={styles.statsRow}>
        <Stat label="Età" value={String(calculateAge(profile.birth_date))} />
        <Stat label="Altezza" value={`${profile.height_cm} cm`} />
        <Stat label="Piede" value={FOOT_LABELS[profile.preferred_foot]} />
      </View>
      <View style={styles.statsRow}>
        <Stat label="Ruolo" value={ROLE_LABELS[profile.player_role]} />
        <Stat label="Giocate" value={String(profile.matches_played_count)} />
        <Stat label="Completate" value={String(profile.matches_completed_count)} />
      </View>

      <Pressable style={withPressed(styles.editButton)} onPress={() => router.push('/(tabs)/profile/edit')}>
        <Text style={styles.editButtonText}>Modifica profilo</Text>
      </Pressable>

      <Pressable style={withPressed(styles.logoutButton)} onPress={() => supabase.auth.signOut()}>
        <Text style={styles.logoutText}>Esci</Text>
      </Pressable>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, alignItems: 'center', padding: spacing.spaceLg },
  avatar: { width: 88, height: 88, borderRadius: 44, marginBottom: spacing.spaceSm },
  avatarPlaceholder: { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: colors.onPrimary, fontFamily: 'Sora_700Bold', fontSize: 36 },
  name: typography.screenTitle,
  uniqueId: { color: colors.muted, marginBottom: spacing.spaceLg, ...typography.meta },
  statsRow: { flexDirection: 'row', gap: spacing.spaceLg, marginBottom: spacing.spaceMd },
  stat: { alignItems: 'center' },
  statValue: { ...typography.label, fontSize: 18 },
  statLabel: { color: colors.muted, ...typography.caption },
  editButton: { marginTop: spacing.spaceLg, backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: 10, paddingHorizontal: spacing.spaceLg },
  editButtonText: { color: colors.onPrimary, ...typography.label },
  logoutButton: { marginTop: spacing.spaceLg + spacing.spaceXs, borderWidth: 1, borderColor: colors.danger, borderRadius: spacing.radiusControl, paddingVertical: 10, paddingHorizontal: spacing.spaceLg },
  logoutText: { color: colors.danger, ...typography.label },
});
