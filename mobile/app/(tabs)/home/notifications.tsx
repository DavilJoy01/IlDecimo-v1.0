// mobile/app/(tabs)/home/notifications.tsx
import { View, Text, FlatList, ActivityIndicator, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors, typography, spacing } from '@/theme';
import { useNotifications } from '@/hooks/useNotifications';
import { useSessionStore } from '@/stores/sessionStore';
import { navigateForNotification } from '@/utils/notificationNavigation';
import type { AppNotification } from '@/api/notifications';

export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = useSessionStore((s) => s.session?.user.id);
  const { notifications, loading, error, markRead, refresh } = useNotifications();

  function handlePress(notification: AppNotification) {
    if (!notification.read_at) markRead(notification.id);
    navigateForNotification(notification, router, userId);
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
      <Pressable onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
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
        ListEmptyComponent={<Text style={styles.subtitle}>Silenzio stampa. Nessuna notizia dal campo.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, paddingHorizontal: spacing.spaceMd },
  centered: { backgroundColor: colors.background, flex: 1, alignItems: 'center', justifyContent: 'center' },
  backLink: { color: colors.primary, marginBottom: spacing.spaceXs },
  header: { ...typography.screenTitle, color: colors.ink, marginBottom: spacing.spaceSm },
  error: { color: colors.danger, marginBottom: spacing.spaceXs },
  list: { paddingBottom: spacing.spaceLg },
  item: { paddingVertical: spacing.spaceSm, borderBottomWidth: 1, borderBottomColor: colors.border },
  itemUnread: { backgroundColor: colors.primaryTint },
  message: { ...typography.body, color: colors.ink },
  date: { color: colors.muted, ...typography.caption, marginTop: 4 },
  subtitle: { color: colors.muted, textAlign: 'center', marginTop: spacing.spaceLg, ...typography.body },
});
