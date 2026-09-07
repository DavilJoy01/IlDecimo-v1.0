// mobile/app/(tabs)/home/match/[id]/invite.tsx
import { View, Text, FlatList, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useInvitableFriends } from '@/hooks/useInvitableFriends';

export default function InviteFriendsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { friends, loading, error, invite, inviting } = useInvitableFriends(id);

  if (loading && friends.length === 0) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" />
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
        ListEmptyComponent={<Text style={styles.subtitle}>Nessun amico da invitare.</Text>}
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
