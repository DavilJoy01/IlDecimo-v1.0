import { Platform, Linking } from 'react-native';

export function directionsUrl(latitude: number, longitude: number): string {
  return Platform.OS === 'ios'
    ? `https://maps.apple.com/?daddr=${latitude},${longitude}`
    : `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
}

export async function openDirections(latitude: number, longitude: number): Promise<void> {
  await Linking.openURL(directionsUrl(latitude, longitude));
}
