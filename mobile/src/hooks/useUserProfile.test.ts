// mobile/src/hooks/useUserProfile.test.ts
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { useUserProfile } from './useUserProfile';
import { fetchUserProfile } from '@/api/users';
import {
  fetchFriendshipStatus,
  sendFriendRequest,
  respondToFriendRequest,
  cancelFriendRequest,
  removeFriend,
  blockUser,
  unblockUser,
  reportUser,
} from '@/api/friendships';
import { useSessionStore } from '@/stores/sessionStore';

jest.mock('@/api/users', () => ({ fetchUserProfile: jest.fn() }));
jest.mock('@/api/friendships', () => ({
  fetchFriendshipStatus: jest.fn(),
  sendFriendRequest: jest.fn(),
  respondToFriendRequest: jest.fn(),
  cancelFriendRequest: jest.fn(),
  removeFriend: jest.fn(),
  blockUser: jest.fn(),
  unblockUser: jest.fn(),
  reportUser: jest.fn(),
}));

const targetProfile = {
  id: 'u2', unique_user_id: 'FC-100002', first_name: 'Luca', last_name: 'Bianchi',
  birth_date: '1991-01-01', height_cm: 175, preferred_foot: 'left', player_role: 'goalkeeper',
  profile_image_url: null, matches_played_count: 3, matches_completed_count: 2,
};

function mockProfileFetch() {
  (fetchUserProfile as jest.Mock).mockResolvedValue(targetProfile);
}

describe('useUserProfile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSessionStore.setState({ session: { user: { id: 'u1' } } as never, profile: null, status: 'signed-in' });
    (fetchFriendshipStatus as jest.Mock).mockResolvedValue({ kind: 'none' });
  });

  it('loads the target profile and friendship status on mount', async () => {
    mockProfileFetch();

    const { result } = await renderHook(() => useUserProfile('u2'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchFriendshipStatus).toHaveBeenCalledWith('u1', 'u2');
    expect(result.current.profile).toEqual(targetProfile);
    expect(result.current.status).toEqual({ kind: 'none' });
  });

  it('sendRequest calls sendFriendRequest and refreshes status', async () => {
    mockProfileFetch();
    (sendFriendRequest as jest.Mock).mockResolvedValue(undefined);
    const { result } = await renderHook(() => useUserProfile('u2'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.sendRequest();
    });

    expect(sendFriendRequest).toHaveBeenCalledWith('u1', 'u2');
    expect(success).toBe(true);
  });

  it('block calls blockUser and refreshes status', async () => {
    mockProfileFetch();
    (blockUser as jest.Mock).mockResolvedValue(undefined);
    (fetchFriendshipStatus as jest.Mock)
      .mockResolvedValueOnce({ kind: 'friends', friendshipId: 'f1' })
      .mockResolvedValueOnce({ kind: 'blocked_by_me' });
    const { result } = await renderHook(() => useUserProfile('u2'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.block();
    });

    expect(blockUser).toHaveBeenCalledWith('u1', 'u2');
    expect(result.current.status).toEqual({ kind: 'blocked_by_me' });
  });

  it('report calls reportUser with the given reason', async () => {
    mockProfileFetch();
    (reportUser as jest.Mock).mockResolvedValue(undefined);
    const { result } = await renderHook(() => useUserProfile('u2'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.report('Comportamento scorretto');
    });

    expect(reportUser).toHaveBeenCalledWith('u1', 'u2', 'Comportamento scorretto');
    expect(success).toBe(true);
  });

  it('sets actionError and returns false when an action fails', async () => {
    mockProfileFetch();
    (sendFriendRequest as jest.Mock).mockRejectedValue(new Error('send failed'));
    const { result } = await renderHook(() => useUserProfile('u2'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.sendRequest();
    });

    expect(success).toBe(false);
    expect(result.current.actionError).toBe('send failed');
  });
});
