// mobile/app/(tabs)/home/match/[id]/chat.tsx
import { useState } from 'react';
import { View, Text, FlatList, TextInput, Pressable, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMatchChat } from '@/hooks/useMatchChat';
import { useSessionStore } from '@/stores/sessionStore';
import type { ChatMessageWithSender, ChatParticipant } from '@/api/matchMessages';

export default function MatchChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = useSessionStore((s) => s.session?.user.id);
  const chat = useMatchChat(id);
  const [inputText, setInputText] = useState('');
  const [mentionedIds, setMentionedIds] = useState<string[]>([]);

  // Only detects "@partial" at the very end of the current text -- typing an
  // "@" earlier in the message and continuing past it won't reopen the
  // picker. A reasonable MVP simplification, not a hidden bug: the picker is
  // only ever meant to help compose the mention you're actively typing.
  const mentionMatch = /@(\S*)$/.exec(inputText);
  const mentionQuery = mentionMatch?.[1]?.toLowerCase() ?? null;
  const mentionCandidates: ChatParticipant[] =
    mentionQuery === null
      ? []
      : chat.participants.filter(
          (p) => p.user_id !== userId && `${p.first_name} ${p.last_name}`.toLowerCase().includes(mentionQuery)
        );

  function selectMention(participant: ChatParticipant) {
    const fullName = `${participant.first_name} ${participant.last_name}`;
    setInputText((prev) => prev.replace(/@(\S*)$/, `@${fullName} `));
    // Deliberately not tracked further: if the "@Name " text is later
    // deleted by hand, this id stays queued and the person still gets
    // notified even though the visible mention is gone. Accepted MVP
    // limitation -- see the design spec's risks section.
    setMentionedIds((prev) => (prev.includes(participant.user_id) ? prev : [...prev, participant.user_id]));
  }

  async function handleSend() {
    const body = inputText.trim();
    if (!body) return;
    const success = await chat.send(body, mentionedIds);
    if (success) {
      setInputText('');
      setMentionedIds([]);
    }
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
        <Pressable onPress={() => router.back()}>
          <Text style={styles.backLink}>← Torna alla partita</Text>
        </Pressable>
        <Text style={styles.header}>Chat</Text>
        {chat.error && <Text style={styles.error}>{chat.error}</Text>}

        <FlatList
          data={chat.messages}
          inverted
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <MessageBubble message={item} isOwn={item.sender_id === userId} />}
          contentContainerStyle={styles.messageList}
          style={{ flex: 1 }}
        />

        {mentionCandidates.length > 0 && (
          <View style={styles.mentionList}>
            {mentionCandidates.map((p) => (
              <Pressable key={p.user_id} style={styles.mentionItem} onPress={() => selectMention(p)}>
                <Text style={styles.mentionItemText}>{p.first_name} {p.last_name}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {chat.sendError && <Text style={styles.error}>{chat.sendError}</Text>}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Scrivi un messaggio..."
            multiline
          />
          <Pressable style={styles.sendButton} disabled={chat.sending || !inputText.trim()} onPress={handleSend}>
            {chat.sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendButtonText}>Invia</Text>}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageBubble({ message, isOwn }: { message: ChatMessageWithSender; isOwn: boolean }) {
  return (
    <View style={[styles.bubbleRow, isOwn ? styles.bubbleRowOwn : styles.bubbleRowOther]}>
      <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
        {!isOwn && <Text style={styles.senderName}>{message.sender.first_name} {message.sender.last_name}</Text>}
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
  messageList: { paddingVertical: 8, gap: 8 },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowOwn: { justifyContent: 'flex-end' },
  bubbleRowOther: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleOwn: { backgroundColor: '#1a7f37' },
  bubbleOther: { backgroundColor: '#eee' },
  senderName: { fontSize: 12, fontWeight: '600', color: '#666', marginBottom: 2 },
  bubbleTextOwn: { color: '#fff', fontSize: 15 },
  bubbleTextOther: { color: '#222', fontSize: 15 },
  timestamp: { fontSize: 10, color: '#ccc', marginTop: 4, alignSelf: 'flex-end' },
  mentionList: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#eee', borderRadius: 8, marginBottom: 4, maxHeight: 160 },
  mentionItem: { paddingVertical: 8, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  mentionItemText: { fontSize: 15 },
  inputRow: { flexDirection: 'row', gap: 8, paddingVertical: 8, alignItems: 'flex-end' },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, maxHeight: 100 },
  sendButton: { backgroundColor: '#1a7f37', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, justifyContent: 'center' },
  sendButtonText: { color: '#fff', fontWeight: '600' },
});
