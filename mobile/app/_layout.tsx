import { useCallback, useEffect } from 'react';
import { Slot, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts, Sora_600SemiBold, Sora_700Bold } from '@expo-google-fonts/sora';
import { WorkSans_400Regular, WorkSans_500Medium, WorkSans_600SemiBold } from '@expo-google-fonts/work-sans';
import { supabase } from '@/api/supabase';
import { useSessionStore } from '@/stores/sessionStore';
import { useProfileBootstrap } from '@/hooks/useProfileBootstrap';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { session, status, setSession } = useSessionStore();
  const [fontsLoaded] = useFonts({
    Sora_600SemiBold,
    Sora_700Bold,
    WorkSans_400Regular,
    WorkSans_500Medium,
    WorkSans_600SemiBold,
  });
  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded && status !== 'loading') await SplashScreen.hideAsync();
  }, [fontsLoaded, status]);
  const router = useRouter();
  const segments = useSegments();
  const rootNavigationState = useRootNavigationState();

  useProfileBootstrap();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.subscription.unsubscribe();
  }, [setSession]);

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
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        onLayout={onLayoutRootView}
      >
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <Slot />
    </View>
  );
}
