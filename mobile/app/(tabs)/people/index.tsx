// mobile/app/(tabs)/people/index.tsx
import { View, Text, TextInput, Pressable, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useUserSearch } from '@/hooks/useUserSearch';
import { useFriends } from '@/hooks/useFriends';
import { useFriendRequests } from '@/hooks/useFriendRequests';
import { colors, typography, spacing, withPressed } from '@/theme';

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
        <Pressable style={withPressed(styles.searchButton)} disabled={search.loading || !search.query.trim()} onPress={search.search}>
          {search.loading ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.searchButtonText}>Cerca</Text>}
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
  container: { backgroundColor: colors.background, flex: 1, paddingHorizontal: spacing.spaceMd },
  header: { ...typography.screenTitle, marginBottom: spacing.spaceSm },
  searchRow: { flexDirection: 'row', gap: spacing.spaceXs, marginBottom: spacing.spaceXs },
  searchInput: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusControl, paddingHorizontal: spacing.spaceSm, paddingVertical: 10, ...typography.body },
  searchButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingHorizontal: spacing.spaceMd, justifyContent: 'center' },
  searchButtonText: { color: colors.onPrimary, ...typography.label },
  error: { color: colors.danger, marginBottom: spacing.spaceXs },
  subtitle: { color: colors.muted, marginBottom: spacing.spaceXs, ...typography.body },
  resultCard: { borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusControl, padding: spacing.spaceSm, marginBottom: spacing.spaceMd },
  resultName: typography.label,
  resultCode: { color: colors.muted, ...typography.meta },
  resultLink: { color: colors.primary, marginTop: 4, fontFamily: 'WorkSans_600SemiBold', fontSize: 15 },
  requestsLink: { paddingVertical: spacing.spaceXs, marginBottom: spacing.spaceXs },
  requestsLinkText: { color: colors.primary, fontFamily: 'WorkSans_600SemiBold', fontSize: 15 },
  sectionTitle: { ...typography.label, fontSize: 18 },
  list: { paddingBottom: spacing.spaceLg },
  friendRow: { paddingVertical: spacing.spaceSm, borderBottomWidth: 1, borderBottomColor: colors.border },
  friendName: typography.label,
  friendCode: { color: colors.muted, ...typography.meta, marginTop: 2 },
});
