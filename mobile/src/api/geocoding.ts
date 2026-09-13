import * as Location from 'expo-location';

export interface GeocodedLocation {
  latitude: number;
  longitude: number;
}

export async function geocodeAddress(query: string): Promise<GeocodedLocation> {
  const results = await Location.geocodeAsync(query);
  if (results.length === 0) {
    throw new Error('Località non trovata, prova a essere più specifico.');
  }
  const [first] = results;
  return { latitude: first.latitude, longitude: first.longitude };
}
