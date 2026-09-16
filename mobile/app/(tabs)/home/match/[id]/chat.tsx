// mobile/app/(tabs)/home/match/[id]/chat.tsx
import { useState } from 'react';
import { View, Text, FlatList, TextInput, Pressable, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMatchChat } from '@/hooks/useMatchChat';
import { useSessionStore } from '@/stores/sessionStore';
import { colors, typography, spacing, withPressed } from '@/theme';
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
        {/* Always navigates to the match detail explicitly, rather than
            router.back() -- this screen is also reachable directly from a
            notification tap (Task 8), where "back" would return to
            Notifications instead of the partita the label promises. */}
        <Pressable hitSlop={8} onPress={() => router.replace({ pathname: '/(tabs)/home/match/[id]', params: { id } })}>
          <Text style={styles.backLink}>← Torna alla partita</Text>
        </Pressable>
        <Text style={styles.header}>Spogliatoio</Text>
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
            testID="chat-message-input"
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Scrivi allo spogliatoio"
            placeholderTextColor={colors.muted}
            multiline
            maxLength={2000}
          />
          <Pressable testID="chat-send-button" style={withPressed(styles.sendButton)} disabled={chat.sending || !inputText.trim()} onPress={handleSend}>
            {chat.sending ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.sendButtonText}>Invia</Text>}
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
        <Text style={isOwn ? styles.timestampOwn : styles.timestampOther}>{new Date(message.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, paddingHorizontal: spacing.spaceMd },
  centered: { backgroundColor: colors.background, flex: 1, alignItems: 'center', justifyContent: 'center' },
  backLink: { color: colors.primary, marginBottom: spacing.spaceXs },
  header: { ...typography.screenTitle, color: colors.ink, marginBottom: spacing.spaceXs },
  error: { color: colors.danger, marginBottom: spacing.spaceXs },
  retryButton: { alignSelf: 'flex-start', backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: spacing.spaceXs, paddingHorizontal: spacing.spaceMd, marginBottom: spacing.spaceXs },
  retryButtonText: { color: colors.onPrimary, ...typography.label },
  messageList: { paddingVertical: spacing.spaceXs, gap: spacing.spaceXs },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowOwn: { justifyContent: 'flex-end' },
  bubbleRowOther: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', borderRadius: spacing.radiusCard, borderWidth: 1, paddingHorizontal: spacing.spaceSm, paddingVertical: spacing.spaceXs },
  bubbleOwn: { backgroundColor: '#175B44', borderColor: 'rgba(63,163,77,0.55)' },
  bubbleOther: { backgroundColor: colors.surface, borderColor: colors.border },
  senderName: { ...typography.caption, color: colors.muted, marginBottom: 2 },
  bubbleTextOwn: { color: colors.ink, ...typography.body },
  bubbleTextOther: { color: colors.ink, ...typography.body },
  timestampOwn: { fontSize: 10, color: colors.accentMuted, marginTop: 4, alignSelf: 'flex-end' },
  timestampOther: { fontSize: 10, color: colors.muted, marginTop: 4, alignSelf: 'flex-end' },
  mentionList: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusControl, marginBottom: 4, maxHeight: 160 },
  mentionItem: { paddingVertical: spacing.spaceXs, paddingHorizontal: spacing.spaceSm, borderBottomWidth: 1, borderBottomColor: colors.border },
  mentionItemText: { ...typography.body, color: colors.ink },
  inputRow: { flexDirection: 'row', gap: spacing.spaceXs, paddingVertical: spacing.spaceXs, alignItems: 'flex-end' },
  input: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: spacing.radiusPill, paddingHorizontal: spacing.spaceMd, paddingVertical: 10, maxHeight: 100, color: colors.ink, ...typography.body },
  sendButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusPill, paddingHorizontal: spacing.spaceMd, paddingVertical: 10, justifyContent: 'center' },
  sendButtonText: { color: colors.onPrimary, ...typography.label },
});
