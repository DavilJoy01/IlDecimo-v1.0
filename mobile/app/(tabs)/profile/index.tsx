import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useSessionStore } from '@/stores/sessionStore';
import { supabase } from '@/api/supabase';

const FOOT_LABELS: Record<string, string> = { left: 'Sinistro', right: 'Destro', both: 'Entrambi' };
const ROLE_LABELS: Record<string, string> = { player: 'Giocatore', goalkeeper: 'Portiere', both: 'Entrambi' };

function calculateAge(birthDate: string): number {
  const birth = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

export default function ProfileScreen() {
  const profile = useSessionStore((s) => s.profile);

  if (!profile) return null; // unreachable in practice: this screen is only mounted once status === 'signed-in'

  return (
    <View style={styles.container}>
      <View style={styles.avatarPlaceholder}>
        <Text style={styles.avatarInitial}>{profile.first_name.charAt(0)}</Text>
      </View>
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
  avatarPlaceholder: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#1a7f37', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarInitial: { color: '#fff', fontSize: 36, fontWeight: '700' },
  name: { fontSize: 22, fontWeight: '700' },
  uniqueId: { color: '#666', marginBottom: 24 },
  statsRow: { flexDirection: 'row', gap: 24, marginBottom: 16 },
  stat: { alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '700' },
  statLabel: { color: '#666', fontSize: 12 },
  logoutButton: { marginTop: 32, borderWidth: 1, borderColor: '#c0392b', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 24 },
  logoutText: { color: '#c0392b', fontWeight: '600' },
});
