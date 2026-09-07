import { supabase } from './supabase';
import type { Database } from '@/types/database';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';

type UserProfile = Database['public']['Tables']['users']['Row'];
type NewUserProfile = Pick<
  UserProfile,
  'id' | 'phone' | 'first_name' | 'last_name' | 'birth_date' | 'height_cm' | 'preferred_foot' | 'player_role'
>;

export async function createOwnProfile(profile: NewUserProfile): Promise<UserProfile> {
  const { data, error } = await supabase.from('users').insert([profile]).select().single();
  if (error) throw new Error(error.message);
  return data as UserProfile;
}

export async function fetchOwnProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase.from('users').select().eq('id', userId).single();
  // PGRST116 = "no rows returned" -- expected when a user has a session but
  // hasn't finished profile creation yet, not a real error.
  if (error && error.code !== 'PGRST116') throw new Error(error.message);
  return (data as UserProfile) ?? null;
}

// Matches the three exact messages raised by the pre-existing
// protect_users_row trigger (supabase/migrations/20260830101700_final_
// review_hardening.sql) when this update touches phone/unique_user_id/
// a match-count column -- this feature never sends those fields itself
// (the form doesn't expose them), so hitting this is only reachable via
// a compromised/desynced client, but the trigger's plain RAISE EXCEPTIONs
// (no explicit SQLSTATE, so Postgres surfaces each as P0001, not a
// standard RLS/constraint code like 42501 or 23505) must never leak
// their English text into this all-Italian UI. Matched by message text,
// not code, for that reason.
const PROTECTED_FIELD_MESSAGES = new Set([
  'unique_user_id is immutable',
  'phone cannot be changed directly; contact support to update your phone number',
  'match statistics are server-managed and cannot be changed directly',
]);

function translateProfileUpdateError(message: string): string {
  if (PROTECTED_FIELD_MESSAGES.has(message)) {
    return 'Non è possibile modificare questi dati del profilo.';
  }
  return message;
}

export async function updateOwnProfile(
  userId: string,
  fields: Partial<Pick<UserProfile, 'first_name' | 'last_name' | 'birth_date' | 'height_cm' | 'preferred_foot' | 'player_role' | 'profile_image_url'>>
): Promise<UserProfile> {
  const { data, error } = await supabase.from('users').update(fields).eq('id', userId).select().single();
  if (error) throw new Error(translateProfileUpdateError(error.message));
  return data as UserProfile;
}

// Reads the local file as base64 and decodes to an ArrayBuffer for the
// upload -- fetch(uri).blob() is not reliable for local file:// URIs on
// React Native, this base64-round-trip is the pattern Supabase's own
// docs recommend for Expo. The millisecond timestamp in the path
// guarantees a fresh public URL on every upload, so no cache (client or
// CDN) can ever serve a stale photo under an old URL, and there's never
// a need for upsert or a delete-before-upload step.
export async function uploadProfileImage(userId: string, localUri: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: 'base64' });
  const path = `${userId}/${Date.now()}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from('profile-images')
    .upload(path, decode(base64), { contentType: 'image/jpeg', upsert: false });
  if (uploadError) throw new Error(uploadError.message);
  const { data } = supabase.storage.from('profile-images').getPublicUrl(path);
  return data.publicUrl;
}
