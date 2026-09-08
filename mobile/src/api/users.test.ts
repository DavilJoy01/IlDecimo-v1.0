import { supabase } from './supabase';
import { createOwnProfile, fetchOwnProfile, updateOwnProfile, uploadProfileImage } from './users';
import * as FileSystem from 'expo-file-system/legacy';

jest.mock('./supabase', () => ({
  supabase: {
    from: jest.fn(),
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
