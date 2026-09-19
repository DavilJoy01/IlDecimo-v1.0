// mobile/src/components/auth/AuthButton.tsx
// Primary CTA button shared by every auth screen. Adds a spring press-scale
// on top of the app-wide `withPressed` opacity dim, and cross-fades between
// its label and the loading spinner instead of hard-swapping them.
import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, FadeIn, FadeOut } from 'react-native-reanimated';
import { colors, typography, spacing } from '@/theme';

interface AuthButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function AuthButton({ label, onPress, loading, disabled, testID, style }: AuthButtonProps) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const isDisabled = disabled || loading;

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        testID={testID}
        onPress={onPress}
        disabled={isDisabled}
        onPressIn={() => {
          scale.value = withTiming(0.96, { duration: 100 });
        }}
        onPressOut={() => {
          scale.value = withTiming(1, { duration: 150 });
        }}
        style={[styles.button, isDisabled && styles.buttonDisabled, style]}
      >
        {loading ? (
          <Animated.View key="loading" entering={FadeIn.duration(150)} exiting={FadeOut.duration(100)}>
            <ActivityIndicator color={colors.onPrimary} />
          </Animated.View>
        ) : (
          <Animated.View key="label" entering={FadeIn.duration(150)} exiting={FadeOut.duration(100)}>
            <Text style={styles.buttonText}>{label}</Text>
          </Animated.View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.primary,
    borderRadius: spacing.radiusControl,
    padding: 14,
    alignItems: 'center',
    marginTop: spacing.spaceXs,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.onPrimary, ...typography.label },
});
