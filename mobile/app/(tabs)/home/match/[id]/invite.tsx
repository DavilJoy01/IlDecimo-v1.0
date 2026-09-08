// mobile/app/(tabs)/home/match/[id]/invite.tsx
import { View, Text, FlatList, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useInvitableFriends } from '@/hooks/useInvitableFriends';
import { useMatchDetail } from '@/hooks/useMatchDetail';
import { useSessionStore } from '@/stores/sessionStore';
import { colors, typography, spacing, withPressed } from '@/theme';

export default function InviteFriendsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = useSessionStore((s) => s.session?.user.id);
  const { match } = useMatchDetail(id);
  const { friends, loading, error, invite, inviting, refresh } = useInvitableFriends(id);

  if (loading && friends.length === 0) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // Defense-in-depth: the only other creator check for this feature lives on
  // the "Invita amici" button in match/[id]/index.tsx, so this route is
  // otherwise reachable via a hand-crafted deep link by any signed-in user.
  // Gated on `match` being loaded (not just falsy) so we don't flash this
  // message during the transient window before useMatchDetail resolves --
  // while match is still null we fall through to the loading/friends-list
  // rendering below, which is harmless for a non-creator (their own
  // useInvitableFriends call just returns their own empty list).
  if (match && match.creator_id !== userId) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.subtitle}>Non puoi invitare amici a questa partita.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <Pressable hitSlop={8} onPress={() => router.back()}>
        <Text style={styles.backLink}>← Torna alla partita</Text>
      </Pressable>
      <Text style={styles.header}>Invita amici</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={friends}
        keyExtractor={(item) => item.user_id}
        renderItem={({ item }) => (
          <View style={styles.friendRow}>
            <Text style={styles.friendName}>
              {item.first_name} {item.last_name}
            </Text>
            <Pressable style={withPressed(styles.inviteButton)} disabled={inviting} onPress={() => invite(item.user_id)}>
              {inviting ? <ActivityIndicator color="#fff" /> : <Text style={styles.inviteButtonText}>Invita</Text>}
            </Pressable>
          </View>
        )}
        contentContainerStyle={styles.list}
        onRefresh={refresh}
        refreshing={loading}
        ListEmptyComponent={!error ? <Text style={styles.subtitle}>Nessun amico da invitare.</Text> : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, paddingHorizontal: spacing.spaceMd },
  centered: { backgroundColor: colors.background, flex: 1, alignItems: 'center', justifyContent: 'center' },
  backLink: { color: colors.primary, marginBottom: spacing.spaceXs },
  header: { ...typography.screenTitle, marginBottom: spacing.spaceSm },
  error: { color: colors.danger, marginBottom: spacing.spaceXs },
  subtitle: { color: colors.muted, textAlign: 'center', marginTop: spacing.spaceLg, ...typography.body },
  list: { paddingBottom: spacing.spaceLg },
  friendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.spaceSm, borderBottomWidth: 1, borderBottomColor: colors.border },
  friendName: typography.label,
  inviteButton: { backgroundColor: colors.primary, borderRadius: spacing.radiusControl, paddingVertical: spacing.spaceXs, paddingHorizontal: spacing.spaceMd, minWidth: 80, alignItems: 'center' },
  inviteButtonText: { color: colors.onPrimary, ...typography.label },
});
