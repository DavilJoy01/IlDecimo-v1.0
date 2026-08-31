// mobile/src/api/matches.ts
import { supabase } from './supabase';

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
