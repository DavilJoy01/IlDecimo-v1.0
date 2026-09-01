// mobile/src/hooks/useRegistration.test.ts
import { renderHook, act } from '@testing-library/react-native';
import { router } from 'expo-router';
import { useRegistration } from './useRegistration';
import { requestPhoneOtp, verifyPhoneOtp, setPassword } from '@/api/auth';
import { createOwnProfile } from '@/api/users';
import { useSessionStore } from '@/stores/sessionStore';
import { useRegistrationStore } from '@/stores/registrationStore';

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
    useRegistrationStore.setState({ phone: '' });
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

  it('confirmOtp reads the phone set by a DIFFERENT useRegistration() instance, simulating navigating from register-phone to a freshly mounted verify-otp screen', async () => {
    (requestPhoneOtp as jest.Mock).mockResolvedValue(undefined);
    (verifyPhoneOtp as jest.Mock).mockResolvedValue({ session: { access_token: 't' } });

    const registerPhoneScreen = await renderHook(() => useRegistration());
    await act(async () => {
      await registerPhoneScreen.result.current.sendOtp('+390000000001');
    });
    (router.push as jest.Mock).mockClear();

    // A real screen transition unmounts register-phone.tsx and mounts a new
    // verify-otp.tsx, each calling useRegistration() independently -- render
    // a SECOND, unrelated hook instance rather than reusing the first one.
    const verifyOtpScreen = await renderHook(() => useRegistration());
    await act(async () => {
      await verifyOtpScreen.result.current.confirmOtp('123456');
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
    useRegistrationStore.setState({ phone: '+390000000001' });
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
      expect.objectContaining({ id: 'u1', first_name: 'Mario', phone: '+390000000001' })
    );
    expect(useSessionStore.getState().profile?.unique_user_id).toBe('FC-100000');
    expect(result.current.error).toBeNull();
  });

  it('completeProfile falls back to the session phone when the registration store has none (e.g. app relaunched mid-registration)', async () => {
    useSessionStore.setState({
      session: { user: { id: 'u1', phone: '390000000002' } } as never,
      profile: null,
      status: 'needs-profile',
    });
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

    expect(createOwnProfile).toHaveBeenCalledWith(expect.objectContaining({ phone: '+390000000002' }));
  });

  it('completeProfile refuses to submit and sets an error when no phone is available from either source', async () => {
    useSessionStore.setState({ session: { user: { id: 'u1' } } as never, profile: null, status: 'needs-profile' });
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

    expect(createOwnProfile).not.toHaveBeenCalled();
    expect(result.current.error).toBeTruthy();
  });

  it('completeProfile clears the registration-scoped phone after a successful submit', async () => {
    useRegistrationStore.setState({ phone: '+390000000001' });
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

    expect(useRegistrationStore.getState().phone).toBe('');
  });
});
