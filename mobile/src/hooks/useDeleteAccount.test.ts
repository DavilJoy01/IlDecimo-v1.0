import { renderHook, act } from '@testing-library/react-native';
import { useDeleteAccount } from './useDeleteAccount';
import { signInWithPassword, deleteOwnAccount } from '@/api/auth';
import { deleteAllProfileImages } from '@/api/users';
import { supabase } from '@/api/supabase';
import { useSessionStore } from '@/stores/sessionStore';

jest.mock('@/api/auth', () => ({
  signInWithPassword: jest.fn(),
  deleteOwnAccount: jest.fn(),
}));
jest.mock('@/api/users', () => ({
  deleteAllProfileImages: jest.fn(),
}));
jest.mock('@/api/supabase', () => ({
  supabase: { auth: { signOut: jest.fn() } },
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

describe('useDeleteAccount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSessionStore.setState({
      session: { user: { id: 'u1' } } as never,
      profile: existingProfile as never,
      status: 'signed-in',
    });
  });

  it('verifies the password, cleans up storage, calls the RPC, then signs out -- in that order', async () => {
    const calls: string[] = [];
    (signInWithPassword as jest.Mock).mockImplementation(async () => { calls.push('verify'); return { user: null }; });
    (deleteAllProfileImages as jest.Mock).mockImplementation(async () => { calls.push('storage'); });
    (deleteOwnAccount as jest.Mock).mockImplementation(async () => { calls.push('rpc'); });
    (supabase.auth.signOut as jest.Mock).mockImplementation(async () => { calls.push('signout'); });

    const { result } = await renderHook(() => useDeleteAccount());

    let success = false;
    await act(async () => {
      success = await result.current.deleteAccount('hunter2');
    });

    expect(success).toBe(true);
    expect(signInWithPassword).toHaveBeenCalledWith('+390000000001', 'hunter2');
    expect(deleteAllProfileImages).toHaveBeenCalledWith('u1');
    expect(deleteOwnAccount).toHaveBeenCalled();
    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(calls).toEqual(['verify', 'storage', 'rpc', 'signout']);
  });

  it('returns false and sets an error when the password is wrong, without touching storage or the RPC', async () => {
    (signInWithPassword as jest.Mock).mockRejectedValue(new Error('Invalid login credentials'));

    const { result } = await renderHook(() => useDeleteAccount());

    let success = true;
    await act(async () => {
      success = await result.current.deleteAccount('wrong');
    });

    expect(success).toBe(false);
    expect(result.current.error).toBe('Invalid login credentials');
    expect(deleteAllProfileImages).not.toHaveBeenCalled();
    expect(deleteOwnAccount).not.toHaveBeenCalled();
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
  });

  it('returns false and sets an error when the RPC fails, without signing out', async () => {
    (signInWithPassword as jest.Mock).mockResolvedValue({ user: null });
    (deleteAllProfileImages as jest.Mock).mockResolvedValue(undefined);
    (deleteOwnAccount as jest.Mock).mockRejectedValue(new Error('must be authenticated to delete an account'));

    const { result } = await renderHook(() => useDeleteAccount());

    let success = true;
    await act(async () => {
      success = await result.current.deleteAccount('hunter2');
    });

    expect(success).toBe(false);
    expect(result.current.error).toBe('must be authenticated to delete an account');
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
  });

  it('returns false without calling anything when there is no profile loaded', async () => {
    useSessionStore.setState({ session: null, profile: null, status: 'signed-out' });

    const { result } = await renderHook(() => useDeleteAccount());

    let success = true;
    await act(async () => {
      success = await result.current.deleteAccount('hunter2');
    });

    expect(success).toBe(false);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
});
