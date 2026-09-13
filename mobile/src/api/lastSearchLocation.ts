import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'last-search-location';

export interface SavedSearchLocation {
  label: string;
  latitude: number;
  longitude: number;
}

function isValidSavedSearchLocation(value: unknown): value is SavedSearchLocation {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.label === 'string' &&
    typeof candidate.latitude === 'number' &&
    typeof candidate.longitude === 'number'
  );
}

export async function getLastSearchLocation(): Promise<SavedSearchLocation | null> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isValidSavedSearchLocation(parsed)) return null;
    return parsed;
  } catch {
    // Valore corrotto/da una versione precedente incompatibile: trattalo
    // come "nessuna località salvata" invece di far fallire la Home.
    return null;
  }
}

export async function saveLastSearchLocation(location: SavedSearchLocation): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(location));
}
