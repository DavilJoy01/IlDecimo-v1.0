import { Platform } from 'react-native';
import * as Location from 'expo-location';

export interface GeocodedLocation {
  latitude: number;
  longitude: number;
}

export async function geocodeAddress(query: string): Promise<GeocodedLocation> {
  if (Platform.OS === 'android') {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      throw new Error('Località non trovata, prova a essere più specifico.');
    }
  }
  const results = await Location.geocodeAsync(query);
  if (results.length === 0) {
    throw new Error('Località non trovata, prova a essere più specifico.');
  }
  const [first] = results;
  return { latitude: first.latitude, longitude: first.longitude };
}

// Always called right after a successful geocodeAddress() in this app's own
// flows, so the Android runtime permission it also requires is already
// granted by that point -- no separate permission request needed here.
export async function reverseGeocodeLabel(location: GeocodedLocation): Promise<string | null> {
  const results = await Location.reverseGeocodeAsync(location);
  if (results.length === 0) {
    return null;
  }
  const [first] = results;
  const parts = [first.city, first.region, first.country].filter((part): part is string => !!part);
  return parts.length > 0 ? parts.join(', ') : null;
}
