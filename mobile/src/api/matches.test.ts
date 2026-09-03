// mobile/src/api/matches.test.ts
import { supabase } from './supabase';
import { fetchNearbyMatches, createMatch, fetchMatchById, updateMatch, cancelMatch, fetchMatchesByCreator } from './matches';

jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));

describe('matches api', () => {
  afterEach(() => jest.clearAllMocks());

  describe('fetchNearbyMatches', () => {
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

  const sampleMatch = {
    id: 'm1',
    creator_id: 'u1',
    match_type: 5,
    field_name: 'Campo Test',
    address: 'Via Test 1',
    latitude: 38.1157,
    longitude: 13.3615,
    match_date: '2026-09-05',
    start_time: '19:00:00',
    end_time: '20:30:00',
    max_players: 10,
    description: null,
    status: 'open',
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
  };

  const newMatchInput = {
    creator_id: 'u1',
    match_type: 5 as const,
    field_name: 'Campo Test',
    address: 'Via Test 1',
    latitude: 38.1157,
    longitude: 13.3615,
    match_date: '2026-09-05',
    start_time: '19:00',
    end_time: '20:30',
    max_players: 10,
    description: null,
  };

  const editableFields = {
    match_type: 5 as const,
    field_name: 'Campo Nuovo',
    address: 'Via Test 1',
    match_date: '2026-09-05',
    start_time: '19:00',
    end_time: '20:30',
    max_players: 10,
    description: null,
  };

  describe('createMatch', () => {
    it('inserts a new match and returns it', async () => {
      const single = jest.fn().mockResolvedValue({ data: sampleMatch, error: null });
      const select = jest.fn().mockReturnValue({ single });
      const insert = jest.fn().mockReturnValue({ select });
      (supabase.from as jest.Mock).mockReturnValue({ insert });

      const result = await createMatch(newMatchInput);

      expect(supabase.from).toHaveBeenCalledWith('matches');
      expect(insert).toHaveBeenCalledWith([expect.objectContaining({ creator_id: 'u1', field_name: 'Campo Test' })]);
      expect(result).toEqual(sampleMatch);
    });

    it('throws the Supabase error message on failure', async () => {
      const single = jest.fn().mockResolvedValue({ data: null, error: { message: 'insert failed' } });
      const select = jest.fn().mockReturnValue({ single });
      const insert = jest.fn().mockReturnValue({ select });
      (supabase.from as jest.Mock).mockReturnValue({ insert });

      await expect(createMatch(newMatchInput)).rejects.toThrow('insert failed');
    });
  });

  describe('fetchMatchById', () => {
    it('selects a single match by id', async () => {
      const single = jest.fn().mockResolvedValue({ data: sampleMatch, error: null });
      const eq = jest.fn().mockReturnValue({ single });
      const select = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ select });

      const result = await fetchMatchById('m1');

      expect(supabase.from).toHaveBeenCalledWith('matches');
      expect(eq).toHaveBeenCalledWith('id', 'm1');
      expect(result).toEqual(sampleMatch);
    });

    it('throws the Supabase error message on failure', async () => {
      const single = jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } });
      const eq = jest.fn().mockReturnValue({ single });
      const select = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ select });

      await expect(fetchMatchById('missing')).rejects.toThrow('not found');
    });
  });

  describe('updateMatch', () => {
    it('updates the given fields on a match and returns the updated row', async () => {
      const updated = { ...sampleMatch, field_name: 'Campo Nuovo' };
      const single = jest.fn().mockResolvedValue({ data: updated, error: null });
      const select = jest.fn().mockReturnValue({ single });
      const eq = jest.fn().mockReturnValue({ select });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      const result = await updateMatch('m1', editableFields);

      expect(supabase.from).toHaveBeenCalledWith('matches');
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ field_name: 'Campo Nuovo' }));
      expect(eq).toHaveBeenCalledWith('id', 'm1');
      expect(result.field_name).toBe('Campo Nuovo');
    });

    it('throws the Supabase error message on failure', async () => {
      const single = jest.fn().mockResolvedValue({ data: null, error: { message: 'update failed' } });
      const select = jest.fn().mockReturnValue({ single });
      const eq = jest.fn().mockReturnValue({ select });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await expect(updateMatch('m1', editableFields)).rejects.toThrow('update failed');
    });
  });

  describe('cancelMatch', () => {
    it('sets the match status to cancelled', async () => {
      const select = jest.fn().mockResolvedValue({ data: [{ id: 'm1' }], error: null });
      const eq = jest.fn().mockReturnValue({ select });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await cancelMatch('m1');

      expect(supabase.from).toHaveBeenCalledWith('matches');
      expect(update).toHaveBeenCalledWith({ status: 'cancelled' });
      expect(eq).toHaveBeenCalledWith('id', 'm1');
    });

    it('throws the Supabase error message on failure', async () => {
      const select = jest.fn().mockResolvedValue({ data: null, error: { message: 'update failed' } });
      const eq = jest.fn().mockReturnValue({ select });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await expect(cancelMatch('m1')).rejects.toThrow('update failed');
    });

    it('throws when no row was updated (RLS filtered it out or it does not exist)', async () => {
      const select = jest.fn().mockResolvedValue({ data: [], error: null });
      const eq = jest.fn().mockReturnValue({ select });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await expect(cancelMatch('m1')).rejects.toThrow('Impossibile cancellare la partita.');
    });
  });

  describe('fetchMatchesByCreator', () => {
    it('selects matches by creator_id, newest first', async () => {
      const order = jest.fn().mockResolvedValue({ data: [sampleMatch], error: null });
      const eq = jest.fn().mockReturnValue({ order });
      const select = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ select });

      const result = await fetchMatchesByCreator('u1');

      expect(supabase.from).toHaveBeenCalledWith('matches');
      expect(eq).toHaveBeenCalledWith('creator_id', 'u1');
      expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(result).toEqual([sampleMatch]);
    });

    it('throws the Supabase error message on failure', async () => {
      const order = jest.fn().mockResolvedValue({ data: null, error: { message: 'fetch failed' } });
      const eq = jest.fn().mockReturnValue({ order });
      const select = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ select });

      await expect(fetchMatchesByCreator('u1')).rejects.toThrow('fetch failed');
    });
  });
});
