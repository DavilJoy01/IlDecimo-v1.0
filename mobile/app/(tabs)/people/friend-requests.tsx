// mobile/app/(tabs)/people/friend-requests.tsx
import { View, Text, FlatList, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFriendRequests } from '@/hooks/useFriendRequests';
import type { FriendRequest } from '@/api/friendships';
import { colors, typography, spacing, withPressed } from '@/theme';

export default function FriendRequestsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const requests = useFriendRequests();

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <Pressable onPress={() => router.replace('/(tabs)/people')} hitSlop={8}>
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
                <Pressable style={withPressed(styles.acceptButton)} disabled={requests.loading} onPress={() => requests.accept(item.id)}>
                  <Text style={styles.acceptButtonText}>Accetta</Text>
                </Pressable>
                <Pressable style={withPressed(styles.rejectButton)} disabled={requests.loading} onPress={() => requests.reject(item.id)}>
                  <Text style={styles.rejectButtonText}>Rifiuta</Text>
                </Pressable>
              </RequestRow>
            )}
            ListEmptyComponent={<Text style={styles.subtitle}>Nessuno bussa, per ora.</Text>}
          />

          <Text style={styles.sectionTitle}>Inviate</Text>
          <FlatList
            data={requests.outgoing}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <RequestRow request={item}>
                <Pressable style={withPressed(styles.cancelButton)} disabled={requests.loading} onPress={() => requests.cancel(item.id)}>
                  <Text style={styles.cancelButtonText}>Annulla</Text>
                </Pressable>
              </RequestRow>
            )}
            ListEmptyComponent={<Text style={styles.subtitle}>Non hai ancora chiamato nessuno in squadra.</Text>}
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
  container: { backgroundColor: colors.background, flex: 1, paddingHorizontal: spacing.spaceMd },
  backLink: { color: colors.primary, marginBottom: spacing.spaceXs },
  header: { ...typography.screenTitle, color: colors.ink, marginBottom: spacing.spaceSm },
  error: { color: colors.danger, marginBottom: spacing.spaceXs },
  subtitle: { color: colors.muted, marginBottom: spacing.spaceMd, ...typography.body },
  sectionTitle: { ...typography.label, fontSize: 18, color: colors.ink, marginTop: spacing.spaceXs, marginBottom: spacing.spaceXs },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.spaceSm, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowInfo: { flex: 1 },
  rowName: { ...typography.label, color: colors.ink },
  rowCode: { color: colors.muted, ...typography.meta, marginTop: 2 },
  rowActions: { flexDirection: 'row', gap: spacing.spaceXs },
  acceptButton: { backgroundColor: colors.primary, borderRadius: 6, paddingVertical: 6, paddingHorizontal: spacing.spaceSm },
  acceptButtonText: { color: colors.onPrimary, fontFamily: 'Archivo_600SemiBold', fontSize: 13 },
  rejectButton: { backgroundColor: colors.danger, borderRadius: 6, paddingVertical: 6, paddingHorizontal: spacing.spaceSm },
  rejectButtonText: { color: colors.onPrimary, fontFamily: 'Archivo_600SemiBold', fontSize: 13 },
  cancelButton: { backgroundColor: colors.muted, borderRadius: 6, paddingVertical: 6, paddingHorizontal: spacing.spaceSm },
  cancelButtonText: { color: colors.surface, fontFamily: 'Archivo_600SemiBold', fontSize: 13 },
});
