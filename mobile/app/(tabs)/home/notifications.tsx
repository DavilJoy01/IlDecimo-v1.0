// mobile/app/(tabs)/home/notifications.tsx
import { View, Text, FlatList, ActivityIndicator, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useNotifications } from '@/hooks/useNotifications';
import type { AppNotification } from '@/api/notifications';

export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { notifications, loading, error, markRead, refresh } = useNotifications();

  function handlePress(notification: AppNotification) {
    if (!notification.read_at) markRead(notification.id);

    if (notification.type === 'friend_request_received') {
      router.push('/(tabs)/people/friend-requests');
      return;
    }
    if (notification.type === 'friend_request_approved' || notification.type === 'friend_request_rejected') {
      const userId = notification.payload.user_id;
      if (typeof userId === 'string') {
        router.push({ pathname: '/(tabs)/people/user/[id]', params: { id: userId } });
      }
      return;
    }
    if (notification.type === 'private_message') {
      const conversationId = notification.payload.conversation_id;
      if (typeof conversationId === 'string') {
        router.push({ pathname: '/(tabs)/messages/[id]', params: { id: conversationId } });
      }
      return;
    }

    if (!notification.payload.match_id) return;
    const id = notification.payload.match_id;
    if (notification.type === 'match_message' || notification.type === 'match_message_mention') {
      router.push({ pathname: '/(tabs)/home/match/[id]/chat', params: { id } });
    } else {
      router.push({ pathname: '/(tabs)/home/match/[id]', params: { id } });
    }
  }

  if (loading && notifications.length === 0) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <Pressable onPress={() => router.back()}>
        <Text style={styles.backLink}>← Torna alla Home</Text>
      </Pressable>
      <Text style={styles.header}>Notifiche</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable style={[styles.item, !item.read_at && styles.itemUnread]} onPress={() => handlePress(item)}>
            <Text style={styles.message}>{item.payload.message}</Text>
            <Text style={styles.date}>{new Date(item.created_at).toLocaleString('it-IT')}</Text>
          </Pressable>
        )}
        contentContainerStyle={styles.list}
        onRefresh={refresh}
        refreshing={loading}
        ListEmptyComponent={<Text style={styles.subtitle}>Nessuna notifica.</Text>}
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
  list: { paddingBottom: 24 },
  item: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  itemUnread: { backgroundColor: '#f0f8f2' },
  message: { fontSize: 15 },
  date: { color: '#888', fontSize: 12, marginTop: 4 },
  subtitle: { color: '#666', textAlign: 'center', marginTop: 24 },
});
