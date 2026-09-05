// mobile/src/hooks/useFriends.test.ts
import { renderHook, waitFor } from '@testing-library/react-native';
import { useFriends } from './useFriends';
import { fetchFriends } from '@/api/friendships';
import { useSessionStore } from '@/stores/sessionStore';

jest.mock('@/api/friendships', () => ({
  fetchFriends: jest.fn(),
}));

const friend = { user_id: 'u2', unique_user_id: 'FC-100002', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null };

describe('useFriends', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSessionStore.setState({ session: { user: { id: 'u1' } } as never, profile: null, status: 'signed-in' });
  });

  it('fetches the friends list on mount', async () => {
    (fetchFriends as jest.Mock).mockResolvedValue([friend]);

    const { result } = await renderHook(() => useFriends());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchFriends).toHaveBeenCalledWith('u1');
    expect(result.current.friends).toEqual([friend]);
  });

  it('exposes an error when the fetch fails', async () => {
    (fetchFriends as jest.Mock).mockRejectedValue(new Error('boom'));

    const { result } = await renderHook(() => useFriends());

    await waitFor(() => expect(result.current.error).toBe('boom'));
  });
});
