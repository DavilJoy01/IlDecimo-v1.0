import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMatchDetail } from '@/hooks/useMatchDetail';
import { useSessionStore } from '@/stores/sessionStore';
import { MatchForm, type MatchFormValues } from '@/components/MatchForm';

export default function MatchDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = useSessionStore((s) => s.session?.user.id);
  const { match, loading, error, update, remove } = useMatchDetail(id);
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
  // populated across those failures (Task 2's own contract). Gating on
  // `!match` alone (not `error || !match`) is what keeps a failed edit on
  // the edit form and a failed delete on the detail view, instead of both
  // ejecting the user to this generic screen.
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
});
