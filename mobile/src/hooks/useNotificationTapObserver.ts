// mobile/src/hooks/useNotificationTapObserver.ts
import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { navigateForNotification, type NotificationRouteInfo } from '@/utils/notificationNavigation';
import { markNotificationRead } from '@/api/notifications';
import { useSessionStore } from '@/stores/sessionStore';

// Routes both a cold-launch tap (app was killed, the OS launched it because
// the user tapped the push) and a live tap (app was backgrounded) through
// the exact same navigateForNotification the in-app Notifiche screen uses --
// see supabase/migrations/20260914000000_add_type_to_push_notification_data.sql
// for why the push payload's `data` carries `type`/`notification_id` at all.
export function useNotificationTapObserver(): void {
  const router = useRouter();
  const userId = useSessionStore((s) => s.session?.user.id);

  useEffect(() => {
    function handleResponse(response: Notifications.NotificationResponse) {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      const type = data?.type;
      if (typeof type !== 'string') return;

      const notificationId = data?.notification_id;
      if (typeof notificationId === 'string') {
        markNotificationRead(notificationId).catch(() => {});
      }

      const info: NotificationRouteInfo = { type, payload: (data ?? {}) as NotificationRouteInfo['payload'] };
      navigateForNotification(info, router, userId);
    }

    const lastResponse = Notifications.getLastNotificationResponse();
    if (lastResponse) handleResponse(lastResponse);

    const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
    return () => subscription.remove();
  }, [router, userId]);
}
