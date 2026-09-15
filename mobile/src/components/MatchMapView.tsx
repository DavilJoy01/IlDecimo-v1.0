import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { regionForPins, type MapPin } from '@/utils/mapRegion';

export type { MapPin };

interface MatchMapViewProps {
  pins: MapPin[];
  onPressPin?: (id: string) => void;
  style?: StyleProp<ViewStyle>;
  // Default true (Home's list/map toggle needs pan/zoom/rotate to explore
  // pins). The match detail screen's map is a single-pin static preview
  // embedded in a ScrollView -- it sets all four false, because the
  // underlying native map view's own pan/pinch/rotate gesture recognizers
  // otherwise intercept touches for ScrollView content below it, even once
  // the map itself has scrolled out of view (confirmed: with the map's
  // gestures enabled, taps on the "Richieste in attesa" section's Approva
  // button silently never reached React -- no onPress, no network request
  // -- and disabling these props is what restored normal touch handling).
  scrollEnabled?: boolean;
  zoomEnabled?: boolean;
  rotateEnabled?: boolean;
  pitchEnabled?: boolean;
}

export function MatchMapView({
  pins,
  onPressPin,
  style,
  scrollEnabled = true,
  zoomEnabled = true,
  rotateEnabled = true,
  pitchEnabled = true,
}: MatchMapViewProps) {
  return (
    <MapView
      style={style}
      provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
      initialRegion={regionForPins(pins)}
      scrollEnabled={scrollEnabled}
      zoomEnabled={zoomEnabled}
      rotateEnabled={rotateEnabled}
      pitchEnabled={pitchEnabled}
    >
      {pins.map((pin) => (
        <Marker
          key={pin.id}
          coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
          onPress={() => onPressPin?.(pin.id)}
        />
      ))}
    </MapView>
  );
}
