// mobile/src/components/auth/AuthTextInput.tsx
// A TextInput shared by every auth screen whose border eases from the app's
// default border color to gold on focus, instead of the static border every
// other screen's plain TextInput has.
import { forwardRef } from 'react';
import { TextInput, StyleSheet, type TextInputProps } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, interpolateColor } from 'react-native-reanimated';
import { colors, typography, spacing } from '@/theme';

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

export const AuthTextInput = forwardRef<TextInput, TextInputProps>(function AuthTextInput(
  { style, onFocus, onBlur, ...props },
  ref
) {
  const focus = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(focus.value, [0, 1], [colors.border, colors.primary]),
  }));

  return (
    <AnimatedTextInput
      ref={ref}
      placeholderTextColor={colors.muted}
      style={[styles.input, animatedStyle, style]}
      onFocus={(e) => {
        focus.value = withTiming(1, { duration: 180 });
        onFocus?.(e);
      }}
      onBlur={(e) => {
        focus.value = withTiming(0, { duration: 180 });
        onBlur?.(e);
      }}
      {...props}
    />
  );
});

const styles = StyleSheet.create({
  input: {
    // Translucent rather than a solid surface fill -- these sit inside
    // AuthGlassCard's BlurView, and a solid background would blank out
    // the blur showing through behind them.
    backgroundColor: 'rgba(242,245,240,0.06)',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.radiusControl,
    padding: spacing.spaceSm,
    color: colors.ink,
    ...typography.body,
  },
});
