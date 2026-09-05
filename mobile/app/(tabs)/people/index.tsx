// mobile/app/(tabs)/people/index.tsx
import { View, Text, TextInput, Pressable, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useUserSearch } from '@/hooks/useUserSearch';
import { useFriends } from '@/hooks/useFriends';
import { useFriendRequests } from '@/hooks/useFriendRequests';

export default function PeopleScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const search = useUserSearch();
  const friends = useFriends();
  const requests = useFriendRequests();

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <Text style={styles.header}>Persone</Text>

      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          value={search.query}
          onChangeText={search.setQuery}
          placeholder="Cerca per codice (es. FC-100002)"
          autoCapitalize="characters"
        />
        <Pressable style={styles.searchButton} disabled={search.loading || !search.query.trim()} onPress={search.search}>
          {search.loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.searchButtonText}>Cerca</Text>}
        </Pressable>
      </View>
      {search.error && <Text style={styles.error}>{search.error}</Text>}
      {search.notFound && <Text style={styles.subtitle}>Nessun utente trovato.</Text>}
      {search.result && (
        <Pressable
          style={styles.resultCard}
          onPress={() => router.push({ pathname: '/(tabs)/people/user/[id]', params: { id: search.result!.user_id } })}
        >
          <Text style={styles.resultName}>{search.result.first_name} {search.result.last_name}</Text>
          <Text style={styles.resultCode}>{search.result.unique_user_id}</Text>
          <Text style={styles.resultLink}>Vedi profilo →</Text>
        </Pressable>
      )}

      <Pressable style={styles.requestsLink} onPress={() => router.push('/(tabs)/people/friend-requests')}>
        <Text style={styles.requestsLinkText}>
          Richieste di amicizia{requests.incoming.length > 0 ? ` (${requests.incoming.length})` : ''}
        </Text>
      </Pressable>

      <Text style={styles.sectionTitle}>I tuoi amici</Text>
      {friends.error && <Text style={styles.error}>{friends.error}</Text>}
      <FlatList
        data={friends.friends}
        keyExtractor={(item) => item.user_id}
        renderItem={({ item }) => (
          <Pressable
            style={styles.friendRow}
            onPress={() => router.push({ pathname: '/(tabs)/people/user/[id]', params: { id: item.user_id } })}
          >
            <Text style={styles.friendName}>{item.first_name} {item.last_name}</Text>
            <Text style={styles.friendCode}>{item.unique_user_id}</Text>
          </Pressable>
        )}
        contentContainerStyle={styles.list}
        onRefresh={friends.refresh}
        refreshing={friends.loading}
        ListEmptyComponent={!friends.loading ? <Text style={styles.subtitle}>Non hai ancora amici.</Text> : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16 },
  header: { fontSize: 22, fontWeight: '700', marginBottom: 12 },
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  searchInput: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  searchButton: { backgroundColor: '#1a7f37', borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center' },
  searchButtonText: { color: '#fff', fontWeight: '600' },
  error: { color: '#c0392b', marginBottom: 8 },
  subtitle: { color: '#666', marginBottom: 8 },
  resultCard: { borderWidth: 1, borderColor: '#eee', borderRadius: 8, padding: 12, marginBottom: 16 },
  resultName: { fontSize: 16, fontWeight: '600' },
  resultCode: { color: '#666', fontSize: 13 },
  resultLink: { color: '#1a7f37', marginTop: 4, fontWeight: '600' },
  requestsLink: { paddingVertical: 8, marginBottom: 8 },
  requestsLinkText: { color: '#1a7f37', fontWeight: '600' },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  list: { paddingBottom: 24 },
  friendRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  friendName: { fontSize: 16, fontWeight: '600' },
  friendCode: { color: '#666', fontSize: 13, marginTop: 2 },
});
