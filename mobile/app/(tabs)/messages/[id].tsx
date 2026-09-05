// mobile/app/(tabs)/messages/[id].tsx
import { useCallback, useState } from 'react';
import { View, Text, FlatList, TextInput, Pressable, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { usePrivateMessages } from '@/hooks/usePrivateMessages';
import { useSessionStore } from '@/stores/sessionStore';
import type { PrivateMessage } from '@/api/privateMessages';

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

  if (chat.loading) {
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
        <Pressable onPress={() => router.replace('/(tabs)/messages')}>
          <Text style={styles.backLink}>← Torna ai messaggi</Text>
        </Pressable>
        <Text style={styles.header}>{chat.otherUser ? `${chat.otherUser.first_name} ${chat.otherUser.last_name}` : 'Chat'}</Text>
        {chat.error && (
          <View>
            <Text style={styles.error}>{chat.error}</Text>
            <Pressable style={styles.retryButton} onPress={() => chat.refresh()}>
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
          <Pressable style={styles.sendButton} disabled={chat.sending || !inputText.trim()} onPress={handleSend}>
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
        <Text style={styles.timestamp}>{new Date(message.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  backLink: { color: '#1a7f37', marginBottom: 8 },
  header: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  error: { color: '#c0392b', marginBottom: 8 },
  retryButton: { alignSelf: 'flex-start', backgroundColor: '#1a7f37', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16, marginBottom: 8 },
  retryButtonText: { color: '#fff', fontWeight: '600' },
  messageList: { paddingVertical: 8, gap: 8 },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowOwn: { justifyContent: 'flex-end' },
  bubbleRowOther: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleOwn: { backgroundColor: '#1a7f37' },
  bubbleOther: { backgroundColor: '#eee' },
  bubbleTextOwn: { color: '#fff', fontSize: 15 },
  bubbleTextOther: { color: '#222', fontSize: 15 },
  timestamp: { fontSize: 10, color: '#ccc', marginTop: 4, alignSelf: 'flex-end' },
  inputRow: { flexDirection: 'row', gap: 8, paddingVertical: 8, alignItems: 'flex-end' },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, maxHeight: 100 },
  sendButton: { backgroundColor: '#1a7f37', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, justifyContent: 'center' },
  sendButtonText: { color: '#fff', fontWeight: '600' },
});
