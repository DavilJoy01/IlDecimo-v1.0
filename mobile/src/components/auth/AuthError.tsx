// mobile/src/components/auth/AuthError.tsx
// Fades an auth screen's error message in/out instead of having it pop in
// and shove the button down with no transition.
import { StyleSheet, Text } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { colors } from '@/theme';

export function AuthError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)}>
      <Text style={styles.error}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.danger },
});
