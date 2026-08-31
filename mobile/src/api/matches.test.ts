// mobile/src/api/matches.test.ts
import { supabase } from './supabase';
import { fetchNearbyMatches } from './matches';

jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn() } }));

describe('matches api', () => {
  afterEach(() => jest.clearAllMocks());

  it('calls the nearby_open_matches RPC with the given coordinates and default radius', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: [{ id: 'm1', field_name: 'Campo Test' }], error: null });
    const result = await fetchNearbyMatches(38.1157, 13.3615);
    expect(supabase.rpc).toHaveBeenCalledWith('nearby_open_matches', {
      user_lat: 38.1157,
      user_lng: 13.3615,
      radius_km: 20,
    });
    expect(result).toHaveLength(1);
  });

  it('accepts a custom radius', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: [], error: null });
    await fetchNearbyMatches(38.1157, 13.3615, 5);
    expect(supabase.rpc).toHaveBeenCalledWith('nearby_open_matches', {
      user_lat: 38.1157,
      user_lng: 13.3615,
      radius_km: 5,
    });
  });

  it('throws the Supabase error message on failure', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: { message: 'connection failed' } });
    await expect(fetchNearbyMatches(0, 0)).rejects.toThrow('connection failed');
  });
});
