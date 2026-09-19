// mobile/src/components/auth/AuthBackdrop.tsx
// Full-bleed "night stadium" backdrop for the auth flow: a dark vertical
// gradient with a few soft gold floodlight beams fanning down from a point
// above the screen, replacing the flat background + thin pitch-line
// decoration those screens used before (too quiet to read as "a great app"
// from the very first screen).
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '@/theme';

const NIGHT_TOP = '#122A1F';
const NIGHT_BOTTOM = '#050F0B';
const BEAM_COLOR = 'rgba(245,197,24,0.16)';
const BEAM_FADE = 'rgba(245,197,24,0)';

export function AuthBackdrop() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient colors={[NIGHT_TOP, colors.background, NIGHT_BOTTOM]} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
      <View style={styles.beamOrigin}>
        <Beam rotate="-16deg" />
        <Beam rotate="0deg" />
        <Beam rotate="16deg" />
      </View>
    </View>
  );
}

function Beam({ rotate }: { rotate: string }) {
  return (
    <LinearGradient
      colors={[BEAM_COLOR, BEAM_FADE]}
      style={[styles.beam, { transform: [{ rotate }] }]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
    />
  );
}

const styles = StyleSheet.create({
  beamOrigin: {
    position: 'absolute',
    top: -80,
    left: '50%',
    marginLeft: -140,
    width: 280,
    height: 620,
    alignItems: 'center',
  },
  beam: {
    position: 'absolute',
    top: 0,
    width: 120,
    height: 620,
  },
});
