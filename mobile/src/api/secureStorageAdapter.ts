import * as SecureStore from 'expo-secure-store';

// Supabase's auth client expects a storage object with this shape (a subset
// of the web Storage interface, async-friendly). expo-secure-store has a
// ~2KB per-value limit on some platforms; a standard Supabase session
// (access + refresh token) fits comfortably under that in practice, so no
// chunking is implemented here -- revisit only if this becomes a real issue.
export const secureStorageAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};
