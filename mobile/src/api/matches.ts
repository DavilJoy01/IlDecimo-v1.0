// mobile/src/api/matches.ts
import { supabase } from './supabase';
import type { Database } from '@/types/database';

export interface NearbyMatch {
  id: string;
  field_name: string;
  match_type: 5 | 7 | 8;
  match_date: string;
  start_time: string;
  end_time: string;
  max_players: number;
  distance_km: number;
  approved_players_count: number;
  latitude: number;
  longitude: number;
}

export async function fetchNearbyMatches(lat: number, lng: number, radiusKm = 20): Promise<NearbyMatch[]> {
  const { data, error } = await supabase.rpc('nearby_open_matches', {
    user_lat: lat,
    user_lng: lng,
    radius_km: radiusKm,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as NearbyMatch[];
}

export type Match = Database['public']['Tables']['matches']['Row'];

export type NewMatch = Pick<
  Match,
  | 'creator_id'
  | 'match_type'
  | 'field_name'
  | 'address'
  | 'latitude'
  | 'longitude'
  | 'match_date'
  | 'start_time'
  | 'end_time'
  | 'max_players'
  | 'description'
>;

// Location is geocoded once at creation from the typed address and is never
// editable afterward in this MVP -- omitting lat/lng here makes that a
// compile-time guarantee for every updateMatch call site, not just a UI rule.
export type MatchEditableFields = Omit<NewMatch, 'creator_id' | 'latitude' | 'longitude'>;

export async function createMatch(input: NewMatch): Promise<Match> {
  const { data, error } = await supabase.from('matches').insert([input]).select().single();
  if (error) throw new Error(error.message);
  return data as Match;
}

export async function fetchMatchById(id: string): Promise<Match> {
  const { data, error } = await supabase.from('matches').select().eq('id', id).single();
  if (error) throw new Error(error.message);
  return data as Match;
}

export async function updateMatch(id: string, input: MatchEditableFields): Promise<Match> {
  const { data, error } = await supabase.from('matches').update(input).eq('id', id).select().single();
  if (error) throw new Error(error.message);
  return data as Match;
}

// A hard DELETE would cascade-delete match_participants (and every other
// FK'd row) silently -- no notification to approved players, no history.
// Cancelling is a status update instead, which the existing lifecycle
// trigger picks up to notify approved/active participants.
export async function cancelMatch(id: string): Promise<void> {
  const { data, error } = await supabase.from('matches').update({ status: 'cancelled' }).eq('id', id).select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error('Impossibile cancellare la partita.');
}

export async function fetchMatchesByCreator(creatorId: string): Promise<Match[]> {
  const { data, error } = await supabase
    .from('matches')
    .select()
    .eq('creator_id', creatorId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Match[];
}
