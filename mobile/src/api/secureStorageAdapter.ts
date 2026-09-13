import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// Supabase's auth client expects a storage object with this shape (a subset
// of the web Storage interface, async-friendly). expo-secure-store has a
// ~2KB per-value limit on some platforms; a standard Supabase session
// (access + refresh token) fits comfortably under that in practice, so no
// chunking is implemented here -- revisit only if this becomes a real issue.
const nativeStorageAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

// expo-secure-store is native-only -- its own isAvailableAsync() docs state
// it "resolves true on Android and iOS only" -- so on web it throws
// (ExpoSecureStore.default.getValueWithKeyAsync is not a function) instead
// of silently no-oping. This also breaks module load during Expo Router's
// Node-side SSR prerendering of the web bundle, which imports this same
// client code but has no `window` at all. Route web to localStorage when a
// real browser tab provides one, and to an inert no-op storage otherwise
// (the Node SSR pass), so Supabase's auth client can always initialize.
const webStorageAdapter = {
  getItem: async (key: string) => (typeof window !== 'undefined' ? window.localStorage.getItem(key) : null),
  setItem: async (key: string, value: string) => {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
  },
  removeItem: async (key: string) => {
    if (typeof window !== 'undefined') window.localStorage.removeItem(key);
  },
};

// Checked per-call rather than once at module scope: Platform.OS never
// actually changes within a running app (a bundle is built for one
// platform), but per-call keeps this consistent with geocoding.ts's own
// Platform.OS branching style and lets it be exercised directly in tests.
export const secureStorageAdapter = {
  getItem: (key: string) => (Platform.OS === 'web' ? webStorageAdapter.getItem(key) : nativeStorageAdapter.getItem(key)),
  setItem: (key: string, value: string) =>
    Platform.OS === 'web' ? webStorageAdapter.setItem(key, value) : nativeStorageAdapter.setItem(key, value),
  removeItem: (key: string) =>
    Platform.OS === 'web' ? webStorageAdapter.removeItem(key) : nativeStorageAdapter.removeItem(key),
};
