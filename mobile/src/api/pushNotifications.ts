// mobile/src/api/pushNotifications.ts
import { supabase } from './supabase';

// Insert-only, never upsert: a device that reinstalls the app and gets a new
// Expo push token should end up with both tokens registered until whichever
// one is now stale naturally stops working -- there's no reliable client-side
// signal for "this token replaced that one". A unique (user_id, push_token)
// constraint means re-registering the exact same token is a harmless no-op.
export async function savePushToken(userId: string, token: string): Promise<void> {
  const { error } = await supabase.from('user_push_tokens').insert([{ user_id: userId, push_token: token }]);
  if (error && error.code !== '23505') throw new Error(error.message);
}
