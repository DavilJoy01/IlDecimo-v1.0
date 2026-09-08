// mobile/src/theme/pressedStyle.ts
import type { StyleProp, ViewStyle } from 'react-native';

// Used as: style={withPressed(styles.button)} on any solid-fill Pressable
// (backgroundColor: primary/danger/muted). Returns a style FUNCTION, matching
// Pressable's own `style={({ pressed }) => ...}` signature -- a plain style
// object cannot react to press state at all.
export function withPressed(baseStyle: StyleProp<ViewStyle>) {
  return ({ pressed }: { pressed: boolean }): StyleProp<ViewStyle> => [
    baseStyle,
    pressed && { opacity: 0.7 },
  ];
}
