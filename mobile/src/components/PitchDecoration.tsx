// mobile/src/components/PitchDecoration.tsx
// Purely decorative football-pitch markings (center circle + halfway line)
// drawn with plain Views so no SVG dependency/native rebuild is needed.
// The host card must set `overflow: 'hidden'` for the circle to read as a
// corner arc instead of a full circle poking out of the card's bounds.
import { View, StyleSheet } from 'react-native';

export function PitchDecoration() {
  return (
    <View style={styles.wrapper} pointerEvents="none">
      <View style={styles.circle} />
      <View style={styles.spot} />
      <View style={styles.halfwayLine} />
    </View>
  );
}

const LINE_COLOR = 'rgba(242,245,240,0.08)';

const styles = StyleSheet.create({
  wrapper: StyleSheet.absoluteFill,
  circle: {
    position: 'absolute',
    right: -46,
    bottom: -46,
    width: 128,
    height: 128,
    borderRadius: 64,
    borderWidth: 1.5,
    borderColor: LINE_COLOR,
  },
  spot: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: LINE_COLOR,
  },
  halfwayLine: {
    position: 'absolute',
    right: 0,
    bottom: 46,
    width: 60,
    height: 1.5,
    backgroundColor: LINE_COLOR,
    transform: [{ rotate: '-45deg' }],
  },
});
