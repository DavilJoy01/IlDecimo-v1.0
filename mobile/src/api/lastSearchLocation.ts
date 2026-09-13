import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'last-search-location';

export interface SavedSearchLocation {
  label: string;
  latitude: number;
  longitude: number;
}

export async function getLastSearchLocation(): Promise<SavedSearchLocation | null> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SavedSearchLocation;
  } catch {
    // Valore corrotto/da una versione precedente incompatibile: trattalo
    // come "nessuna località salvata" invece di far fallire la Home.
    return null;
  }
}

export async function saveLastSearchLocation(location: SavedSearchLocation): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(location));
}
