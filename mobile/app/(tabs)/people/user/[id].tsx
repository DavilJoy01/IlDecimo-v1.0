// mobile/app/(tabs)/people/user/[id].tsx
import { useEffect, useState } from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, StyleSheet, Alert, ScrollView, Image, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useUserMatchHistory } from '@/hooks/useUserMatchHistory';
import { useSessionStore } from '@/stores/sessionStore';
import { calculateAge, FOOT_LABELS, ROLE_LABELS } from '@/utils/profileDisplay';
import { findOrCreateConversation } from '@/api/privateMessages';
import { colors, typography, spacing, withPressed } from '@/theme';

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const ownUserId = useSessionStore((s) => s.session?.user.id);
  const { profile, status, loading, error, actionError, actionLoading, sendRequest, cancelRequest, accept, reject, removeFriend, block, unblock, report } =
    useUserProfile(id);
  const { matches: historyMatches, loading: historyLoading, loadingMore: historyLoadingMore, error: historyError, hasMore: historyHasMore, loadMore: loadMoreHistory, retry: retryHistory } =
    useUserMatchHistory(id);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [messageLoading, setMessageLoading] = useState(false);

  async function handleMessage() {
    if (!ownUserId) return;
    setMessageLoading(true);
    try {
      const conversationId = await findOrCreateConversation(ownUserId, id);
      router.push({ pathname: '/(tabs)/messages/[id]', params: { id: conversationId } });
    } catch (err) {
      Alert.alert('Errore', err instanceof Error ? err.message : 'Impossibile aprire la chat.');
    } finally {
      setMessageLoading(false);
    }
  }

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
        <Pressable style={withPressed(styles.backButton)} hitSlop={8} onPress={() => router.replace('/(tabs)/people')}>
          <Text style={styles.backButtonText}>← Torna indietro</Text>
        </Pressable>
      </View>
    );
  }

  function handleScroll({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
    const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
    if (distanceFromBottom < 200) loadMoreHistory();
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 24 }]}
      onScroll={handleScroll}
      scrollEventThrottle={200}
    >
      <Pressable hitSlop={8} onPress={() => router.replace('/(tabs)/people')}>
        <Text style={styles.backLink}>← Torna indietro</Text>
      </Pressable>

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

      {actionError && <Text style={styles.error}>{actionError}</Text>}

      <View style={styles.actions}>
        {status.kind === 'none' && (
          <Pressable style={withPressed(styles.primaryButton)} disabled={actionLoading} onPress={sendRequest}>
            {actionLoading ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.primaryButtonText}>Invia richiesta</Text>}
          </Pressable>
        )}
        {status.kind === 'pending_outgoing' && (
          <>
            <View style={styles.disabledButton}>
              <Text style={styles.disabledButtonText}>Richiesta inviata</Text>
            </View>
            <Pressable style={withPressed(styles.secondaryButton)} disabled={actionLoading} onPress={cancelRequest}>
              <Text style={styles.secondaryButtonText}>Annulla</Text>
            </Pressable>
          </>
        )}
        {status.kind === 'pending_incoming' && (
          <>
            <Pressable style={withPressed(styles.primaryButton)} disabled={actionLoading} onPress={accept}>
              <Text style={styles.primaryButtonText}>Accetta</Text>
            </Pressable>
            <Pressable style={withPressed(styles.secondaryButton)} disabled={actionLoading} onPress={reject}>
              <Text style={styles.secondaryButtonText}>Rifiuta</Text>
            </Pressable>
          </>
        )}
        {status.kind === 'friends' && (
          <>
            <View style={styles.disabledButton}>
              <Text style={styles.disabledButtonText}>Amici ✓</Text>
            </View>
            <Pressable style={withPressed(styles.secondaryButton)} disabled={actionLoading} onPress={confirmRemoveFriend}>
              <Text style={styles.secondaryButtonText}>Rimuovi amicizia</Text>
            </Pressable>
          </>
        )}
        {status.kind === 'blocked_by_me' && (
          <Pressable style={withPressed(styles.secondaryButton)} disabled={actionLoading} onPress={unblock}>
            <Text style={styles.secondaryButtonText}>Sblocca</Text>
          </Pressable>
        )}
      </View>

      {status.kind !== 'blocked_by_me' && (
        <Pressable style={withPressed(styles.messageButton)} disabled={messageLoading} onPress={handleMessage}>
          {messageLoading ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.messageButtonText}>💬 Messaggio</Text>}
        </Pressable>
      )}

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
              <Pressable style={withPressed(styles.primaryButton)} disabled={actionLoading || !reportReason.trim()} onPress={submitReport}>
                <Text style={styles.primaryButtonText}>Invia segnalazione</Text>
              </Pressable>
            </View>
          )}
          <Pressable disabled={actionLoading} onPress={confirmBlock}>
            <Text style={styles.blockLink}>Blocca</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.historySection}>
        <Text style={styles.historyTitle}>Storico partite</Text>
        {historyLoading ? (
          <ActivityIndicator size="small" />
        ) : historyError && historyMatches.length === 0 ? (
          <View style={styles.historyErrorRow}>
            <Text style={styles.error}>{historyError}</Text>
            <Pressable style={withPressed(styles.retryButton)} onPress={retryHistory}>
              <Text style={styles.retryButtonText}>Riprova</Text>
            </Pressable>
          </View>
        ) : historyMatches.length === 0 ? (
          <Text style={styles.historyEmpty}>Nessuna partita nello storico.</Text>
        ) : (
          <>
            {historyMatches.map((entry) => (
              <View key={entry.match_id} style={styles.historyRow}>
                <View style={styles.historyRowHeader}>
                  <Text style={styles.historyDate}>
                    {new Date(`${entry.match_date}T${entry.start_time}`).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                    {' · '}
                    {entry.start_time.slice(0, 5)}
                  </Text>
                  <View style={styles.historyTypeBadge}>
                    <Text style={styles.historyTypeBadgeText}>{entry.match_type}</Text>
                  </View>
                </View>
                <Text style={styles.historyField}>{entry.field_name} — {entry.address}</Text>
                <Text style={styles.historyRole}>
                  {entry.role === 'creator'
                    ? 'Partita creata'
                    : entry.outcome === 'left'
                      ? 'Partecipante (uscito prima della fine)'
                      : 'Partecipante'}
                </Text>
              </View>
            ))}
            {historyLoadingMore && <ActivityIndicator size="small" style={styles.historyLoadingMore} />}
            {historyError && historyMatches.length > 0 && (
              <View style={styles.historyErrorRow}>
                <Text style={styles.error}>{historyError}</Text>
                <Pressable style={withPressed(styles.retryButton)} onPress={loadMoreHistory}>
                  <Text style={styles.retryButtonText}>Riprova</Text>
                </Pressable>
              </View>
            )}
            {!historyHasMore && <Text style={styles.historyEnd}>Fine dello storico.</Text>}
          </>
        )}
      </View>
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
  container: { backgroundColor: colors.background, flexGrow: 1, alignItems: 'center', padding: spacing.spaceLg },
  centered: { backgroundColor: colors.background, flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.spaceLg, gap: spacing.spaceSm },
  backLink: { color: colors.primary, alignSelf: 'flex-start', marginBottom: spacing.spaceMd },
  backButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: 10, paddingHorizontal: 20, marginTop: spacing.spaceXs },
  backButtonText: { color: colors.onPrimary, ...typography.label },
  error: { color: colors.danger, marginBottom: spacing.spaceXs, textAlign: 'center' },
  avatar: { width: 88, height: 88, borderRadius: 44, marginBottom: spacing.spaceSm },
  avatarPlaceholder: { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: colors.onPrimary, fontFamily: 'Oswald_700Bold', fontSize: 36 },
  name: { ...typography.screenTitle },
  uniqueId: { color: colors.muted, marginBottom: spacing.spaceLg, ...typography.meta },
  statsRow: { flexDirection: 'row', gap: spacing.spaceLg, marginBottom: spacing.spaceMd },
  stat: { alignItems: 'center' },
  statValue: { ...typography.label, fontSize: 18 },
  statLabel: { color: colors.muted, ...typography.caption },
  actions: { flexDirection: 'row', gap: spacing.spaceSm, marginTop: spacing.spaceMd },
  messageButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: 12, alignItems: 'center', marginTop: spacing.spaceMd, width: '100%' },
  messageButtonText: { color: colors.onPrimary, ...typography.label, fontSize: 16 },
  primaryButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: 12, paddingHorizontal: 20, alignItems: 'center' },
  primaryButtonText: { color: colors.onPrimary, ...typography.label },
  secondaryButton: { backgroundColor: colors.danger, borderRadius: spacing.radiusControl, paddingVertical: 12, paddingHorizontal: 20, alignItems: 'center' },
  secondaryButtonText: { color: colors.onPrimary, ...typography.label },
  disabledButton: { backgroundColor: colors.border, borderRadius: spacing.radiusControl, paddingVertical: 12, paddingHorizontal: 20, alignItems: 'center' },
  disabledButtonText: { color: colors.mutedStrong, ...typography.label },
  moderation: { flexDirection: 'row', gap: spacing.spaceLg, marginTop: spacing.spaceLg + spacing.spaceXs, alignItems: 'center' },
  reportLink: { color: colors.muted, fontFamily: 'Archivo_600SemiBold', fontSize: 15 },
  blockLink: { color: colors.danger, fontFamily: 'Archivo_600SemiBold', fontSize: 15 },
  reportForm: { gap: spacing.spaceXs, width: '100%' },
  reportInput: { borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusControl, padding: spacing.spaceSm, minHeight: 80, textAlignVertical: 'top', ...typography.body },
  historySection: { width: '100%', marginTop: spacing.spaceLg, gap: spacing.spaceSm },
  historyTitle: { ...typography.label, fontSize: 18, marginBottom: spacing.spaceXs },
  historyEmpty: { color: colors.muted, ...typography.body },
  historyRow: { borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusCard, padding: spacing.spaceSm, gap: 4 },
  historyRowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  historyDate: { color: colors.ink, ...typography.body },
  historyTypeBadge: { backgroundColor: colors.primaryTint, borderRadius: spacing.radiusPill, paddingHorizontal: spacing.spaceSm, paddingVertical: 2 },
  historyTypeBadgeText: { color: colors.primary, ...typography.caption },
  historyField: { color: colors.muted, ...typography.meta },
  historyRole: { color: colors.ink, ...typography.caption },
  historyLoadingMore: { marginTop: spacing.spaceSm },
  historyErrorRow: { alignItems: 'center', gap: spacing.spaceXs },
  retryButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: 8, paddingHorizontal: spacing.spaceMd },
  retryButtonText: { color: colors.onPrimary, ...typography.label, fontSize: 14 },
  historyEnd: { color: colors.muted, textAlign: 'center', ...typography.caption, marginTop: spacing.spaceXs },
});
