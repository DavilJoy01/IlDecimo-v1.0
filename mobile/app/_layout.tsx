import { useEffect } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { supabase } from '@/api/supabase';
import { useSessionStore } from '@/stores/sessionStore';

export default function RootLayout() {
  const { session, status, setSession } = useSessionStore();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.subscription.unsubscribe();
  }, [setSession]);

  useEffect(() => {
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
      segs[1] !== 'create-profile' &&
      segs[1] !== 'create-password'
    ) {
      router.replace('/(auth)/create-profile' as any);
    } else if (status === 'signed-in' && inAuthGroup) {
      router.replace('/(tabs)/home' as any);
    }
  }, [status, segments, router]);

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return <Slot />;
}
