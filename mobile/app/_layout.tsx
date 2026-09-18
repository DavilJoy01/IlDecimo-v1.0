import { useCallback, useEffect } from 'react';
import { Slot, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { useFonts, Oswald_400Regular, Oswald_500Medium, Oswald_600SemiBold, Oswald_700Bold } from '@expo-google-fonts/oswald';
import { Archivo_400Regular, Archivo_500Medium, Archivo_600SemiBold } from '@expo-google-fonts/archivo';
import { supabase } from '@/api/supabase';
import { useSessionStore } from '@/stores/sessionStore';
import { useProfileBootstrap } from '@/hooks/useProfileBootstrap';
import { useRegisterPushToken } from '@/hooks/useRegisterPushToken';
import { useNotificationTapObserver } from '@/hooks/useNotificationTapObserver';
import { colors } from '@/theme';

SplashScreen.preventAutoHideAsync();

// Show an alert (with sound) for a push that arrives while the app is
// already open, instead of the default of silently updating the badge only.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export default function RootLayout() {
  const { status, setSession } = useSessionStore();
  const [fontsLoaded] = useFonts({
    Oswald_400Regular,
    Oswald_500Medium,
    Oswald_600SemiBold,
    Oswald_700Bold,
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_600SemiBold,
  });
  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded && status !== 'loading') await SplashScreen.hideAsync();
  }, [fontsLoaded, status]);
  const router = useRouter();
  const segments = useSegments();
  const rootNavigationState = useRootNavigationState();

  useProfileBootstrap();
  useRegisterPushToken();
  useNotificationTapObserver();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.subscription.unsubscribe();
  }, [setSession]);

  useEffect(() => {
    if (fontsLoaded && status !== 'loading') {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, status]);

  useEffect(() => {
    // The root navigator hasn't mounted yet — router.replace() below would
    // silently no-op if called before this, leaving the app stuck on the
    // unmatched `/` path (no app/index.tsx exists; every real screen lives
    // under the (auth) or (tabs) groups).
    if (!rootNavigationState?.key) return;
    if (status === 'loading') return;
    // `as string[]`/`as any` below: expo-router's typedRoutes experiment types
    // useSegments() as a fixed-length tuple and router.replace() against
    // routes that exist on disk right now. `(auth)/login`,
    // `(auth)/create-profile`, and `(tabs)/home` are added by Tasks 4/5/7/8 —
    // these casts are the standard Expo Router pattern for forward-referencing
    // routes/segments that don't exist yet, and can be dropped once those
    // tasks land.
    const segs = segments as string[];
    const inAuthGroup = segs[0] === '(auth)';

    if (status === 'signed-out' && !inAuthGroup) {
      router.replace('/(auth)/login' as any);
    } else if (
      status === 'needs-profile' &&
      !(inAuthGroup && (segs[1] === 'create-profile' || segs[1] === 'create-password'))
    ) {
      router.replace('/(auth)/create-profile' as any);
    } else if (status === 'signed-in' && inAuthGroup) {
      router.replace('/(tabs)/home' as any);
    }
  }, [status, segments, router, rootNavigationState?.key]);

  if (status === 'loading' || !fontsLoaded) {
    return (
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}
        onLayout={onLayoutRootView}
      >
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }} onLayout={onLayoutRootView}>
      <Slot />
    </View>
  );
}
