// mobile/src/hooks/useRegistration.test.ts
import { renderHook, act } from '@testing-library/react-native';
import { router } from 'expo-router';
import { useRegistration } from './useRegistration';
import { requestPhoneOtp, verifyPhoneOtp, setPassword } from '@/api/auth';
import { createOwnProfile } from '@/api/users';
import { useSessionStore } from '@/stores/sessionStore';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/api/auth', () => ({
  requestPhoneOtp: jest.fn(),
  verifyPhoneOtp: jest.fn(),
  setPassword: jest.fn(),
}));
jest.mock('@/api/users', () => ({ createOwnProfile: jest.fn() }));

describe('useRegistration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSessionStore.setState({ session: null, profile: null, status: 'loading' });
  });

  it('sendOtp requests an OTP, stores the phone, and navigates to verify-otp', async () => {
    (requestPhoneOtp as jest.Mock).mockResolvedValue(undefined);
    const { result } = await renderHook(() => useRegistration());

    await act(async () => {
      await result.current.sendOtp('+390000000001');
    });

    expect(requestPhoneOtp).toHaveBeenCalledWith('+390000000001');
    expect(router.push).toHaveBeenCalledWith('/(auth)/verify-otp');
    expect(result.current.error).toBeNull();
  });

  it('sendOtp sets an error and does not navigate when the request fails', async () => {
    (requestPhoneOtp as jest.Mock).mockRejectedValue(new Error('rate limited'));
    const { result } = await renderHook(() => useRegistration());

    await act(async () => {
      await result.current.sendOtp('+390000000001');
    });

    expect(result.current.error).toBe('rate limited');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('confirmOtp verifies the code against the phone stored by sendOtp, and navigates to create-password', async () => {
    (requestPhoneOtp as jest.Mock).mockResolvedValue(undefined);
    (verifyPhoneOtp as jest.Mock).mockResolvedValue({ session: { access_token: 't' } });
    const { result } = await renderHook(() => useRegistration());

    await act(async () => {
      await result.current.sendOtp('+390000000001');
    });
    (router.push as jest.Mock).mockClear();

    await act(async () => {
      await result.current.confirmOtp('123456');
    });

    expect(verifyPhoneOtp).toHaveBeenCalledWith('+390000000001', '123456');
    expect(router.push).toHaveBeenCalledWith('/(auth)/create-password');
  });

  it('choosePassword sets the password and navigates to create-profile', async () => {
    (setPassword as jest.Mock).mockResolvedValue(undefined);
    const { result } = await renderHook(() => useRegistration());

    await act(async () => {
      await result.current.choosePassword('S3curePass!');
    });

    expect(setPassword).toHaveBeenCalledWith('S3curePass!');
    expect(router.push).toHaveBeenCalledWith('/(auth)/create-profile');
    expect(result.current.error).toBeNull();
  });

  it('choosePassword sets an error and does not navigate when it fails', async () => {
    (setPassword as jest.Mock).mockRejectedValue(new Error('weak password'));
    const { result } = await renderHook(() => useRegistration());

    await act(async () => {
      await result.current.choosePassword('weak');
    });

    expect(result.current.error).toBe('weak password');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('completeProfile creates the profile, stores it in the session store, and clears any prior error', async () => {
    (createOwnProfile as jest.Mock).mockResolvedValue({ id: 'u1', unique_user_id: 'FC-100000' });
    const { result } = await renderHook(() => useRegistration());

    await act(async () => {
      await result.current.completeProfile({
        userId: 'u1',
        firstName: 'Mario',
        lastName: 'Rossi',
        birthDate: '1990-01-01',
        heightCm: 180,
        preferredFoot: 'right',
        playerRole: 'player',
      });
    });

    expect(createOwnProfile).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1', first_name: 'Mario' })
    );
    expect(useSessionStore.getState().profile?.unique_user_id).toBe('FC-100000');
    expect(result.current.error).toBeNull();
  });
});
