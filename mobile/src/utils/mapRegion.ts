export interface MapPin {
  id: string;
  latitude: number;
  longitude: number;
}

export interface MapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

const MIN_DELTA = 0.05;
const PADDING_FACTOR = 1.4;
const DEFAULT_REGION: MapRegion = {
  latitude: 41.9028,
  longitude: 12.4964,
  latitudeDelta: MIN_DELTA,
  longitudeDelta: MIN_DELTA,
};

export function regionForPins(pins: MapPin[]): MapRegion {
  if (pins.length === 0) return DEFAULT_REGION;

  const latitudes = pins.map((pin) => pin.latitude);
  const longitudes = pins.map((pin) => pin.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * PADDING_FACTOR, MIN_DELTA),
    longitudeDelta: Math.max((maxLng - minLng) * PADDING_FACTOR, MIN_DELTA),
  };
}
