import { supabase } from './supabase';
import { signInWithPassword, requestPhoneOtp, verifyPhoneOtp, setPassword, deleteOwnAccount } from './auth';

jest.mock('./supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: jest.fn(),
      signInWithOtp: jest.fn(),
      verifyOtp: jest.fn(),
      updateUser: jest.fn(),
    },
    rpc: jest.fn(),
  },
}));

describe('auth api', () => {
  afterEach(() => jest.clearAllMocks());

  it('signInWithPassword calls supabase with phone and password, returns data', async () => {
    (supabase.auth.signInWithPassword as jest.Mock).mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    const result = await signInWithPassword('+390000000001', 'hunter2');
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({ phone: '+390000000001', password: 'hunter2' });
    expect(result.user?.id).toBe('u1');
  });

  it('signInWithPassword throws the Supabase error message on failure', async () => {
    (supabase.auth.signInWithPassword as jest.Mock).mockResolvedValue({ data: null, error: { message: 'Invalid login credentials' } });
    await expect(signInWithPassword('+390000000001', 'wrong')).rejects.toThrow('Invalid login credentials');
  });

  it('requestPhoneOtp calls signInWithOtp with the phone number', async () => {
    (supabase.auth.signInWithOtp as jest.Mock).mockResolvedValue({ data: {}, error: null });
    await requestPhoneOtp('+390000000001');
    expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({ phone: '+390000000001' });
  });

  it('verifyPhoneOtp calls verifyOtp with phone, token, and sms type', async () => {
    (supabase.auth.verifyOtp as jest.Mock).mockResolvedValue({ data: { session: { access_token: 't' } }, error: null });
    const result = await verifyPhoneOtp('+390000000001', '123456');
    expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({ phone: '+390000000001', token: '123456', type: 'sms' });
    expect(result.session?.access_token).toBe('t');
  });

  it('setPassword calls updateUser with the new password', async () => {
    (supabase.auth.updateUser as jest.Mock).mockResolvedValue({ data: {}, error: null });
    await setPassword('newpass123');
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'newpass123' });
  });

  it('deleteOwnAccount calls the delete_own_account RPC with no arguments', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: null });
    await deleteOwnAccount();
    expect(supabase.rpc).toHaveBeenCalledWith('delete_own_account');
  });

  it('deleteOwnAccount throws the Supabase error message on failure', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: { message: 'must be authenticated to delete an account' } });
    await expect(deleteOwnAccount()).rejects.toThrow('must be authenticated to delete an account');
  });
});
