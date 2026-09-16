// mobile/app/(tabs)/messages/index.tsx
import { useCallback } from 'react';
import { View, Text, FlatList, ActivityIndicator, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useConversations } from '@/hooks/useConversations';
import { colors, typography, spacing } from '@/theme';

export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { conversations, loading, error, refresh } = useConversations();

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  if (loading && conversations.length === 0) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <Text style={styles.header}>Messaggi</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.conversation_id}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => router.push({ pathname: '/(tabs)/messages/[id]', params: { id: item.conversation_id } })}
          >
            <Text style={[styles.name, item.unread && styles.unreadText]}>
              {item.other_user.first_name} {item.other_user.last_name}
            </Text>
            <Text style={[styles.preview, item.unread && styles.unreadText]} numberOfLines={1}>
              {item.last_message ? item.last_message.body : 'Nessun messaggio ancora.'}
            </Text>
            {item.last_message && (
              <Text style={styles.date}>{new Date(item.last_message.created_at).toLocaleString('it-IT')}</Text>
            )}
          </Pressable>
        )}
        contentContainerStyle={styles.list}
        onRefresh={refresh}
        refreshing={loading}
        ListEmptyComponent={<Text style={styles.subtitle}>Nessun messaggio ancora.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, paddingHorizontal: spacing.spaceMd },
  centered: { backgroundColor: colors.background, flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { ...typography.screenTitle, marginBottom: spacing.spaceSm },
  error: { color: colors.danger, marginBottom: spacing.spaceXs },
  subtitle: { color: colors.muted, textAlign: 'center', marginTop: spacing.spaceLg, ...typography.body },
  list: { paddingBottom: spacing.spaceLg },
  row: { paddingVertical: spacing.spaceSm, borderBottomWidth: 1, borderBottomColor: colors.border },
  name: typography.label,
  preview: { color: colors.muted, ...typography.body, fontSize: 14, marginTop: 2 },
  unreadText: { fontFamily: 'Archivo_600SemiBold', color: colors.ink },
  date: { color: colors.muted, ...typography.caption, marginTop: 2 },
});
