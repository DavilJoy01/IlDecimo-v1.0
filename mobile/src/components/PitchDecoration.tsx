// mobile/src/components/PitchDecoration.tsx
// Purely decorative football-pitch markings (touchlines, halfway line,
// center circle, goal boxes) drawn with plain Views so no SVG
// dependency/native rebuild is needed. Oriented portrait (halfway line
// horizontal, boxes top/bottom) to fit this app's card proportions --
// the same layout as a real pitch, just turned 90 degrees.
import { View, StyleSheet } from 'react-native';

export function PitchDecoration() {
  return (
    <View style={styles.wrapper} pointerEvents="none">
      <View style={styles.boundary} />
      <View style={styles.halfwayLine} />
      <View style={styles.centerCircle} />
      <View style={styles.centerSpot} />
      <View style={styles.boxTop} />
      <View style={styles.boxBottom} />
    </View>
  );
}

const LINE_COLOR = 'rgba(242,245,240,0.07)';
const CIRCLE_SIZE = 46;

const styles = StyleSheet.create({
  wrapper: StyleSheet.absoluteFill,
  boundary: {
    position: 'absolute',
    top: '8%',
    bottom: '8%',
    left: '10%',
    right: '10%',
    borderWidth: 1,
    borderColor: LINE_COLOR,
  },
  halfwayLine: {
    position: 'absolute',
    top: '50%',
    left: '10%',
    right: '10%',
    height: 1,
    backgroundColor: LINE_COLOR,
  },
  centerCircle: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    marginLeft: -CIRCLE_SIZE / 2,
    marginTop: -CIRCLE_SIZE / 2,
    borderRadius: CIRCLE_SIZE / 2,
    borderWidth: 1,
    borderColor: LINE_COLOR,
  },
  centerSpot: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 3,
    height: 3,
    marginLeft: -1.5,
    marginTop: -1.5,
    borderRadius: 1.5,
    backgroundColor: LINE_COLOR,
  },
  boxTop: {
    position: 'absolute',
    top: '8%',
    left: '32%',
    right: '32%',
    height: '14%',
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: LINE_COLOR,
  },
  boxBottom: {
    position: 'absolute',
    bottom: '8%',
    left: '32%',
    right: '32%',
    height: '14%',
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: LINE_COLOR,
  },
});
