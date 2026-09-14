import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { regionForPins, type MapPin } from '@/utils/mapRegion';

export type { MapPin };

interface MatchMapViewProps {
  pins: MapPin[];
  onPressPin?: (id: string) => void;
  style?: StyleProp<ViewStyle>;
}

export function MatchMapView({ pins, onPressPin, style }: MatchMapViewProps) {
  return (
    <MapView style={style} provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined} initialRegion={regionForPins(pins)}>
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
