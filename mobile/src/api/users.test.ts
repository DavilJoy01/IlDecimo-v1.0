import { supabase } from './supabase';
import { createOwnProfile, fetchOwnProfile } from './users';

jest.mock('./supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

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
});
