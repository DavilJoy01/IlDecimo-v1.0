import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import type { MapPin } from '@/utils/mapRegion';
import { colors, typography } from '@/theme';

export type { MapPin };

interface MatchMapViewProps {
  pins: MapPin[];
  onPressPin?: (id: string) => void;
  style?: StyleProp<ViewStyle>;
}

export function MatchMapView({ style }: MatchMapViewProps) {
  return (
    <View style={[styles.fallback, style]}>
      <Text style={styles.text}>Mappa non disponibile su web.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryTint },
  text: { color: colors.muted, ...typography.meta },
});
