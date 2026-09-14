import { renderHook, waitFor, act } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useNotificationTapObserver } from './useNotificationTapObserver';
import { navigateForNotification } from '@/utils/notificationNavigation';
import { markNotificationRead } from '@/api/notifications';
import { useSessionStore } from '@/stores/sessionStore';

jest.mock('expo-notifications', () => ({
  getLastNotificationResponse: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
}));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('@/utils/notificationNavigation', () => ({ navigateForNotification: jest.fn() }));
jest.mock('@/api/notifications', () => ({ markNotificationRead: jest.fn() }));

function makeResponse(data: Record<string, unknown> | undefined) {
  return { notification: { request: { content: { data } } } } as never;
}

describe('useNotificationTapObserver', () => {
  const router = { push: jest.fn() } as never;
  let listenerCallback: (response: unknown) => void;

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(router);
    (Notifications.getLastNotificationResponse as jest.Mock).mockReturnValue(null);
    (Notifications.addNotificationResponseReceivedListener as jest.Mock).mockImplementation((cb) => {
      listenerCallback = cb;
      return { remove: jest.fn() };
    });
    (markNotificationRead as jest.Mock).mockResolvedValue(undefined);
    useSessionStore.setState({ session: { user: { id: 'u1' } } as never, profile: null, status: 'signed-in' });
  });

  it('navigates for a cold-launch notification response (getLastNotificationResponse)', async () => {
    (Notifications.getLastNotificationResponse as jest.Mock).mockReturnValue(
      makeResponse({ type: 'match_invitation', match_id: 'm1', notification_id: 'n1' })
    );

    await renderHook(() => useNotificationTapObserver());

    expect(navigateForNotification).toHaveBeenCalledWith(
      { type: 'match_invitation', payload: { type: 'match_invitation', match_id: 'm1', notification_id: 'n1' } },
      router,
      'u1'
    );
    expect(markNotificationRead).toHaveBeenCalledWith('n1');
  });

  it('does nothing on mount when there is no last notification response', async () => {
    await renderHook(() => useNotificationTapObserver());

    await waitFor(() => expect(Notifications.getLastNotificationResponse).toHaveBeenCalled());
    expect(navigateForNotification).not.toHaveBeenCalled();
  });

  it('navigates when a live notification response arrives', async () => {
    await renderHook(() => useNotificationTapObserver());
    await waitFor(() => expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalled());

    listenerCallback!(makeResponse({ type: 'private_message', conversation_id: 'c1' }));

    await waitFor(() => expect(navigateForNotification).toHaveBeenCalled());
    expect(markNotificationRead).not.toHaveBeenCalled();
  });

  it('ignores a response with no type in its data', async () => {
    await renderHook(() => useNotificationTapObserver());
    await waitFor(() => expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalled());

    listenerCallback!(makeResponse({ match_id: 'm1' }));
    listenerCallback!(makeResponse(undefined));

    expect(navigateForNotification).not.toHaveBeenCalled();
  });

  it('removes the listener subscription on unmount', async () => {
    const remove = jest.fn();
    (Notifications.addNotificationResponseReceivedListener as jest.Mock).mockReturnValue({ remove });

    const { unmount } = await renderHook(() => useNotificationTapObserver());
    await act(async () => {
      unmount();
    });

    expect(remove).toHaveBeenCalled();
  });
});
