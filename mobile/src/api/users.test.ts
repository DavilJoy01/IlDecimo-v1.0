import { supabase } from './supabase';
import { createOwnProfile, fetchOwnProfile, updateOwnProfile, uploadProfileImage, fetchUserProfile, fetchUserMatchHistory } from './users';
import * as FileSystem from 'expo-file-system/legacy';

jest.mock('./supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

jest.mock('expo-file-system/legacy', () => ({ readAsStringAsync: jest.fn(), EncodingType: { Base64: 'base64' } }));

describe('users api', () => {
  afterEach(() => jest.clearAllMocks());

  it('createOwnProfile inserts a row into public.users and returns it', async () => {
    const single = jest.fn().mockResolvedValue({
      data: { id: 'u1', unique_user_id: 'FC-100000', first_name: 'Mario' },
      error: null,
    });
    const select = jest.fn().mockReturnValue({ single });
    const insert = jest.fn().mockReturnValue({ select });
    (supabase.from as jest.Mock).mockReturnValue({ insert });

    const result = await createOwnProfile({
      id: 'u1',
      phone: '+390000000001',
      first_name: 'Mario',
      last_name: 'Rossi',
      birth_date: '1990-01-01',
      height_cm: 180,
      preferred_foot: 'right',
      player_role: 'player',
    });

    expect(supabase.from).toHaveBeenCalledWith('users');
    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'u1', first_name: 'Mario' }),
    ]);
    expect(result.unique_user_id).toBe('FC-100000');
  });

  it('createOwnProfile throws the Supabase error message on failure', async () => {
    const single = jest.fn().mockResolvedValue({ data: null, error: { message: 'duplicate key value' } });
    const select = jest.fn().mockReturnValue({ single });
    const insert = jest.fn().mockReturnValue({ select });
    (supabase.from as jest.Mock).mockReturnValue({ insert });

    await expect(
      createOwnProfile({
        id: 'u1',
        phone: '+390000000001',
        first_name: 'Mario',
        last_name: 'Rossi',
        birth_date: '1990-01-01',
        height_cm: 180,
        preferred_foot: 'right',
        player_role: 'player',
      })
    ).rejects.toThrow('duplicate key value');
  });

  it('fetchOwnProfile selects a single row by id', async () => {
    const single = jest.fn().mockResolvedValue({ data: { id: 'u1' }, error: null });
    const eq = jest.fn().mockReturnValue({ single });
    const select = jest.fn().mockReturnValue({ eq });
    (supabase.from as jest.Mock).mockReturnValue({ select });

    const result = await fetchOwnProfile('u1');
    expect(supabase.from).toHaveBeenCalledWith('users');
    expect(eq).toHaveBeenCalledWith('id', 'u1');
    expect(result?.id).toBe('u1');
  });

  it('fetchOwnProfile returns null when no row exists yet (new user mid-registration)', async () => {
    const single = jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'no rows' } });
    const eq = jest.fn().mockReturnValue({ single });
    const select = jest.fn().mockReturnValue({ eq });
    (supabase.from as jest.Mock).mockReturnValue({ select });

    const result = await fetchOwnProfile('u1');
    expect(result).toBeNull();
  });

  describe('updateOwnProfile', () => {
    it('updates only the passed fields and returns the updated row', async () => {
      const updatedRow = {
        id: 'u1',
        unique_user_id: 'FC-100001',
        phone: '+390000000001',
        first_name: 'Mario',
        last_name: 'Bianchi',
        birth_date: '1990-01-01',
        height_cm: 182,
        preferred_foot: 'left',
        player_role: 'goalkeeper',
        profile_image_url: null,
        matches_played_count: 0,
        matches_completed_count: 0,
        matches_abandoned_count: 0,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };
      const single = jest.fn().mockResolvedValue({ data: updatedRow, error: null });
      const select = jest.fn().mockReturnValue({ single });
      const eq = jest.fn().mockReturnValue({ select });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      const result = await updateOwnProfile('u1', { last_name: 'Bianchi', height_cm: 182, preferred_foot: 'left', player_role: 'goalkeeper' });

      expect(supabase.from).toHaveBeenCalledWith('users');
      expect(update).toHaveBeenCalledWith({ last_name: 'Bianchi', height_cm: 182, preferred_foot: 'left', player_role: 'goalkeeper' });
      expect(eq).toHaveBeenCalledWith('id', 'u1');
      expect(result).toEqual(updatedRow);
    });

    it.each([
      ['unique_user_id is immutable'],
      ['phone cannot be changed directly; contact support to update your phone number'],
      ['match statistics are server-managed and cannot be changed directly'],
    ])('translates the pre-existing protect_users_row exception "%s" into a neutral Italian message', async (rawMessage) => {
      const single = jest.fn().mockResolvedValue({ data: null, error: { message: rawMessage, code: 'P0001' } });
      const select = jest.fn().mockReturnValue({ single });
      const eq = jest.fn().mockReturnValue({ select });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await expect(updateOwnProfile('u1', { first_name: 'X' })).rejects.toThrow('Non è possibile modificare questi dati del profilo.');
    });

    it('throws the raw message for an unrelated error', async () => {
      const single = jest.fn().mockResolvedValue({ data: null, error: { message: 'network error', code: undefined } });
      const select = jest.fn().mockReturnValue({ single });
      const eq = jest.fn().mockReturnValue({ select });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await expect(updateOwnProfile('u1', { first_name: 'X' })).rejects.toThrow('network error');
    });
  });

  describe('uploadProfileImage', () => {
    it('reads the local file, uploads it, and returns the public URL', async () => {
      (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue('ZmFrZS1pbWFnZS1kYXRh'); // base64 of "fake-image-data"
      const upload = jest.fn().mockResolvedValue({ data: { path: 'u1/1700000000000.jpg' }, error: null });
      const getPublicUrl = jest.fn().mockReturnValue({ data: { publicUrl: 'https://storage.example.com/profile-images/u1/1700000000000.jpg' } });
      (supabase.storage as unknown as { from: jest.Mock }) = { from: jest.fn().mockReturnValue({ upload, getPublicUrl }) } as never;

      const result = await uploadProfileImage('u1', 'file:///tmp/photo.jpg');

      expect(FileSystem.readAsStringAsync).toHaveBeenCalledWith('file:///tmp/photo.jpg', { encoding: 'base64' });
      expect(supabase.storage.from).toHaveBeenCalledWith('profile-images');
      expect(upload.mock.calls[0][0]).toMatch(/^u1\/\d+\.jpg$/);
      expect(upload.mock.calls[0][2]).toEqual({ contentType: 'image/jpeg', upsert: false });
      expect(getPublicUrl).toHaveBeenCalledWith(upload.mock.calls[0][0]);
      expect(result).toBe('https://storage.example.com/profile-images/u1/1700000000000.jpg');
    });

    it('throws the raw Supabase error message when the upload fails', async () => {
      (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue('ZmFrZS1pbWFnZS1kYXRh');
      const upload = jest.fn().mockResolvedValue({ data: null, error: { message: 'storage quota exceeded' } });
      (supabase.storage as unknown as { from: jest.Mock }) = { from: jest.fn().mockReturnValue({ upload, getPublicUrl: jest.fn() }) } as never;

      await expect(uploadProfileImage('u1', 'file:///tmp/photo.jpg')).rejects.toThrow('storage quota exceeded');
    });
  });
});

describe('fetchUserProfile', () => {
  it('calls the get_user_profile RPC and returns the first row', async () => {
    const row = { id: 'u2', unique_user_id: 'FC-100002', first_name: 'Luca' };
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: [row], error: null });

    const result = await fetchUserProfile('u2');

    expect(supabase.rpc).toHaveBeenCalledWith('get_user_profile', { target_id: 'u2' });
    expect(result).toEqual(row);
  });

  it('returns null when the RPC returns an empty array (blocked or nonexistent)', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: [], error: null });

    const result = await fetchUserProfile('u2');

    expect(result).toBeNull();
  });

  it('throws on an RPC error', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: { message: 'network error' } });

    await expect(fetchUserProfile('u2')).rejects.toThrow('network error');
  });
});

describe('fetchUserMatchHistory', () => {
  it('calls get_user_match_history with null cursor fields on the first page', async () => {
    const rows = [{ match_id: 'm1', role: 'creator', outcome: 'completed', match_type: 5, field_name: 'Campo A', address: 'Via A', match_date: '2026-01-10', start_time: '10:00' }];
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: rows, error: null });

    const result = await fetchUserMatchHistory('u2', null);

    expect(supabase.rpc).toHaveBeenCalledWith('get_user_match_history', {
      target_id: 'u2',
      before_date: null,
      before_time: null,
      before_id: null,
      page_size: 20,
    });
    expect(result).toEqual(rows);
  });

  it('passes the cursor fields and a custom page size on a later page', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: [], error: null });

    await fetchUserMatchHistory('u2', { date: '2026-01-05', time: '10:00', id: 'm3' }, 10);

    expect(supabase.rpc).toHaveBeenCalledWith('get_user_match_history', {
      target_id: 'u2',
      before_date: '2026-01-05',
      before_time: '10:00',
      before_id: 'm3',
      page_size: 10,
    });
  });

  it('throws on an RPC error', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: { message: 'network error' } });

    await expect(fetchUserMatchHistory('u2', null)).rejects.toThrow('network error');
  });
});
