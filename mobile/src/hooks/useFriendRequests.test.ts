// mobile/src/hooks/useFriendRequests.test.ts
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { useFriendRequests } from './useFriendRequests';
import { fetchFriendRequests, respondToFriendRequest, cancelFriendRequest } from '@/api/friendships';
import { useSessionStore } from '@/stores/sessionStore';

jest.mock('@/api/friendships', () => ({
  fetchFriendRequests: jest.fn(),
  respondToFriendRequest: jest.fn(),
  cancelFriendRequest: jest.fn(),
}));

const incomingRequest = { id: 'f1', user: { user_id: 'u2', unique_user_id: 'FC-100002', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null }, created_at: '2026-09-06T10:00:00Z' };
const outgoingRequest = { id: 'f2', user: { user_id: 'u3', unique_user_id: 'FC-100003', first_name: 'Gino', last_name: 'Verdi', profile_image_url: null }, created_at: '2026-09-06T11:00:00Z' };

describe('useFriendRequests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSessionStore.setState({ session: { user: { id: 'u1' } } as never, profile: null, status: 'signed-in' });
    (fetchFriendRequests as jest.Mock).mockResolvedValue({ incoming: [incomingRequest], outgoing: [outgoingRequest] });
  });

  it('fetches incoming and outgoing requests on mount', async () => {
    const { result } = await renderHook(() => useFriendRequests());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchFriendRequests).toHaveBeenCalledWith('u1');
    expect(result.current.incoming).toEqual([incomingRequest]);
    expect(result.current.outgoing).toEqual([outgoingRequest]);
  });

  it('accept responds true and refreshes', async () => {
    (respondToFriendRequest as jest.Mock).mockResolvedValue(undefined);
    const { result } = await renderHook(() => useFriendRequests());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.accept('f1');
    });

    expect(respondToFriendRequest).toHaveBeenCalledWith('f1', true);
    expect(success).toBe(true);
  });

  it('reject responds false and refreshes', async () => {
    (respondToFriendRequest as jest.Mock).mockResolvedValue(undefined);
    const { result } = await renderHook(() => useFriendRequests());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.reject('f1');
    });

    expect(respondToFriendRequest).toHaveBeenCalledWith('f1', false);
  });

  it('cancel withdraws an outgoing request and refreshes', async () => {
    (cancelFriendRequest as jest.Mock).mockResolvedValue(undefined);
    const { result } = await renderHook(() => useFriendRequests());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.cancel('f2');
    });

    expect(cancelFriendRequest).toHaveBeenCalledWith('f2');
  });

  it('accept returns false and sets error on failure', async () => {
    (respondToFriendRequest as jest.Mock).mockRejectedValue(new Error('respond failed'));
    const { result } = await renderHook(() => useFriendRequests());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.accept('f1');
    });

    expect(success).toBe(false);
    expect(result.current.error).toBe('respond failed');
  });
});
