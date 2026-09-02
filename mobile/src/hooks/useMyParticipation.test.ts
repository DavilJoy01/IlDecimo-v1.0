import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useMyParticipation } from './useMyParticipation';
import { fetchMyParticipation, requestToJoin, reRequestToJoin, leaveMatch } from '@/api/participants';
import { useSessionStore } from '@/stores/sessionStore';

jest.mock('@/api/participants', () => ({
  fetchMyParticipation: jest.fn(),
  requestToJoin: jest.fn(),
  reRequestToJoin: jest.fn(),
  leaveMatch: jest.fn(),
}));

describe('useMyParticipation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSessionStore.setState({ session: { user: { id: 'u1' } } as never, profile: null, status: 'signed-in' });
  });

  it('fetches the current user\'s participation for the match on mount', async () => {
    (fetchMyParticipation as jest.Mock).mockResolvedValue({ id: 'p1', status: 'approved', leave_count: 0 });

    const { result } = await renderHook(() => useMyParticipation('m1'));

    await waitFor(() => expect(result.current.participation).toEqual({ id: 'p1', status: 'approved', leave_count: 0 }));
    expect(fetchMyParticipation).toHaveBeenCalledWith('m1', 'u1');
    expect(result.current.loading).toBe(false);
  });

  it('does not fetch and reports an error when there is no session', async () => {
    useSessionStore.setState({ session: null, profile: null, status: 'signed-out' });

    const { result } = await renderHook(() => useMyParticipation('m1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMyParticipation).not.toHaveBeenCalled();

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.requestJoin();
    });
    expect(success).toBe(false);
    expect(result.current.error).toBeTruthy();
  });

  it('requestJoin calls requestToJoin and refreshes the participation', async () => {
    (fetchMyParticipation as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'p1', status: 'requested', leave_count: 0 });
    (requestToJoin as jest.Mock).mockResolvedValue(undefined);

    const { result } = await renderHook(() => useMyParticipation('m1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.requestJoin();
    });

    expect(requestToJoin).toHaveBeenCalledWith('m1', 'u1');
    expect(success).toBe(true);
    expect(result.current.participation).toEqual({ id: 'p1', status: 'requested', leave_count: 0 });
  });

  it('requestJoin sets an error and returns false on failure', async () => {
    (fetchMyParticipation as jest.Mock).mockResolvedValue(null);
    (requestToJoin as jest.Mock).mockRejectedValue(new Error('insert failed'));

    const { result } = await renderHook(() => useMyParticipation('m1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.requestJoin();
    });

    expect(success).toBe(false);
    expect(result.current.error).toBe('insert failed');
  });

  it('requestAgain calls reRequestToJoin with the participation row id', async () => {
    (fetchMyParticipation as jest.Mock)
      .mockResolvedValueOnce({ id: 'p1', status: 'left', leave_count: 1 })
      .mockResolvedValueOnce({ id: 'p1', status: 'requested', leave_count: 1 });
    (reRequestToJoin as jest.Mock).mockResolvedValue(undefined);

    const { result } = await renderHook(() => useMyParticipation('m1'));
    await waitFor(() => expect(result.current.participation?.status).toBe('left'));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.requestAgain();
    });

    expect(reRequestToJoin).toHaveBeenCalledWith('p1');
    expect(success).toBe(true);
    expect(result.current.participation?.status).toBe('requested');
  });

  it('requestAgain sets an error and returns false when the backend rejects it (leave_count limit)', async () => {
    (fetchMyParticipation as jest.Mock).mockResolvedValue({ id: 'p1', status: 'left', leave_count: 2 });
    (reRequestToJoin as jest.Mock).mockRejectedValue(new Error('maximum number of re-entries (2) reached for this match'));

    const { result } = await renderHook(() => useMyParticipation('m1'));
    await waitFor(() => expect(result.current.participation?.status).toBe('left'));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.requestAgain();
    });

    expect(success).toBe(false);
    expect(result.current.error).toBe('maximum number of re-entries (2) reached for this match');
  });

  it('leave calls leaveMatch with the participation row id and refreshes', async () => {
    (fetchMyParticipation as jest.Mock)
      .mockResolvedValueOnce({ id: 'p1', status: 'approved', leave_count: 0 })
      .mockResolvedValueOnce({ id: 'p1', status: 'left', leave_count: 1 });
    (leaveMatch as jest.Mock).mockResolvedValue(undefined);

    const { result } = await renderHook(() => useMyParticipation('m1'));
    await waitFor(() => expect(result.current.participation?.status).toBe('approved'));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.leave();
    });

    expect(leaveMatch).toHaveBeenCalledWith('p1');
    expect(success).toBe(true);
    expect(result.current.participation?.status).toBe('left');
  });
});
