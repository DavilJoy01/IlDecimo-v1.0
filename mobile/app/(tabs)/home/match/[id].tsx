// mobile/app/(tabs)/home/match/[id].tsx
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMatchDetail } from '@/hooks/useMatchDetail';
import { useMyParticipation } from '@/hooks/useMyParticipation';
import { useMatchRoster } from '@/hooks/useMatchRoster';
import { useSessionStore } from '@/stores/sessionStore';
import { MatchForm, type MatchFormValues } from '@/components/MatchForm';
import { ParticipantRow } from '@/components/ParticipantRow';

export default function MatchDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = useSessionStore((s) => s.session?.user.id);
  const { match, loading, error, update, remove } = useMatchDetail(id);
  const myParticipation = useMyParticipation(id);
  const roster = useMatchRoster(id);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isCreator = !!match && !!userId && match.creator_id === userId;

  async function handleSave(values: MatchFormValues) {
    setSaving(true);
    const success = await update({
      match_type: values.matchType,
      field_name: values.fieldName,
      address: values.address,
      match_date: values.matchDate,
      start_time: values.startTime,
      end_time: values.endTime,
      max_players: Number(values.maxPlayers),
      description: values.description || null,
    });
    setSaving(false);
    if (success) setEditing(false);
  }

  function confirmDelete() {
    Alert.alert('Cancella partita', 'Sei sicuro di voler cancellare questa partita?', [
      { text: 'Annulla', style: 'cancel' },
      {
        text: 'Cancella',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          const success = await remove();
          setDeleting(false);
          if (success) router.back();
        },
      },
    ]);
  }

  function confirmLeave() {
    Alert.alert('Abbandona partita', 'Sei sicuro di voler abbandonare questa partita?', [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Abbandona', style: 'destructive', onPress: () => myParticipation.leave() },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // Only the initial-fetch-never-succeeded case ("nothing to show at all")
  // routes here. A failed update/delete on an ALREADY-loaded match must NOT
  // hit this branch -- useMatchDetail's update()/remove() write failures into
  // the same `error` field the initial fetch uses, but `match` stays
  // populated across those failures. Gating on `!match` alone (not
  // `error || !match`) is what keeps a failed edit on the edit form and a
  // failed delete on the detail view, instead of both ejecting the user to
  // this generic screen.
  if (!match) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error ?? 'Partita non trovata.'}</Text>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>← Torna alla Home</Text>
        </Pressable>
      </View>
    );
  }

  if (editing) {
    return (
      <View style={{ flex: 1, paddingTop: insets.top }}>
        <MatchForm
          initialValues={{
            matchType: match.match_type,
            fieldName: match.field_name,
            address: match.address,
            matchDate: match.match_date,
            startTime: match.start_time.slice(0, 5),
            endTime: match.end_time.slice(0, 5),
            maxPlayers: String(match.max_players),
            description: match.description ?? '',
          }}
          onSubmit={handleSave}
          submitLabel="Salva modifiche"
          loading={saving}
          error={error}
        />
      </View>
    );
  }

  const isFull = match.max_players <= roster.approvedParticipants.length;
  const canRequest = match.status === 'open' && !isFull;

  return (
    <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + 24 }]}>
      <Pressable onPress={() => router.back()}>
        <Text style={styles.backLink}>← Torna alla Home</Text>
      </Pressable>
      <Text style={styles.title}>{match.field_name}</Text>
      <Text style={styles.meta}>⚽ Calcio a {match.match_type}</Text>
      <Text style={styles.meta}>📍 {match.address}</Text>
      <Text style={styles.meta}>
        {match.match_date} · {match.start_time.slice(0, 5)} → {match.end_time.slice(0, 5)}
      </Text>
      <Text style={styles.meta}>Massimo {match.max_players} giocatori</Text>
      {match.description && <Text style={styles.description}>{match.description}</Text>}
      {/* A failed delete (or any other mutation error while NOT editing)
          surfaces here, inline, on the same detail view -- it must never
          silently navigate away or swap in the generic not-found screen. */}
      {error && <Text style={styles.error}>{error}</Text>}

      {isCreator && (
        <View style={styles.actions}>
          <Pressable style={styles.editButton} onPress={() => setEditing(true)}>
            <Text style={styles.editButtonText}>Modifica</Text>
          </Pressable>
          <Pressable style={styles.deleteButton} onPress={confirmDelete} disabled={deleting}>
            {deleting ? <ActivityIndicator color="#fff" /> : <Text style={styles.deleteButtonText}>Cancella partita</Text>}
          </Pressable>
        </View>
      )}

      {isCreator && roster.pendingRequests.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Richieste in attesa</Text>
          {roster.error && <Text style={styles.error}>{roster.error}</Text>}
          {roster.pendingRequests.map((profile) => (
            <ParticipantRow key={profile.participant_id} profile={profile}>
              <View style={styles.requestActions}>
                <Pressable
                  style={styles.approveButton}
                  disabled={roster.actionLoading}
                  onPress={() => roster.approve(profile.participant_id)}
                >
                  <Text style={styles.approveButtonText}>Approva</Text>
                </Pressable>
                <Pressable
                  style={styles.rejectButton}
                  disabled={roster.actionLoading}
                  onPress={() => roster.reject(profile.participant_id)}
                >
                  <Text style={styles.rejectButtonText}>Rifiuta</Text>
                </Pressable>
              </View>
            </ParticipantRow>
          ))}
        </View>
      )}

      {roster.approvedParticipants.length > 0 && (isCreator || myParticipation.participation?.status === 'approved' || myParticipation.participation?.status === 'active') && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Partecipanti</Text>
          {roster.approvedParticipants.map((profile) => (
            <ParticipantRow key={profile.participant_id} profile={profile} />
          ))}
        </View>
      )}

      {!isCreator && (
        <View style={styles.section}>
          {myParticipation.error && <Text style={styles.error}>{myParticipation.error}</Text>}
          {!myParticipation.participation && canRequest && (
            <Pressable style={styles.requestButton} disabled={myParticipation.actionLoading} onPress={() => myParticipation.requestJoin()}>
              {myParticipation.actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.requestButtonText}>Richiedi di partecipare</Text>}
            </Pressable>
          )}
          {myParticipation.participation?.status === 'requested' && (
            <Text style={styles.statusText}>Richiesta in attesa di approvazione</Text>
          )}
          {(myParticipation.participation?.status === 'approved' || myParticipation.participation?.status === 'active') && (
            <View>
              <Text style={styles.statusTextSuccess}>Sei dentro ✅</Text>
              <Pressable style={styles.leaveButton} disabled={myParticipation.actionLoading} onPress={confirmLeave}>
                {myParticipation.actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.leaveButtonText}>Abbandona partita</Text>}
              </Pressable>
            </View>
          )}
          {myParticipation.participation?.status === 'rejected' && (
            <Text style={styles.statusText}>La tua richiesta è stata rifiutata</Text>
          )}
          {myParticipation.participation?.status === 'left' && (
            <View>
              <Text style={styles.statusText}>Hai lasciato questa partita</Text>
              {myParticipation.participation.leave_count < 2 && (
                <Pressable style={styles.requestButton} disabled={myParticipation.actionLoading} onPress={() => myParticipation.requestAgain()}>
                  {myParticipation.actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.requestButtonText}>Richiedi di nuovo</Text>}
                </Pressable>
              )}
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 24, paddingBottom: 24, gap: 8 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  backLink: { color: '#1a7f37', marginBottom: 8 },
  backButton: { backgroundColor: '#1a7f37', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 20, marginTop: 8 },
  backButtonText: { color: '#fff', fontWeight: '600' },
  title: { fontSize: 24, fontWeight: '700' },
  meta: { color: '#444', fontSize: 16 },
  description: { color: '#333', marginTop: 8 },
  error: { color: '#c0392b', textAlign: 'center' },
  actions: { marginTop: 24, gap: 12 },
  editButton: { backgroundColor: '#1a7f37', borderRadius: 8, padding: 14, alignItems: 'center' },
  editButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  deleteButton: { backgroundColor: '#c0392b', borderRadius: 8, padding: 14, alignItems: 'center' },
  deleteButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  section: { marginTop: 24, gap: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  requestActions: { flexDirection: 'row', gap: 8 },
  approveButton: { backgroundColor: '#1a7f37', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  approveButtonText: { color: '#fff', fontWeight: '600' },
  rejectButton: { backgroundColor: '#c0392b', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  rejectButtonText: { color: '#fff', fontWeight: '600' },
  requestButton: { backgroundColor: '#1a7f37', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
  requestButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  leaveButton: { backgroundColor: '#c0392b', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 12 },
  leaveButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  statusText: { color: '#444', fontSize: 15 },
  statusTextSuccess: { color: '#1a7f37', fontSize: 16, fontWeight: '600' },
});
