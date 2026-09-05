// mobile/app/(tabs)/people/friend-requests.tsx
import { View, Text, FlatList, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFriendRequests } from '@/hooks/useFriendRequests';
import type { FriendRequest } from '@/api/friendships';

export default function FriendRequestsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const requests = useFriendRequests();

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <Pressable onPress={() => router.replace('/(tabs)/people')}>
        <Text style={styles.backLink}>← Torna a Persone</Text>
      </Pressable>
      <Text style={styles.header}>Richieste di amicizia</Text>
      {requests.error && <Text style={styles.error}>{requests.error}</Text>}
      {requests.loading && requests.incoming.length === 0 && requests.outgoing.length === 0 ? (
        <ActivityIndicator size="large" />
      ) : (
        <>
          <Text style={styles.sectionTitle}>Ricevute</Text>
          <FlatList
            data={requests.incoming}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <RequestRow request={item}>
                <Pressable style={styles.acceptButton} disabled={requests.loading} onPress={() => requests.accept(item.id)}>
                  <Text style={styles.acceptButtonText}>Accetta</Text>
                </Pressable>
                <Pressable style={styles.rejectButton} disabled={requests.loading} onPress={() => requests.reject(item.id)}>
                  <Text style={styles.rejectButtonText}>Rifiuta</Text>
                </Pressable>
              </RequestRow>
            )}
            ListEmptyComponent={<Text style={styles.subtitle}>Nessuna richiesta ricevuta.</Text>}
          />

          <Text style={styles.sectionTitle}>Inviate</Text>
          <FlatList
            data={requests.outgoing}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <RequestRow request={item}>
                <Pressable style={styles.cancelButton} disabled={requests.loading} onPress={() => requests.cancel(item.id)}>
                  <Text style={styles.cancelButtonText}>Annulla</Text>
                </Pressable>
              </RequestRow>
            )}
            ListEmptyComponent={<Text style={styles.subtitle}>Nessuna richiesta inviata.</Text>}
          />
        </>
      )}
    </View>
  );
}

function RequestRow({ request, children }: { request: FriendRequest; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowInfo}>
        <Text style={styles.rowName}>{request.user.first_name} {request.user.last_name}</Text>
        <Text style={styles.rowCode}>{request.user.unique_user_id}</Text>
      </View>
      <View style={styles.rowActions}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16 },
  backLink: { color: '#1a7f37', marginBottom: 8 },
  header: { fontSize: 22, fontWeight: '700', marginBottom: 12 },
  error: { color: '#c0392b', marginBottom: 8 },
  subtitle: { color: '#666', marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginTop: 8, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  rowInfo: { flex: 1 },
  rowName: { fontSize: 16, fontWeight: '600' },
  rowCode: { color: '#666', fontSize: 13, marginTop: 2 },
  rowActions: { flexDirection: 'row', gap: 8 },
  acceptButton: { backgroundColor: '#1a7f37', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 12 },
  acceptButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  rejectButton: { backgroundColor: '#c0392b', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 12 },
  rejectButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  cancelButton: { backgroundColor: '#888', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 12 },
  cancelButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
});
