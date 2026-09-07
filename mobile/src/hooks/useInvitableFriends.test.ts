// mobile/src/hooks/useInvitableFriends.test.ts
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { useInvitableFriends } from './useInvitableFriends';
import { fetchInvitableFriends, sendMatchInvitation } from '@/api/matchInvitations';
import { useSessionStore } from '@/stores/sessionStore';

jest.mock('@/api/matchInvitations', () => ({
  fetchInvitableFriends: jest.fn(),
  sendMatchInvitation: jest.fn(),
}));

const friend = { user_id: 'u2', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null };

describe('useInvitableFriends', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSessionStore.setState({ session: { user: { id: 'u1' } } as never, profile: null, status: 'signed-in' });
  });

  it('loads invitable friends on mount', async () => {
    (fetchInvitableFriends as jest.Mock).mockResolvedValue([friend]);

    const { result } = await renderHook(() => useInvitableFriends('m1'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchInvitableFriends).toHaveBeenCalledWith('u1', 'm1');
    expect(result.current.friends).toEqual([friend]);
    expect(result.current.error).toBeNull();
  });

  it('sets an error message when loading fails', async () => {
    (fetchInvitableFriends as jest.Mock).mockRejectedValue(new Error('boom'));

    const { result } = await renderHook(() => useInvitableFriends('m1'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('boom');
  });

  it('invite() sends the invitation then reloads the list', async () => {
    (fetchInvitableFriends as jest.Mock).mockResolvedValueOnce([friend]).mockResolvedValueOnce([]);
    (sendMatchInvitation as jest.Mock).mockResolvedValue(undefined);

    const { result } = await renderHook(() => useInvitableFriends('m1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success = false;
    await act(async () => {
      success = await result.current.invite('u2');
    });

    expect(success).toBe(true);
    expect(sendMatchInvitation).toHaveBeenCalledWith('m1', 'u1', 'u2');
    expect(fetchInvitableFriends).toHaveBeenCalledTimes(2);
    expect(result.current.friends).toEqual([]);
  });

  it('invite() sets an error and returns false on failure, without removing the friend', async () => {
    (fetchInvitableFriends as jest.Mock).mockResolvedValue([friend]);
    (sendMatchInvitation as jest.Mock).mockRejectedValue(new Error('Non è possibile invitare questo utente.'));

    const { result } = await renderHook(() => useInvitableFriends('m1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success = true;
    await act(async () => {
      success = await result.current.invite('u2');
    });

    expect(success).toBe(false);
    expect(result.current.error).toBe('Non è possibile invitare questo utente.');
    expect(result.current.friends).toEqual([friend]);
  });
});
