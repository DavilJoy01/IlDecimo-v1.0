import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="register-phone" />
      <Stack.Screen name="verify-otp" />
      <Stack.Screen name="create-password" />
      <Stack.Screen name="create-profile" />
    </Stack>
  );
}
