import { supabase } from './supabase';
import { savePushToken } from './pushNotifications';

jest.mock('./supabase', () => ({ supabase: { from: jest.fn() } }));

describe('savePushToken', () => {
  afterEach(() => jest.clearAllMocks());

  it('inserts the token for the user', async () => {
    const insert = jest.fn().mockResolvedValue({ error: null });
    (supabase.from as jest.Mock).mockReturnValue({ insert });

    await savePushToken('u1', 'ExponentPushToken[abc]');

    expect(supabase.from).toHaveBeenCalledWith('user_push_tokens');
    expect(insert).toHaveBeenCalledWith([{ user_id: 'u1', push_token: 'ExponentPushToken[abc]' }]);
  });

  it('does not throw when the token is already saved (unique violation)', async () => {
    const insert = jest.fn().mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } });
    (supabase.from as jest.Mock).mockReturnValue({ insert });

    await expect(savePushToken('u1', 'ExponentPushToken[abc]')).resolves.toBeUndefined();
  });

  it('throws for any other error', async () => {
    const insert = jest.fn().mockResolvedValue({ error: { code: '42501', message: 'permission denied' } });
    (supabase.from as jest.Mock).mockReturnValue({ insert });

    await expect(savePushToken('u1', 'ExponentPushToken[abc]')).rejects.toThrow('permission denied');
  });
});
