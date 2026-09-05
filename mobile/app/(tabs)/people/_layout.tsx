// mobile/app/(tabs)/people/_layout.tsx
import { Stack } from 'expo-router';

export default function PeopleLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="friend-requests" />
      <Stack.Screen name="user/[id]" />
    </Stack>
  );
}
