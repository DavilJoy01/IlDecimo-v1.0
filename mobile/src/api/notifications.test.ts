import { supabase } from './supabase';
import { fetchNotifications, markNotificationRead } from './notifications';

jest.mock('./supabase', () => ({ supabase: { from: jest.fn() } }));

describe('notifications api', () => {
  afterEach(() => jest.clearAllMocks());

  describe('fetchNotifications', () => {
    it('selects all notifications ordered by newest first', async () => {
      const order = jest.fn().mockResolvedValue({
        data: [
          { id: 'n1', type: 'join_request_received', payload: { message: 'ciao' }, read_at: null, created_at: '2026-09-02T10:00:00Z' },
        ],
        error: null,
      });
      const select = jest.fn().mockReturnValue({ order });
      (supabase.from as jest.Mock).mockReturnValue({ select });

      const result = await fetchNotifications();

      expect(supabase.from).toHaveBeenCalledWith('notifications');
      expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('n1');
    });

    it('throws the Supabase error message on failure', async () => {
      const order = jest.fn().mockResolvedValue({ data: null, error: { message: 'fetch failed' } });
      const select = jest.fn().mockReturnValue({ order });
      (supabase.from as jest.Mock).mockReturnValue({ select });

      await expect(fetchNotifications()).rejects.toThrow('fetch failed');
    });
  });

  describe('markNotificationRead', () => {
    it('sets read_at on the given notification', async () => {
      const eq = jest.fn().mockResolvedValue({ error: null });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await markNotificationRead('n1');

      expect(supabase.from).toHaveBeenCalledWith('notifications');
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ read_at: expect.any(String) }));
      expect(eq).toHaveBeenCalledWith('id', 'n1');
    });

    it('throws the Supabase error message on failure', async () => {
      const eq = jest.fn().mockResolvedValue({ error: { message: 'update failed' } });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await expect(markNotificationRead('n1')).rejects.toThrow('update failed');
    });
  });
});
