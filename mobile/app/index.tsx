import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useSessionStore } from '@/stores/sessionStore';

// Gives the root path an actual matching route. Without this, `/` has
// nothing to render until the redirect effect in app/_layout.tsx fires,
// which briefly (or, if that effect never fires, permanently) shows
// expo-router's built-in Unmatched Route screen instead.
export default function Index() {
  const status = useSessionStore((s) => s.status);

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (status === 'signed-out') return <Redirect href={'/(auth)/login' as any} />;
  if (status === 'needs-profile') return <Redirect href={'/(auth)/create-profile' as any} />;
  return <Redirect href={'/(tabs)/home' as any} />;
}
