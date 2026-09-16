// mobile/app/(tabs)/home/match/[id]/index.tsx
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
import { MatchMapView } from '@/components/MatchMapView';
import { openDirections } from '@/utils/mapLinks';
import { colors, typography, spacing, withPressed } from '@/theme';

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

  function confirmShuffle() {
    Alert.alert(
      'Dividi casualmente',
      'Questo rimescolerà casualmente tutte le squadre, sovrascrivendo eventuali assegnazioni già fatte. Continuare?',
      [
        { text: 'Annulla', style: 'cancel' },
        { text: 'Dividi', onPress: () => roster.shuffle() },
      ]
    );
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
        <Pressable style={withPressed(styles.backButton)} onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
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

  // Capacity is not enforced here: RLS means a non-participant viewer never
  // sees an accurate approvedParticipants count for this match (it's always
  // empty for them), so a real "match is full" check would need a new
  // backend RPC. Accepted as a known MVP limitation rather than shipping a
  // check that silently never fires for the one viewer it's meant to protect.
  const canRequest = match.status === 'open';
  const canAccessChat =
    isCreator || ['approved', 'active', 'completed'].includes(myParticipation.participation?.status ?? '');

  async function handleOpenDirections() {
    if (!match) return;
    try {
      await openDirections(match.latitude, match.longitude);
    } catch (err) {
      Alert.alert('Errore', err instanceof Error ? err.message : 'Impossibile aprire le indicazioni.');
    }
  }

  return (
    <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + 24 }]}>
      <Pressable onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.backLink}>← Torna alla Home</Text>
      </Pressable>
      <Text style={styles.title}>{match.field_name}</Text>
      <Text style={styles.meta}>⚽ Calcio a {match.match_type}</Text>
      <Text style={styles.meta}>📍 {match.address}</Text>
      <MatchMapView
        pins={[{ id: match.id, latitude: match.latitude, longitude: match.longitude }]}
        style={styles.detailMap}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
      />
      <Pressable style={withPressed(styles.directionsButton)} onPress={handleOpenDirections}>
        <Text style={styles.directionsButtonText}>Indicazioni</Text>
      </Pressable>
      <Text style={styles.meta}>
        {match.match_date} · {match.start_time.slice(0, 5)} → {match.end_time.slice(0, 5)}
      </Text>
      <Text style={styles.meta}>Massimo {match.max_players} giocatori</Text>
      {match.description && <Text style={styles.description}>{match.description}</Text>}
      {/* A failed delete (or any other mutation error while NOT editing)
          surfaces here, inline, on the same detail view -- it must never
          silently navigate away or swap in the generic not-found screen. */}
      {error && <Text style={styles.error}>{error}</Text>}
      {roster.error && <Text style={styles.error}>{roster.error}</Text>}

      {canAccessChat && (
        <Pressable
          testID="match-chat-button"
          style={withPressed(styles.chatButton)}
          onPress={() => router.push({ pathname: '/(tabs)/home/match/[id]/chat', params: { id } })}
        >
          <Text style={styles.chatButtonText}>💬 Chat</Text>
        </Pressable>
      )}

      {isCreator && (
        <View style={styles.actions}>
          <Pressable style={withPressed(styles.editButton)} onPress={() => setEditing(true)}>
            <Text style={styles.editButtonText}>Modifica</Text>
          </Pressable>
          <Pressable style={withPressed(styles.deleteButton)} onPress={confirmDelete} disabled={deleting}>
            {deleting ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.deleteButtonText}>Cancella partita</Text>}
          </Pressable>
        </View>
      )}

      {isCreator && canRequest && (
        <Pressable
          style={withPressed(styles.inviteButton)}
          onPress={() => router.push({ pathname: '/(tabs)/home/match/[id]/invite', params: { id } })}
        >
          <Text style={styles.inviteButtonText}>Invita amici</Text>
        </Pressable>
      )}

      {isCreator && roster.pendingRequests.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Richieste in attesa</Text>
          {roster.pendingRequests.map((profile) => (
            <ParticipantRow key={profile.participant_id} profile={profile}>
              <View style={styles.requestActions}>
                <Pressable
                  style={withPressed(styles.approveButton)}
                  disabled={roster.actionLoading}
                  onPress={() => roster.approve(profile.participant_id)}
                >
                  <Text style={styles.approveButtonText}>Approva</Text>
                </Pressable>
                <Pressable
                  style={withPressed(styles.rejectButton)}
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

          {isCreator && (
            <Pressable style={withPressed(styles.shuffleButton)} disabled={roster.actionLoading} onPress={confirmShuffle}>
              <Text style={styles.shuffleButtonText}>🔀 Dividi casualmente</Text>
            </Pressable>
          )}

          {roster.teamAParticipants.length > 0 && (
            <View style={styles.teamGroup}>
              <Text style={styles.teamGroupTitle}>Squadra A</Text>
              {roster.teamAParticipants.map((profile) => (
                <ParticipantRow key={profile.participant_id} profile={profile}>
                  {isCreator && (
                    <View style={styles.teamChips}>
                      <Pressable
                        style={withPressed(styles.teamChipActive)}
                        disabled={roster.actionLoading}
                        onPress={() => roster.assignParticipantTeam(profile.participant_id, null)}
                      >
                        <Text style={styles.teamChipTextActive}>A</Text>
                      </Pressable>
                      <Pressable
                        style={withPressed([styles.teamChip, roster.teamBParticipants.length >= match.match_type && styles.teamChipDisabled])}
                        disabled={roster.actionLoading || roster.teamBParticipants.length >= match.match_type}
                        onPress={() => roster.assignParticipantTeam(profile.participant_id, 'B')}
                      >
                        <Text style={styles.teamChipText}>B</Text>
                      </Pressable>
                    </View>
                  )}
                </ParticipantRow>
              ))}
            </View>
          )}

          {roster.teamBParticipants.length > 0 && (
            <View style={styles.teamGroup}>
              <Text style={styles.teamGroupTitle}>Squadra B</Text>
              {roster.teamBParticipants.map((profile) => (
                <ParticipantRow key={profile.participant_id} profile={profile}>
                  {isCreator && (
                    <View style={styles.teamChips}>
                      <Pressable
                        style={withPressed([styles.teamChip, roster.teamAParticipants.length >= match.match_type && styles.teamChipDisabled])}
                        disabled={roster.actionLoading || roster.teamAParticipants.length >= match.match_type}
                        onPress={() => roster.assignParticipantTeam(profile.participant_id, 'A')}
                      >
                        <Text style={styles.teamChipText}>A</Text>
                      </Pressable>
                      <Pressable
                        style={withPressed(styles.teamChipActive)}
                        disabled={roster.actionLoading}
                        onPress={() => roster.assignParticipantTeam(profile.participant_id, null)}
                      >
                        <Text style={styles.teamChipTextActive}>B</Text>
                      </Pressable>
                    </View>
                  )}
                </ParticipantRow>
              ))}
            </View>
          )}

          <View style={styles.teamGroup}>
            <Text style={styles.teamGroupTitle}>Non assegnati</Text>
            {roster.unassignedParticipants.length === 0 ? (
              <Text style={styles.teamGroupEmpty}>Nessuno</Text>
            ) : (
              roster.unassignedParticipants.map((profile) => (
                <ParticipantRow key={profile.participant_id} profile={profile}>
                  {isCreator && (
                    <View style={styles.teamChips}>
                      <Pressable
                        style={withPressed([styles.teamChip, roster.teamAParticipants.length >= match.match_type && styles.teamChipDisabled])}
                        disabled={roster.actionLoading || roster.teamAParticipants.length >= match.match_type}
                        onPress={() => roster.assignParticipantTeam(profile.participant_id, 'A')}
                      >
                        <Text style={styles.teamChipText}>A</Text>
                      </Pressable>
                      <Pressable
                        style={withPressed([styles.teamChip, roster.teamBParticipants.length >= match.match_type && styles.teamChipDisabled])}
                        disabled={roster.actionLoading || roster.teamBParticipants.length >= match.match_type}
                        onPress={() => roster.assignParticipantTeam(profile.participant_id, 'B')}
                      >
                        <Text style={styles.teamChipText}>B</Text>
                      </Pressable>
                    </View>
                  )}
                </ParticipantRow>
              ))
            )}
          </View>
        </View>
      )}

      {!isCreator && (
        <View style={styles.section}>
          {myParticipation.error && <Text style={styles.error}>{myParticipation.error}</Text>}
          {!myParticipation.loading && !myParticipation.participation && canRequest && (
            <Pressable style={withPressed(styles.requestButton)} disabled={myParticipation.actionLoading} onPress={() => myParticipation.requestJoin()}>
              {myParticipation.actionLoading ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.requestButtonText}>Richiedi di partecipare</Text>}
            </Pressable>
          )}
          {myParticipation.participation?.status === 'requested' && (
            <Text style={styles.statusText}>Richiesta in attesa di approvazione</Text>
          )}
          {(myParticipation.participation?.status === 'approved' || myParticipation.participation?.status === 'active') && (
            <View>
              <Text style={styles.statusTextSuccess}>Sei dentro ✅</Text>
              <Pressable style={withPressed(styles.leaveButton)} disabled={myParticipation.actionLoading} onPress={confirmLeave}>
                {myParticipation.actionLoading ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.leaveButtonText}>Abbandona partita</Text>}
              </Pressable>
            </View>
          )}
          {myParticipation.participation?.status === 'rejected' && (
            <Text style={styles.statusText}>La tua richiesta è stata rifiutata</Text>
          )}
          {myParticipation.participation?.status === 'left' && (
            <View>
              <Text style={styles.statusText}>Hai lasciato questa partita</Text>
              {myParticipation.participation.leave_count < 2 && canRequest && (
                <Pressable style={withPressed(styles.requestButton)} disabled={myParticipation.actionLoading} onPress={() => myParticipation.requestAgain()}>
                  {myParticipation.actionLoading ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.requestButtonText}>Richiedi di nuovo</Text>}
                </Pressable>
              )}
            </View>
          )}
          {myParticipation.participation?.status === 'completed' && (
            <Text style={styles.statusText}>Questa partita è terminata</Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, paddingHorizontal: spacing.spaceLg, paddingBottom: spacing.spaceLg, gap: spacing.spaceXs },
  centered: { backgroundColor: colors.background, flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.spaceLg, gap: spacing.spaceSm },
  backLink: { color: colors.primary, marginBottom: spacing.spaceXs },
  backButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: 10, paddingHorizontal: 20, marginTop: spacing.spaceXs },
  backButtonText: { color: colors.onPrimary, ...typography.label },
  title: { ...typography.label, fontSize: 24, color: colors.ink },
  meta: { color: colors.ink, ...typography.body },
  detailMap: { height: 180, borderRadius: spacing.radiusCard, overflow: 'hidden', marginTop: spacing.spaceXs },
  directionsButton: { backgroundColor: colors.primaryTint, borderRadius: spacing.radiusControl, paddingVertical: 10, alignItems: 'center', marginTop: spacing.spaceXs },
  directionsButtonText: { color: colors.primary, ...typography.label, fontSize: 15 },
  description: { color: colors.ink, marginTop: spacing.spaceXs, ...typography.body },
  error: { color: colors.danger, textAlign: 'center' },
  chatButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: 12, alignItems: 'center', marginTop: spacing.spaceXs },
  chatButtonText: { color: colors.onPrimary, ...typography.label, fontSize: 16 },
  actions: { marginTop: spacing.spaceLg, gap: spacing.spaceSm },
  editButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, padding: 14, alignItems: 'center' },
  editButtonText: { color: colors.onPrimary, ...typography.label, fontSize: 16 },
  deleteButton: { backgroundColor: colors.danger, borderRadius: spacing.radiusControl, padding: 14, alignItems: 'center' },
  deleteButtonText: { color: colors.onPrimary, ...typography.label, fontSize: 16 },
  inviteButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, padding: 14, alignItems: 'center', marginTop: spacing.spaceSm },
  inviteButtonText: { color: colors.onPrimary, ...typography.label, fontSize: 16 },
  section: { marginTop: spacing.spaceLg, gap: 4 },
  sectionTitle: { ...typography.label, fontSize: 16, color: colors.ink, marginBottom: 4 },
  shuffleButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: spacing.spaceXs, paddingHorizontal: spacing.spaceSm, alignSelf: 'flex-start', marginBottom: spacing.spaceXs },
  shuffleButtonText: { color: colors.onPrimary, ...typography.label },
  teamGroup: { marginTop: spacing.spaceSm, gap: 4 },
  teamGroupTitle: { ...typography.label, fontSize: 14, color: colors.muted },
  teamGroupEmpty: { color: colors.muted, ...typography.body },
  teamChips: { flexDirection: 'row', gap: spacing.spaceXs },
  teamChip: { borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusControl, paddingVertical: 4, paddingHorizontal: spacing.spaceSm },
  teamChipDisabled: { opacity: 0.4 },
  teamChipText: { color: colors.ink, ...typography.label, fontSize: 13 },
  teamChipActive: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: 4, paddingHorizontal: spacing.spaceSm },
  teamChipTextActive: { color: colors.onPrimary, ...typography.label, fontSize: 13 },
  requestActions: { flexDirection: 'row', gap: spacing.spaceXs },
  approveButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: spacing.spaceXs, paddingHorizontal: spacing.spaceSm },
  approveButtonText: { color: colors.onPrimary, ...typography.label },
  rejectButton: { backgroundColor: colors.danger, borderRadius: spacing.radiusControl, paddingVertical: spacing.spaceXs, paddingHorizontal: spacing.spaceSm },
  rejectButtonText: { color: colors.onPrimary, ...typography.label },
  requestButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, padding: 14, alignItems: 'center', marginTop: spacing.spaceXs },
  requestButtonText: { color: colors.onPrimary, ...typography.label, fontSize: 16 },
  leaveButton: { backgroundColor: colors.danger, borderRadius: spacing.radiusControl, padding: 14, alignItems: 'center', marginTop: spacing.spaceSm },
  leaveButtonText: { color: colors.onPrimary, ...typography.label, fontSize: 16 },
  statusText: { color: colors.ink, ...typography.body },
  statusTextSuccess: { color: colors.primary, ...typography.label, fontSize: 16 },
});
