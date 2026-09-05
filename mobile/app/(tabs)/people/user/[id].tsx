// mobile/app/(tabs)/people/user/[id].tsx
import { useEffect, useState } from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, StyleSheet, Alert, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useSessionStore } from '@/stores/sessionStore';
import { calculateAge, FOOT_LABELS, ROLE_LABELS } from '@/utils/profileDisplay';

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const ownUserId = useSessionStore((s) => s.session?.user.id);
  const { profile, status, loading, error, actionError, actionLoading, sendRequest, cancelRequest, accept, reject, removeFriend, block, unblock, report } =
    useUserProfile(id);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');

  useEffect(() => {
    if (ownUserId && id === ownUserId) {
      router.replace('/(tabs)/profile');
    }
  }, [ownUserId, id, router]);

  function confirmRemoveFriend() {
    Alert.alert('Rimuovi amicizia', 'Sei sicuro di voler rimuovere questa amicizia?', [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Rimuovi', style: 'destructive', onPress: () => removeFriend() },
    ]);
  }

  function confirmBlock() {
    Alert.alert('Blocca utente', 'Sei sicuro di voler bloccare questo utente? Verrà rimossa anche l\'eventuale amicizia.', [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Blocca', style: 'destructive', onPress: () => block() },
    ]);
  }

  async function submitReport() {
    const success = await report(reportReason.trim());
    if (success) {
      setReportOpen(false);
      setReportReason('');
      Alert.alert('Segnalazione inviata', 'Grazie per la segnalazione.');
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error ?? 'Utente non trovato.'}</Text>
        <Pressable style={styles.backButton} onPress={() => router.replace('/(tabs)/people')}>
          <Text style={styles.backButtonText}>← Torna indietro</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + 24 }]}>
      <Pressable onPress={() => router.replace('/(tabs)/people')}>
        <Text style={styles.backLink}>← Torna indietro</Text>
      </Pressable>

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

      {actionError && <Text style={styles.error}>{actionError}</Text>}

      <View style={styles.actions}>
        {status.kind === 'none' && (
          <Pressable style={styles.primaryButton} disabled={actionLoading} onPress={sendRequest}>
            {actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Invia richiesta</Text>}
          </Pressable>
        )}
        {status.kind === 'pending_outgoing' && (
          <>
            <View style={styles.disabledButton}>
              <Text style={styles.disabledButtonText}>Richiesta inviata</Text>
            </View>
            <Pressable style={styles.secondaryButton} disabled={actionLoading} onPress={cancelRequest}>
              <Text style={styles.secondaryButtonText}>Annulla</Text>
            </Pressable>
          </>
        )}
        {status.kind === 'pending_incoming' && (
          <>
            <Pressable style={styles.primaryButton} disabled={actionLoading} onPress={accept}>
              <Text style={styles.primaryButtonText}>Accetta</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} disabled={actionLoading} onPress={reject}>
              <Text style={styles.secondaryButtonText}>Rifiuta</Text>
            </Pressable>
          </>
        )}
        {status.kind === 'friends' && (
          <>
            <View style={styles.disabledButton}>
              <Text style={styles.disabledButtonText}>Amici ✓</Text>
            </View>
            <Pressable style={styles.secondaryButton} disabled={actionLoading} onPress={confirmRemoveFriend}>
              <Text style={styles.secondaryButtonText}>Rimuovi amicizia</Text>
            </Pressable>
          </>
        )}
        {status.kind === 'blocked_by_me' && (
          <Pressable style={styles.secondaryButton} disabled={actionLoading} onPress={unblock}>
            <Text style={styles.secondaryButtonText}>Sblocca</Text>
          </Pressable>
        )}
      </View>

      {status.kind !== 'blocked_by_me' && (
        <View style={styles.moderation}>
          {!reportOpen ? (
            <Pressable disabled={actionLoading} onPress={() => setReportOpen(true)}>
              <Text style={styles.reportLink}>Segnala</Text>
            </Pressable>
          ) : (
            <View style={styles.reportForm}>
              <TextInput
                style={styles.reportInput}
                value={reportReason}
                onChangeText={setReportReason}
                placeholder="Descrivi il motivo della segnalazione"
                multiline
                maxLength={1000}
              />
              <Pressable style={styles.primaryButton} disabled={actionLoading || !reportReason.trim()} onPress={submitReport}>
                <Text style={styles.primaryButtonText}>Invia segnalazione</Text>
              </Pressable>
            </View>
          )}
          <Pressable disabled={actionLoading} onPress={confirmBlock}>
            <Text style={styles.blockLink}>Blocca</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
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
  container: { flexGrow: 1, alignItems: 'center', padding: 24 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  backLink: { color: '#1a7f37', alignSelf: 'flex-start', marginBottom: 16 },
  backButton: { backgroundColor: '#1a7f37', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 20, marginTop: 8 },
  backButtonText: { color: '#fff', fontWeight: '600' },
  error: { color: '#c0392b', marginBottom: 8, textAlign: 'center' },
  avatarPlaceholder: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#1a7f37', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarInitial: { color: '#fff', fontSize: 36, fontWeight: '700' },
  name: { fontSize: 22, fontWeight: '700' },
  uniqueId: { color: '#666', marginBottom: 24 },
  statsRow: { flexDirection: 'row', gap: 24, marginBottom: 16 },
  stat: { alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '700' },
  statLabel: { color: '#666', fontSize: 12 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  primaryButton: { backgroundColor: '#1a7f37', borderRadius: 8, paddingVertical: 12, paddingHorizontal: 20, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '600' },
  secondaryButton: { backgroundColor: '#c0392b', borderRadius: 8, paddingVertical: 12, paddingHorizontal: 20, alignItems: 'center' },
  secondaryButtonText: { color: '#fff', fontWeight: '600' },
  disabledButton: { backgroundColor: '#eee', borderRadius: 8, paddingVertical: 12, paddingHorizontal: 20, alignItems: 'center' },
  disabledButtonText: { color: '#666', fontWeight: '600' },
  moderation: { flexDirection: 'row', gap: 24, marginTop: 32, alignItems: 'center' },
  reportLink: { color: '#666', fontWeight: '600' },
  blockLink: { color: '#c0392b', fontWeight: '600' },
  reportForm: { gap: 8, width: '100%' },
  reportInput: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, minHeight: 80, textAlignVertical: 'top' },
});
