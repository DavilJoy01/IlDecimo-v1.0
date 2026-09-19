// mobile/src/components/auth/AuthMark.tsx
// The app's "10" wordmark with a slow breathing gold glow behind it, used as
// the hero visual on the auth screens. Built from plain layered Views rather
// than assets/images/logo-glow.png -- that asset is blue and doesn't match
// this app's gold/green palette.
import { useEffect } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, Easing } from 'react-native-reanimated';
import { colors } from '@/theme';

export function AuthMark() {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 1800, easing: Easing.inOut(Easing.sin) })
      ),
      -1
    );
  }, [pulse]);

  const glowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.08 }],
    opacity: 0.5 + pulse.value * 0.35,
  }));

  return (
    <View style={styles.wrapper} pointerEvents="none">
      <Animated.View style={[styles.glowOuter, glowStyle]} />
      <View style={styles.glowInner} />
      <Image source={require('../../../assets/images/splash-icon.png')} style={styles.mark} resizeMode="contain" />
    </View>
  );
}

const MARK_SIZE = 88;

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', justifyContent: 'center', height: MARK_SIZE * 1.9 },
  glowOuter: {
    position: 'absolute',
    width: MARK_SIZE * 1.9,
    height: MARK_SIZE * 1.9,
    borderRadius: (MARK_SIZE * 1.9) / 2,
    backgroundColor: colors.accentBg,
  },
  glowInner: {
    position: 'absolute',
    width: MARK_SIZE * 1.35,
    height: MARK_SIZE * 1.35,
    borderRadius: (MARK_SIZE * 1.35) / 2,
    backgroundColor: colors.primaryTint,
  },
  mark: { width: MARK_SIZE, height: MARK_SIZE },
});
