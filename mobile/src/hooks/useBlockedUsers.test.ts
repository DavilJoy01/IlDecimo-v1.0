// mobile/src/hooks/useBlockedUsers.test.ts
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useBlockedUsers } from './useBlockedUsers';
import { fetchBlockedUsers, unblockUser } from '@/api/friendships';
import { useSessionStore } from '@/stores/sessionStore';

jest.mock('@/api/friendships', () => ({
  fetchBlockedUsers: jest.fn(),
  unblockUser: jest.fn(),
}));

const blocked = { user_id: 'u2', unique_user_id: 'FC-100002', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null };

describe('useBlockedUsers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSessionStore.setState({ session: { user: { id: 'u1' } } as never, profile: null, status: 'signed-in' });
  });

  it('fetches the blocked-users list on mount', async () => {
    (fetchBlockedUsers as jest.Mock).mockResolvedValue([blocked]);

    // @testing-library/react-native@14's renderHook returns a Promise -- await it.
    const { result } = await renderHook(() => useBlockedUsers());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchBlockedUsers).toHaveBeenCalledWith('u1');
    expect(result.current.blockedUsers).toEqual([blocked]);
  });

  it('exposes an error when the fetch fails', async () => {
    (fetchBlockedUsers as jest.Mock).mockRejectedValue(new Error('boom'));

    const { result } = await renderHook(() => useBlockedUsers());

    await waitFor(() => expect(result.current.error).toBe('boom'));
  });

  it('unblock removes the user from the list by refetching', async () => {
    (fetchBlockedUsers as jest.Mock).mockResolvedValueOnce([blocked]).mockResolvedValueOnce([]);
    (unblockUser as jest.Mock).mockResolvedValue(undefined);

    const { result } = await renderHook(() => useBlockedUsers());
    await waitFor(() => expect(result.current.blockedUsers).toEqual([blocked]));

    await act(async () => {
      await result.current.unblock('u2');
    });

    expect(unblockUser).toHaveBeenCalledWith('u1', 'u2');
    expect(result.current.blockedUsers).toEqual([]);
  });

  it('sets an error and keeps the list unchanged when unblock fails', async () => {
    (fetchBlockedUsers as jest.Mock).mockResolvedValue([blocked]);
    (unblockUser as jest.Mock).mockRejectedValue(new Error('unblock failed'));

    const { result } = await renderHook(() => useBlockedUsers());
    await waitFor(() => expect(result.current.blockedUsers).toEqual([blocked]));

    await act(async () => {
      await result.current.unblock('u2');
    });

    expect(result.current.error).toBe('unblock failed');
    expect(result.current.blockedUsers).toEqual([blocked]);
  });
});
