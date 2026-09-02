// mobile/src/hooks/useNotifications.test.ts
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useNotifications } from './useNotifications';
import { fetchNotifications, markNotificationRead } from '@/api/notifications';

jest.mock('@/api/notifications', () => ({
  fetchNotifications: jest.fn(),
  markNotificationRead: jest.fn(),
}));

const unread = { id: 'n1', type: 'join_request_received', payload: { message: 'ciao' }, read_at: null, created_at: '2026-09-02T10:00:00Z' };
const read = { id: 'n2', type: 'join_request_approved', payload: { message: 'approvato' }, read_at: '2026-09-02T09:00:00Z', created_at: '2026-09-01T10:00:00Z' };

describe('useNotifications', () => {
  afterEach(() => jest.clearAllMocks());

  it('fetches notifications on mount and computes unreadCount', async () => {
    (fetchNotifications as jest.Mock).mockResolvedValue([unread, read]);

    const { result } = await renderHook(() => useNotifications());

    await waitFor(() => expect(result.current.notifications).toEqual([unread, read]));
    expect(result.current.unreadCount).toBe(1);
    expect(result.current.loading).toBe(false);
  });

  it('exposes an error when fetching fails', async () => {
    (fetchNotifications as jest.Mock).mockRejectedValue(new Error('fetch failed'));

    const { result } = await renderHook(() => useNotifications());

    await waitFor(() => expect(result.current.error).toBe('fetch failed'));
  });

  it('markRead calls the API and optimistically updates the local list', async () => {
    (fetchNotifications as jest.Mock).mockResolvedValue([unread]);
    (markNotificationRead as jest.Mock).mockResolvedValue(undefined);

    const { result } = await renderHook(() => useNotifications());
    await waitFor(() => expect(result.current.unreadCount).toBe(1));

    await act(async () => {
      await result.current.markRead('n1');
    });

    expect(markNotificationRead).toHaveBeenCalledWith('n1');
    expect(result.current.unreadCount).toBe(0);
    expect(result.current.notifications[0].read_at).not.toBeNull();
  });

  it('markRead leaves the notification unread (no crash) if the API call fails', async () => {
    (fetchNotifications as jest.Mock).mockResolvedValue([unread]);
    (markNotificationRead as jest.Mock).mockRejectedValue(new Error('update failed'));

    const { result } = await renderHook(() => useNotifications());
    await waitFor(() => expect(result.current.unreadCount).toBe(1));

    await act(async () => {
      await result.current.markRead('n1');
    });

    expect(result.current.unreadCount).toBe(1);
  });
});
