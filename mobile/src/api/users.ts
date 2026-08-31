import { supabase } from './supabase';
import type { Database } from '@/types/database';

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
