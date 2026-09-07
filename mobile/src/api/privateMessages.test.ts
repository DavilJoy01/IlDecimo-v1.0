// mobile/src/api/privateMessages.test.ts
import { supabase } from './supabase';
import {
  fetchConversations,
  findOrCreateConversation,
  fetchMessages,
  sendPrivateMessage,
  markConversationRead,
} from './privateMessages';

jest.mock('./supabase', () => ({ supabase: { from: jest.fn() } }));

describe('privateMessages api', () => {
  afterEach(() => jest.clearAllMocks());

  describe('fetchConversations', () => {
    it('merges conversations with the other party profile, latest message, and unread flag', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'private_conversations') {
          return {
            select: jest.fn().mockReturnValue({
              or: jest.fn().mockResolvedValue({
                data: [{ id: 'c1', user_a_id: 'u1', user_b_id: 'u2' }],
                error: null,
              }),
            }),
          };
        }
        if (table === 'user_public_profiles') {
          return {
            select: jest.fn().mockReturnValue({
              in: jest.fn().mockResolvedValue({
                data: [{ id: 'u2', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null }],
                error: null,
              }),
            }),
          };
        }
        if (table === 'private_messages') {
          return {
            select: jest.fn().mockReturnValue({
              in: jest.fn().mockReturnValue({
                order: jest.fn().mockResolvedValue({
                  data: [
                    { conversation_id: 'c1', sender_id: 'u2', body: 'Ciao!', read_at: null, created_at: '2026-09-07T10:01:00Z' },
                    { conversation_id: 'c1', sender_id: 'u1', body: 'Prima', read_at: '2026-09-07T10:00:30Z', created_at: '2026-09-07T10:00:00Z' },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      });

      const result = await fetchConversations('u1');

      expect(result).toEqual([
        {
          conversation_id: 'c1',
          other_user: { user_id: 'u2', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null },
          last_message: { body: 'Ciao!', created_at: '2026-09-07T10:01:00Z', sender_id: 'u2' },
          unread: true,
        },
      ]);
    });

    it('returns an empty array without further queries when there are no conversations', async () => {
      const or = jest.fn().mockResolvedValue({ data: [], error: null });
      const fromMock = jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ or }) });
      (supabase.from as jest.Mock).mockImplementation(fromMock);

      const result = await fetchConversations('u1');

      expect(result).toEqual([]);
      expect(fromMock).toHaveBeenCalledTimes(1);
    });

    it('reports unread false when the only message from the other party is already read', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'private_conversations') {
          return { select: jest.fn().mockReturnValue({ or: jest.fn().mockResolvedValue({ data: [{ id: 'c1', user_a_id: 'u1', user_b_id: 'u2' }], error: null }) }) };
        }
        if (table === 'user_public_profiles') {
          return { select: jest.fn().mockReturnValue({ in: jest.fn().mockResolvedValue({ data: [{ id: 'u2', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null }], error: null }) }) };
        }
        if (table === 'private_messages') {
          return {
            select: jest.fn().mockReturnValue({
              in: jest.fn().mockReturnValue({
                order: jest.fn().mockResolvedValue({
                  data: [{ conversation_id: 'c1', sender_id: 'u2', body: 'Ciao!', read_at: '2026-09-07T10:02:00Z', created_at: '2026-09-07T10:01:00Z' }],
                  error: null,
                }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      });

      const result = await fetchConversations('u1');

      expect(result[0].unread).toBe(false);
    });
  });

  describe('findOrCreateConversation', () => {
    it('returns the existing conversation id when the pair already has one', async () => {
      const maybeSingle = jest.fn().mockResolvedValue({ data: { id: 'c1' }, error: null });
      const or = jest.fn().mockReturnValue({ maybeSingle });
      (supabase.from as jest.Mock).mockReturnValue({ select: jest.fn().mockReturnValue({ or }) });

      const result = await findOrCreateConversation('u1', 'u2');

      expect(result).toBe('c1');
      expect(or).toHaveBeenCalledWith('and(user_a_id.eq.u1,user_b_id.eq.u2),and(user_a_id.eq.u2,user_b_id.eq.u1)');
    });

    it('inserts a new conversation when none exists yet', async () => {
      const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
      const or = jest.fn().mockReturnValue({ maybeSingle });
      const insertSingle = jest.fn().mockResolvedValue({ data: { id: 'c2' }, error: null });
      const insertSelect = jest.fn().mockReturnValue({ single: insertSingle });
      const insert = jest.fn().mockReturnValue({ select: insertSelect });
      (supabase.from as jest.Mock).mockReturnValue({ select: jest.fn().mockReturnValue({ or }), insert });

      const result = await findOrCreateConversation('u1', 'u2');

      expect(insert).toHaveBeenCalledWith([{ user_a_id: 'u1', user_b_id: 'u2' }]);
      expect(result).toBe('c2');
    });

    it('recovers the winning row on a concurrent-insert race (23505)', async () => {
      const selectOr = jest.fn()
        .mockReturnValueOnce({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) })
        .mockReturnValueOnce({ single: jest.fn().mockResolvedValue({ data: { id: 'c3' }, error: null }) });
      const insertSingle = jest.fn().mockResolvedValue({ data: null, error: { message: 'duplicate key value violates unique constraint "private_conversations_unique_pair_idx"', code: '23505' } });
      const insert = jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: insertSingle }) });
      (supabase.from as jest.Mock).mockReturnValue({ select: jest.fn().mockReturnValue({ or: selectOr }), insert });

      const result = await findOrCreateConversation('u1', 'u2');

      expect(result).toBe('c3');
    });

    it('throws the raw Supabase error message for any other insert failure', async () => {
      const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
      const or = jest.fn().mockReturnValue({ maybeSingle });
      const insertSingle = jest.fn().mockResolvedValue({ data: null, error: { message: 'network error', code: '500' } });
      const insert = jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: insertSingle }) });
      (supabase.from as jest.Mock).mockReturnValue({ select: jest.fn().mockReturnValue({ or }), insert });

      await expect(findOrCreateConversation('u1', 'u2')).rejects.toThrow('network error');
    });

    it('translates an RLS-denial error (blocked by the other user) to a generic Italian message', async () => {
      const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
      const or = jest.fn().mockReturnValue({ maybeSingle });
      const insertSingle = jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'new row violates row-level security policy for table "private_conversations"', code: '42501' },
      });
      const insert = jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: insertSingle }) });
      (supabase.from as jest.Mock).mockReturnValue({ select: jest.fn().mockReturnValue({ or }), insert });

      await expect(findOrCreateConversation('u1', 'u2')).rejects.toThrow('Non è possibile inviare un messaggio a questo utente.');
    });
  });

  describe('fetchMessages', () => {
    it('fetches the last N messages newest-first', async () => {
      const limit = jest.fn().mockResolvedValue({
        data: [
          { id: 'm2', conversation_id: 'c1', sender_id: 'u2', body: 'seconda', read_at: null, created_at: '2026-09-07T10:01:00Z' },
          { id: 'm1', conversation_id: 'c1', sender_id: 'u1', body: 'prima', read_at: null, created_at: '2026-09-07T10:00:00Z' },
        ],
        error: null,
      });
      const order = jest.fn().mockReturnValue({ limit });
      const eq = jest.fn().mockReturnValue({ order });
      (supabase.from as jest.Mock).mockReturnValue({ select: jest.fn().mockReturnValue({ eq }) });

      const result = await fetchMessages('c1');

      expect(result).toEqual([
        { id: 'm2', conversation_id: 'c1', sender_id: 'u2', body: 'seconda', read_at: null, created_at: '2026-09-07T10:01:00Z' },
        { id: 'm1', conversation_id: 'c1', sender_id: 'u1', body: 'prima', read_at: null, created_at: '2026-09-07T10:00:00Z' },
      ]);
    });

    it('throws the Supabase error message when the query fails', async () => {
      const limit = jest.fn().mockResolvedValue({ data: null, error: { message: 'messages failed' } });
      const order = jest.fn().mockReturnValue({ limit });
      const eq = jest.fn().mockReturnValue({ order });
      (supabase.from as jest.Mock).mockReturnValue({ select: jest.fn().mockReturnValue({ eq }) });

      await expect(fetchMessages('c1')).rejects.toThrow('messages failed');
    });
  });

  describe('sendPrivateMessage', () => {
    it('inserts a message and returns the created row', async () => {
      const single = jest.fn().mockResolvedValue({
        data: { id: 'm3', conversation_id: 'c1', sender_id: 'u1', body: 'ciao', read_at: null, created_at: '2026-09-07T10:02:00Z' },
        error: null,
      });
      const select = jest.fn().mockReturnValue({ single });
      const insert = jest.fn().mockReturnValue({ select });
      (supabase.from as jest.Mock).mockReturnValue({ insert });

      const result = await sendPrivateMessage('c1', 'u1', 'ciao');

      expect(insert).toHaveBeenCalledWith([{ conversation_id: 'c1', sender_id: 'u1', body: 'ciao' }]);
      expect(result).toEqual({ id: 'm3', conversation_id: 'c1', sender_id: 'u1', body: 'ciao', read_at: null, created_at: '2026-09-07T10:02:00Z' });
    });

    it('throws the Supabase error message on failure', async () => {
      const single = jest.fn().mockResolvedValue({ data: null, error: { message: 'send failed' } });
      const select = jest.fn().mockReturnValue({ single });
      (supabase.from as jest.Mock).mockReturnValue({ insert: jest.fn().mockReturnValue({ select }) });

      await expect(sendPrivateMessage('c1', 'u1', 'ciao')).rejects.toThrow('send failed');
    });

    it('translates an RLS-denial error (blocked by the other user) to a generic Italian message', async () => {
      const single = jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'new row violates row-level security policy for table "private_messages"', code: '42501' },
      });
      const select = jest.fn().mockReturnValue({ single });
      (supabase.from as jest.Mock).mockReturnValue({ insert: jest.fn().mockReturnValue({ select }) });

      await expect(sendPrivateMessage('c1', 'u1', 'ciao')).rejects.toThrow('Non è possibile inviare un messaggio a questo utente.');
    });
  });

  describe('markConversationRead', () => {
    it('marks the other sender\'s unread messages as read', async () => {
      const is = jest.fn().mockResolvedValue({ error: null });
      const neq = jest.fn().mockReturnValue({ is });
      const eq = jest.fn().mockReturnValue({ neq });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await markConversationRead('c1', 'u1');

      expect(update.mock.calls[0][0]).toHaveProperty('read_at');
      expect(eq).toHaveBeenCalledWith('conversation_id', 'c1');
      expect(neq).toHaveBeenCalledWith('sender_id', 'u1');
      expect(is).toHaveBeenCalledWith('read_at', null);
    });
  });
});
