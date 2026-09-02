// mobile/app/(tabs)/home/_layout.tsx
import { Stack } from 'expo-router';

export default function HomeLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="create-match" />
      <Stack.Screen name="match/[id]" />
      <Stack.Screen name="notifications" />
    </Stack>
  );
}
