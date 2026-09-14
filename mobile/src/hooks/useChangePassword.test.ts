import { renderHook, act } from '@testing-library/react-native';
import { useChangePassword } from './useChangePassword';
import { signInWithPassword, setPassword } from '@/api/auth';
import { useSessionStore } from '@/stores/sessionStore';

jest.mock('@/api/auth', () => ({
  signInWithPassword: jest.fn(),
  setPassword: jest.fn(),
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

describe('useChangePassword', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSessionStore.setState({
      session: { user: { id: 'u1' } } as never,
      profile: existingProfile as never,
      status: 'signed-in',
    });
  });

  it('verifies the current password, then sets the new one -- in that order', async () => {
    const calls: string[] = [];
    (signInWithPassword as jest.Mock).mockImplementation(async () => {
      calls.push('verify');
      return { user: null };
    });
    (setPassword as jest.Mock).mockImplementation(async () => {
      calls.push('set');
    });

    const { result } = await renderHook(() => useChangePassword());

    let success = false;
    await act(async () => {
      success = await result.current.changePassword('oldpass1', 'newpass1');
    });

    expect(signInWithPassword).toHaveBeenCalledWith('+390000000001', 'oldpass1');
    expect(setPassword).toHaveBeenCalledWith('newpass1');
    expect(calls).toEqual(['verify', 'set']);
    expect(success).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('sets an error and does not set a new password when the current password is wrong', async () => {
    (signInWithPassword as jest.Mock).mockRejectedValue(new Error('Invalid login credentials'));

    const { result } = await renderHook(() => useChangePassword());

    let success = true;
    await act(async () => {
      success = await result.current.changePassword('wrongpass', 'newpass1');
    });

    expect(success).toBe(false);
    expect(result.current.error).toBe('Invalid login credentials');
    expect(setPassword).not.toHaveBeenCalled();
  });

  it('sets an error when setting the new password fails after a successful verification', async () => {
    (signInWithPassword as jest.Mock).mockResolvedValue({ user: null });
    (setPassword as jest.Mock).mockRejectedValue(new Error('weak password'));

    const { result } = await renderHook(() => useChangePassword());

    let success = true;
    await act(async () => {
      success = await result.current.changePassword('oldpass1', 'weak');
    });

    expect(success).toBe(false);
    expect(result.current.error).toBe('weak password');
  });

  it('returns false and does not attempt anything when there is no profile', async () => {
    useSessionStore.setState({ session: null, profile: null, status: 'signed-out' });

    const { result } = await renderHook(() => useChangePassword());

    let success = true;
    await act(async () => {
      success = await result.current.changePassword('oldpass1', 'newpass1');
    });

    expect(success).toBe(false);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
});
