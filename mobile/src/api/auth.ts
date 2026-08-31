import { supabase } from './supabase';
import type { Session, User } from '@supabase/supabase-js';

export async function signInWithPassword(phone: string, password: string): Promise<{ user: User | null }> {
  const { data, error } = await supabase.auth.signInWithPassword({ phone, password });
  if (error) throw new Error(error.message);
  return { user: data?.user ?? null };
}

export async function requestPhoneOtp(phone: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({ phone });
  if (error) throw new Error(error.message);
}

export async function verifyPhoneOtp(phone: string, token: string): Promise<{ session: Session | null }> {
  const { data, error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
  if (error) throw new Error(error.message);
  return { session: data?.session ?? null };
}

export async function setPassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(error.message);
}
