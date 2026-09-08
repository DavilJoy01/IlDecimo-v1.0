// mobile/app/(tabs)/messages/[id].tsx
import { useCallback, useState } from 'react';
import { View, Text, FlatList, TextInput, Pressable, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { usePrivateMessages } from '@/hooks/usePrivateMessages';
import { useSessionStore } from '@/stores/sessionStore';
import type { PrivateMessage } from '@/api/privateMessages';
import { colors, typography, spacing, withPressed } from '@/theme';

export default function PrivateChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = useSessionStore((s) => s.session?.user.id);
  const chat = usePrivateMessages(id);
  const [inputText, setInputText] = useState('');

  // Re-marks the conversation read (via chat.refresh, which both re-fetches
  // and calls markConversationRead) each time this screen regains focus --
  // not just on first mount -- so messages received while the user was on
  // a different tab get marked read on return. Matches the established
  // useFocusEffect + hook-refresh pattern already used elsewhere in this
  // codebase (e.g. my-matches/index.tsx).
  useFocusEffect(
    useCallback(() => {
      chat.refresh();
    }, [chat.refresh])
  );

  async function handleSend() {
    const body = inputText.trim();
    if (!body) return;
    const success = await chat.send(body);
    if (success) setInputText('');
  }

  if (chat.loading && chat.messages.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top}
    >
      <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.replace('/(tabs)/messages')} hitSlop={8}>
          <Text style={styles.backLink}>← Torna ai messaggi</Text>
        </Pressable>
        <Text style={styles.header}>{chat.otherUser ? `${chat.otherUser.first_name} ${chat.otherUser.last_name}` : 'Chat'}</Text>
        {chat.error && (
          <View>
            <Text style={styles.error}>{chat.error}</Text>
            <Pressable style={withPressed(styles.retryButton)} onPress={() => chat.refresh()}>
              <Text style={styles.retryButtonText}>Riprova</Text>
            </Pressable>
          </View>
        )}

        <FlatList
          data={chat.messages}
          inverted
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <MessageBubble message={item} isOwn={item.sender_id === userId} />}
          contentContainerStyle={styles.messageList}
          style={{ flex: 1 }}
        />

        {chat.sendError && <Text style={styles.error}>{chat.sendError}</Text>}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Scrivi un messaggio..."
            multiline
            maxLength={2000}
          />
          <Pressable style={withPressed(styles.sendButton)} disabled={chat.sending || !inputText.trim()} onPress={handleSend}>
            {chat.sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendButtonText}>Invia</Text>}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageBubble({ message, isOwn }: { message: PrivateMessage; isOwn: boolean }) {
  return (
    <View style={[styles.bubbleRow, isOwn ? styles.bubbleRowOwn : styles.bubbleRowOther]}>
      <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
        <Text style={isOwn ? styles.bubbleTextOwn : styles.bubbleTextOther}>{message.body}</Text>
        <Text style={isOwn ? styles.timestampOwn : styles.timestampOther}>{new Date(message.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, paddingHorizontal: spacing.spaceMd },
  centered: { backgroundColor: colors.background, flex: 1, alignItems: 'center', justifyContent: 'center' },
  backLink: { color: colors.primary, marginBottom: spacing.spaceXs },
  header: { ...typography.screenTitle, marginBottom: spacing.spaceXs },
  error: { color: colors.danger, marginBottom: spacing.spaceXs },
  retryButton: { alignSelf: 'flex-start', backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: spacing.spaceXs, paddingHorizontal: spacing.spaceMd, marginBottom: spacing.spaceXs },
  retryButtonText: { color: colors.onPrimary, ...typography.label },
  messageList: { paddingVertical: spacing.spaceXs, gap: spacing.spaceXs },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowOwn: { justifyContent: 'flex-end' },
  bubbleRowOther: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', borderRadius: spacing.radiusCard, paddingHorizontal: spacing.spaceSm, paddingVertical: spacing.spaceXs },
  bubbleOwn: { backgroundColor: colors.primary },
  bubbleOther: { backgroundColor: colors.border },
  bubbleTextOwn: { color: colors.onPrimary, ...typography.body },
  bubbleTextOther: { color: colors.ink, ...typography.body },
  timestampOwn: { fontSize: 10, color: colors.primaryTint, marginTop: 4, alignSelf: 'flex-end' },
  timestampOther: { fontSize: 10, color: colors.muted, marginTop: 4, alignSelf: 'flex-end' },
  inputRow: { flexDirection: 'row', gap: spacing.spaceXs, paddingVertical: spacing.spaceXs, alignItems: 'flex-end' },
  input: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusPill, paddingHorizontal: spacing.spaceMd, paddingVertical: 10, maxHeight: 100, ...typography.body },
  sendButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusPill, paddingHorizontal: spacing.spaceMd, paddingVertical: 10, justifyContent: 'center' },
  sendButtonText: { color: colors.onPrimary, ...typography.label },
});
