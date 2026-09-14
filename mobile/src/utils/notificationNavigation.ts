// mobile/src/utils/notificationNavigation.ts
import type { useRouter } from 'expo-router';
import { markInvitationViewed } from '@/api/matchInvitations';

export interface NotificationRouteInfo {
  type: string;
  payload: { message?: string; match_id?: string; user_id?: string; conversation_id?: string; [key: string]: unknown };
}

// Shared by the in-app Notifiche screen and the push-notification tap
// handler, so both routes to the same place for the same notification type.
export function navigateForNotification(
  notification: NotificationRouteInfo,
  router: ReturnType<typeof useRouter>,
  userId?: string
): void {
  if (notification.type === 'friend_request_received') {
    router.push('/(tabs)/people/friend-requests');
    return;
  }
  if (notification.type === 'friend_request_approved' || notification.type === 'friend_request_rejected') {
    const targetUserId = notification.payload.user_id;
    if (typeof targetUserId === 'string') {
      router.push({ pathname: '/(tabs)/people/user/[id]', params: { id: targetUserId } });
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
  if (notification.type === 'match_invitation') {
    const matchId = notification.payload.match_id;
    if (typeof matchId === 'string') {
      // Best-effort, matches this codebase's established "don't block
      // navigation on a secondary write" convention (see
      // markConversationRead's usage in messaggi's chat screen) -- a
      // failure here must never prevent the user reaching the match.
      if (userId) markInvitationViewed(matchId, userId).catch(() => {});
      router.push({ pathname: '/(tabs)/home/match/[id]', params: { id: matchId } });
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
