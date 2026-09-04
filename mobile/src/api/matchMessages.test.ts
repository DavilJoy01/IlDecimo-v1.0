// mobile/src/api/matchMessages.test.ts
import { supabase } from './supabase';
import { fetchMatchMessages, fetchChatParticipants, sendMatchMessage } from './matchMessages';

jest.mock('./supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

describe('matchMessages api', () => {
  afterEach(() => jest.clearAllMocks());

  describe('fetchMatchMessages', () => {
    it('fetches the last N messages newest-first and merges sender profiles', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'match_messages') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                order: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue({
                    data: [
                      { id: 'm2', match_id: 'match1', sender_id: 'u2', body: 'seconda', created_at: '2026-09-04T10:01:00Z' },
                      { id: 'm1', match_id: 'match1', sender_id: 'u1', body: 'prima', created_at: '2026-09-04T10:00:00Z' },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'user_public_profiles') {
          return {
            select: jest.fn().mockReturnValue({
              in: jest.fn().mockResolvedValue({
                data: [
                  { id: 'u1', first_name: 'Mario', last_name: 'Rossi', profile_image_url: null },
                  { id: 'u2', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null },
                ],
                error: null,
              }),
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      });

      const result = await fetchMatchMessages('match1');

      expect(result).toEqual([
        { id: 'm2', match_id: 'match1', sender_id: 'u2', body: 'seconda', created_at: '2026-09-04T10:01:00Z', sender: { first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null } },
        { id: 'm1', match_id: 'match1', sender_id: 'u1', body: 'prima', created_at: '2026-09-04T10:00:00Z', sender: { first_name: 'Mario', last_name: 'Rossi', profile_image_url: null } },
      ]);
    });

    it('returns an empty array without querying profiles when there are no messages', async () => {
      const limit = jest.fn().mockResolvedValue({ data: [], error: null });
      const order = jest.fn().mockReturnValue({ limit });
      const eq = jest.fn().mockReturnValue({ order });
      const fromMock = jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ eq }) });
      (supabase.from as jest.Mock).mockImplementation(fromMock);

      const result = await fetchMatchMessages('match1');

      expect(result).toEqual([]);
      expect(fromMock).toHaveBeenCalledTimes(1);
    });

    it('throws the Supabase error message when the messages query fails', async () => {
      const limit = jest.fn().mockResolvedValue({ data: null, error: { message: 'messages failed' } });
      const order = jest.fn().mockReturnValue({ limit });
      const eq = jest.fn().mockReturnValue({ order });
      (supabase.from as jest.Mock).mockReturnValue({ select: jest.fn().mockReturnValue({ eq }) });

      await expect(fetchMatchMessages('match1')).rejects.toThrow('messages failed');
    });
  });

  describe('fetchChatParticipants', () => {
    it('combines the creator and approved/active participants into one list', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'matches') {
          return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { creator_id: 'u1' }, error: null }) }) }) };
        }
        if (table === 'match_participants') {
          return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ in: jest.fn().mockResolvedValue({ data: [{ user_id: 'u2' }], error: null }) }) }) };
        }
        if (table === 'user_public_profiles') {
          return {
            select: jest.fn().mockReturnValue({
              in: jest.fn().mockResolvedValue({
                data: [
                  { id: 'u1', first_name: 'Mario', last_name: 'Rossi', profile_image_url: null },
                  { id: 'u2', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null },
                ],
                error: null,
              }),
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      });

      const result = await fetchChatParticipants('match1');

      expect(result).toEqual([
        { user_id: 'u1', first_name: 'Mario', last_name: 'Rossi', profile_image_url: null },
        { user_id: 'u2', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null },
      ]);
    });

    it('throws the Supabase error message when the match lookup fails', async () => {
      (supabase.from as jest.Mock).mockReturnValue({ select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: { message: 'match lookup failed' } }) }) }) });

      await expect(fetchChatParticipants('match1')).rejects.toThrow('match lookup failed');
    });
  });

  describe('sendMatchMessage', () => {
    it('calls the send_match_message RPC and returns the created message', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: { id: 'm3', match_id: 'match1', sender_id: 'u1', body: 'ciao', created_at: '2026-09-04T10:02:00Z' },
        error: null,
      });

      const result = await sendMatchMessage('match1', 'ciao', ['u2']);

      expect(supabase.rpc).toHaveBeenCalledWith('send_match_message', { p_match_id: 'match1', p_body: 'ciao', p_mentions: ['u2'] });
      expect(result).toEqual({ id: 'm3', match_id: 'match1', sender_id: 'u1', body: 'ciao', created_at: '2026-09-04T10:02:00Z' });
    });

    it('throws the Supabase error message on failure', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: { message: 'send failed' } });

      await expect(sendMatchMessage('match1', 'ciao', [])).rejects.toThrow('send failed');
    });
  });
});
