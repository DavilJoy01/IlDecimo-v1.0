import { renderHook, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useRegisterPushToken } from './useRegisterPushToken';
import { savePushToken } from '@/api/pushNotifications';
import { useSessionStore } from '@/stores/sessionStore';

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  AndroidImportance: { DEFAULT: 3 },
}));
jest.mock('expo-constants', () => ({ expoConfig: { extra: { eas: { projectId: 'test-project-id' } } } }));
jest.mock('@/api/pushNotifications', () => ({ savePushToken: jest.fn() }));

describe('useRegisterPushToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = 'ios';
    useSessionStore.setState({ session: { user: { id: 'u1' } } as never, profile: null, status: 'signed-in' });
  });
  afterEach(() => {
    Platform.OS = 'ios';
  });

  it('does nothing when there is no session', async () => {
    useSessionStore.setState({ session: null, profile: null, status: 'signed-out' });

    await renderHook(() => useRegisterPushToken());

    expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
  });

  it('registers and saves the token when permission is already granted', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({ data: 'ExponentPushToken[abc]' });

    await renderHook(() => useRegisterPushToken());

    await waitFor(() => expect(savePushToken).toHaveBeenCalledWith('u1', 'ExponentPushToken[abc]'));
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'test-project-id' });
  });

  it('requests permission when not already granted, then registers on approval', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'undetermined' });
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({ data: 'ExponentPushToken[abc]' });

    await renderHook(() => useRegisterPushToken());

    await waitFor(() => expect(savePushToken).toHaveBeenCalledWith('u1', 'ExponentPushToken[abc]'));
  });

  it('does not request a token when permission is denied', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'undetermined' });
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });

    await renderHook(() => useRegisterPushToken());

    await waitFor(() => expect(Notifications.requestPermissionsAsync).toHaveBeenCalled());
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(savePushToken).not.toHaveBeenCalled();
  });

  it('does not request a token when no EAS projectId is configured', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Constants as unknown as { expoConfig: unknown }).expoConfig = { extra: {} };

    await renderHook(() => useRegisterPushToken());

    await waitFor(() => expect(Notifications.getPermissionsAsync).toHaveBeenCalled());
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();

    (Constants as unknown as { expoConfig: unknown }).expoConfig = { extra: { eas: { projectId: 'test-project-id' } } };
  });

  it('never throws, even when getExpoPushTokenAsync fails (e.g. on a simulator)', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockRejectedValue(new Error('no push service available'));

    await renderHook(() => useRegisterPushToken());

    await waitFor(() => expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalled());
    expect(savePushToken).not.toHaveBeenCalled();
  });

  it('sets up a notification channel before checking permissions on Android', async () => {
    Platform.OS = 'android';
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({ data: 'ExponentPushToken[abc]' });

    await renderHook(() => useRegisterPushToken());

    await waitFor(() => expect(savePushToken).toHaveBeenCalled());
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
      'default',
      expect.objectContaining({ name: 'default' })
    );
  });

  it('does not set up a notification channel on iOS', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({ data: 'ExponentPushToken[abc]' });

    await renderHook(() => useRegisterPushToken());

    await waitFor(() => expect(savePushToken).toHaveBeenCalled());
    expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
  });
});
