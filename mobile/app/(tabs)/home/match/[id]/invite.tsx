// mobile/app/(tabs)/home/match/[id]/invite.tsx
import { View, Text, FlatList, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useInvitableFriends } from '@/hooks/useInvitableFriends';
import { useMatchDetail } from '@/hooks/useMatchDetail';
import { useSessionStore } from '@/stores/sessionStore';

export default function InviteFriendsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = useSessionStore((s) => s.session?.user.id);
  const { match } = useMatchDetail(id);
  const { friends, loading, error, invite, inviting, refresh } = useInvitableFriends(id);

  if (loading && friends.length === 0) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // Defense-in-depth: the only other creator check for this feature lives on
  // the "Invita amici" button in match/[id]/index.tsx, so this route is
  // otherwise reachable via a hand-crafted deep link by any signed-in user.
  // Gated on `match` being loaded (not just falsy) so we don't flash this
  // message during the transient window before useMatchDetail resolves --
  // while match is still null we fall through to the loading/friends-list
  // rendering below, which is harmless for a non-creator (their own
  // useInvitableFriends call just returns their own empty list).
  if (match && match.creator_id !== userId) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.subtitle}>Non puoi invitare amici a questa partita.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <Pressable onPress={() => router.back()}>
        <Text style={styles.backLink}>← Torna alla partita</Text>
      </Pressable>
      <Text style={styles.header}>Invita amici</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={friends}
        keyExtractor={(item) => item.user_id}
        renderItem={({ item }) => (
          <View style={styles.friendRow}>
            <Text style={styles.friendName}>
              {item.first_name} {item.last_name}
            </Text>
            <Pressable style={styles.inviteButton} disabled={inviting} onPress={() => invite(item.user_id)}>
              {inviting ? <ActivityIndicator color="#fff" /> : <Text style={styles.inviteButtonText}>Invita</Text>}
            </Pressable>
          </View>
        )}
        contentContainerStyle={styles.list}
        onRefresh={refresh}
        refreshing={loading}
        ListEmptyComponent={!error ? <Text style={styles.subtitle}>Nessun amico da invitare.</Text> : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  backLink: { color: '#1a7f37', marginBottom: 8 },
  header: { fontSize: 22, fontWeight: '700', marginBottom: 12 },
  error: { color: '#c0392b', marginBottom: 8 },
  subtitle: { color: '#666', textAlign: 'center', marginTop: 24 },
  list: { paddingBottom: 24 },
  friendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  friendName: { fontSize: 16, fontWeight: '600' },
  inviteButton: { backgroundColor: '#1a7f37', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16, minWidth: 80, alignItems: 'center' },
  inviteButtonText: { color: '#fff', fontWeight: '600' },
});
