import { View, Text, StyleSheet, Pressable, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { useSessionStore } from '@/stores/sessionStore';
import { supabase } from '@/api/supabase';
import { calculateAge, FOOT_LABELS, ROLE_LABELS } from '@/utils/profileDisplay';

export default function ProfileScreen() {
  const router = useRouter();
  const profile = useSessionStore((s) => s.profile);

  if (!profile) return null; // unreachable in practice: this screen is only mounted once status === 'signed-in'

  return (
    <View style={styles.container}>
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

      <Pressable style={styles.editButton} onPress={() => router.push('/(tabs)/profile/edit')}>
        <Text style={styles.editButtonText}>Modifica profilo</Text>
      </Pressable>

      <Pressable style={styles.logoutButton} onPress={() => supabase.auth.signOut()}>
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
  container: { flex: 1, alignItems: 'center', padding: 24, paddingTop: 48 },
  avatar: { width: 88, height: 88, borderRadius: 44, marginBottom: 12 },
  avatarPlaceholder: { backgroundColor: '#1a7f37', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: '#fff', fontSize: 36, fontWeight: '700' },
  name: { fontSize: 22, fontWeight: '700' },
  uniqueId: { color: '#666', marginBottom: 24 },
  statsRow: { flexDirection: 'row', gap: 24, marginBottom: 16 },
  stat: { alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '700' },
  statLabel: { color: '#666', fontSize: 12 },
  editButton: { marginTop: 24, backgroundColor: '#1a7f37', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 24 },
  editButtonText: { color: '#fff', fontWeight: '600' },
  logoutButton: { marginTop: 32, borderWidth: 1, borderColor: '#c0392b', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 24 },
  logoutText: { color: '#c0392b', fontWeight: '600' },
});
