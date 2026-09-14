// mobile/src/hooks/useRegisterPushToken.ts
import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { savePushToken } from '@/api/pushNotifications';
import { useSessionStore } from '@/stores/sessionStore';

// Runs once per signed-in session. Every failure path (permission denied, no
// EAS project configured, the platform can't produce a token -- notably true
// on the iOS Simulator, which this project's own manual testing relies on)
// is swallowed silently: registering for push is an enhancement, never a
// requirement for using the app, and must never surface as a user-facing
// error or block anything else from working.
export function useRegisterPushToken(): void {
  const userId = useSessionStore((s) => s.session?.user.id);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        if (Platform.OS === 'android') {
          // Required before the Android 13+ permission prompt will even
          // appear, and before getExpoPushTokenAsync can be called.
          await Notifications.setNotificationChannelAsync('default', {
            name: 'default',
            importance: Notifications.AndroidImportance.DEFAULT,
          });
        }

        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== 'granted') return;

        const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
        if (!projectId) return;

        const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
        await savePushToken(userId, token);
      } catch {
        // See module comment: never let this crash or surface an error.
      }
    })();
  }, [userId]);
}
