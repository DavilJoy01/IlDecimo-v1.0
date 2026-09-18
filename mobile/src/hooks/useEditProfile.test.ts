import { renderHook, act } from '@testing-library/react-native';
import { useEditProfile } from './useEditProfile';
import { updateOwnProfile, uploadProfileImage } from '@/api/users';
import { useSessionStore } from '@/stores/sessionStore';

jest.mock('@/api/users', () => ({
  updateOwnProfile: jest.fn(),
  uploadProfileImage: jest.fn(),
}));

const existingProfile = {
  id: 'u1',
  unique_user_id: 'FC-100001',
  phone: '+390000000001',
  first_name: 'Mario',
  last_name: 'Rossi',
  birth_date: '1990-01-01',
  height_cm: 180,
  preferred_foot: 'right',
  player_role: 'player',
  profile_image_url: null,
  matches_played_count: 0,
  matches_completed_count: 0,
  matches_abandoned_count: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const formValues = {
  firstName: 'Mario',
  lastName: 'Bianchi',
  birthDate: '1990-01-01',
  heightCm: '182',
  preferredFoot: 'left' as const,
  playerRole: 'goalkeeper' as const,
};

describe('useEditProfile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSessionStore.setState({
      session: { user: { id: 'u1' } } as never,
      profile: existingProfile as never,
      status: 'signed-in',
    });
  });

  it('exposes the current profile from the session store', async () => {
    const { result } = await renderHook(() => useEditProfile());
    expect(result.current.profile).toEqual(existingProfile);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('save() without a new image calls updateOwnProfile only, and updates the session store', async () => {
    const updatedRow = { ...existingProfile, last_name: 'Bianchi', height_cm: 182, preferred_foot: 'left', player_role: 'goalkeeper' };
    (updateOwnProfile as jest.Mock).mockResolvedValue(updatedRow);

    const { result } = await renderHook(() => useEditProfile());

    let success = false;
    await act(async () => {
      success = await result.current.save(formValues);
    });

    expect(success).toBe(true);
    expect(uploadProfileImage).not.toHaveBeenCalled();
    expect(updateOwnProfile).toHaveBeenCalledWith('u1', {
      first_name: 'Mario',
      last_name: 'Bianchi',
      birth_date: '1990-01-01',
      height_cm: 182,
      preferred_foot: 'left',
      player_role: 'goalkeeper',
    });
    expect(useSessionStore.getState().profile).toEqual(updatedRow);
  });

  it('save() with a new image uploads first, then includes the returned URL in the update', async () => {
    (uploadProfileImage as jest.Mock).mockResolvedValue('https://storage.example.com/u1/123.jpg');
    const updatedRow = { ...existingProfile, profile_image_url: 'https://storage.example.com/u1/123.jpg' };
    (updateOwnProfile as jest.Mock).mockResolvedValue(updatedRow);

    const { result } = await renderHook(() => useEditProfile());

    await act(async () => {
      await result.current.save(formValues, 'file:///tmp/new-photo.jpg');
    });

    expect(uploadProfileImage).toHaveBeenCalledWith('u1', 'file:///tmp/new-photo.jpg');
    expect(updateOwnProfile).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ profile_image_url: 'https://storage.example.com/u1/123.jpg' })
    );
  });

  it('save() sets an error and returns false on failure, without touching the session store', async () => {
    (updateOwnProfile as jest.Mock).mockRejectedValue(new Error('Non è possibile modificare questi dati del profilo.'));

    const { result } = await renderHook(() => useEditProfile());

    let success = true;
    await act(async () => {
      success = await result.current.save(formValues);
    });

    expect(success).toBe(false);
    expect(result.current.error).toBe('Non è possibile modificare questi dati del profilo.');
    expect(useSessionStore.getState().profile).toEqual(existingProfile);
  });
});
