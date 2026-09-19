// mobile/src/components/auth/AuthButton.tsx
// Primary CTA button shared by every auth screen: a full-width gold gradient
// pill. Adds a spring press-scale, and cross-fades between its label and the
// loading spinner instead of hard-swapping them.
import { ActivityIndicator, Pressable, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, FadeIn, FadeOut } from 'react-native-reanimated';
import { colors, typography } from '@/theme';

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
        style={style}
      >
        <LinearGradient
          colors={['#FFDE59', colors.primary]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.button, isDisabled && styles.buttonDisabled]}
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
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.onPrimary, ...typography.label, letterSpacing: 0.5 },
});
