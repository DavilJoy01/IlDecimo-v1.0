import 'react-native-url-polyfill/auto';
import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import { secureStorageAdapter } from './secureStorageAdapter';

// The Android emulator's 127.0.0.1 is its own loopback, not the host Mac's --
// reaching a locally-run Supabase means going through the emulator's special
// host alias instead. iOS Simulator shares the host's network stack directly,
// so it needs no rewrite, and a real hosted Supabase URL never matches this
// pattern, so production is unaffected either way.
const rawSupabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseUrl =
  Platform.OS === 'android' ? rawSupabaseUrl?.replace('127.0.0.1', '10.0.2.2') : rawSupabaseUrl;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. Copy mobile/.env.local.example to mobile/.env.local and fill in `supabase status -o env` values.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: secureStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
