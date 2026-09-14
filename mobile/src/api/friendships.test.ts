// mobile/src/api/friendships.test.ts
import { supabase } from './supabase';
import {
  searchUserByCode,
  fetchFriends,
  fetchFriendRequests,
  fetchFriendshipStatus,
  fetchBlockedUsers,
  sendFriendRequest,
  respondToFriendRequest,
  cancelFriendRequest,
  removeFriend,
  blockUser,
  unblockUser,
  reportUser,
} from './friendships';

jest.mock('./supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

describe('friendships api', () => {
  afterEach(() => jest.clearAllMocks());

  describe('searchUserByCode', () => {
    it('returns the found profile', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: { id: 'u2', unique_user_id: 'FC-100002', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null },
        error: null,
      });

      const result = await searchUserByCode('FC-100002');

      expect(supabase.rpc).toHaveBeenCalledWith('search_user_by_code', { p_code: 'FC-100002' });
      expect(result).toEqual({ user_id: 'u2', unique_user_id: 'FC-100002', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null });
    });

    it('returns null when no user is found', async () => {
      // search_user_by_code RETURNs a single public.user_public_profiles row,
      // not SETOF -- confirmed empirically (including through the real
      // PostgREST JSON layer, not just raw psql) that a "not found" call
      // never comes back as `data: null`. It comes back as one row with
      // every column NULL: `{"id": null, "unique_user_id": null, ...}`.
      // This is the realistic shape to test against, not an idealized one.
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: { id: null, unique_user_id: null, first_name: null, last_name: null, profile_image_url: null },
        error: null,
      });

      const result = await searchUserByCode('FC-999999');

      expect(result).toBeNull();
    });

    it('throws the Supabase error message on failure', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: { message: 'search failed' } });

      await expect(searchUserByCode('FC-100002')).rejects.toThrow('search failed');
    });
  });

  describe('fetchFriends', () => {
    it('fetches accepted friendships and merges sender profiles', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'friendships') {
          return {
            select: jest.fn().mockReturnValue({
              or: jest.fn().mockReturnValue({
                eq: jest.fn().mockResolvedValue({
                  data: [
                    { id: 'f1', requester_id: 'u1', receiver_id: 'u2' },
                    { id: 'f2', requester_id: 'u3', receiver_id: 'u1' },
                  ],
                  error: null,
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
                  { id: 'u2', unique_user_id: 'FC-100002', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null },
                  { id: 'u3', unique_user_id: 'FC-100003', first_name: 'Gino', last_name: 'Verdi', profile_image_url: null },
                ],
                error: null,
              }),
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      });

      const result = await fetchFriends('u1');

      expect(result).toEqual([
        { user_id: 'u2', unique_user_id: 'FC-100002', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null },
        { user_id: 'u3', unique_user_id: 'FC-100003', first_name: 'Gino', last_name: 'Verdi', profile_image_url: null },
      ]);
    });

    it('returns an empty array without querying profiles when there are no friendships', async () => {
      const eq = jest.fn().mockResolvedValue({ data: [], error: null });
      const or = jest.fn().mockReturnValue({ eq });
      const fromMock = jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ or }) });
      (supabase.from as jest.Mock).mockImplementation(fromMock);

      const result = await fetchFriends('u1');

      expect(result).toEqual([]);
      expect(fromMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('fetchBlockedUsers', () => {
    it('fetches the users blocked by the caller and merges their public profiles', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'user_blocks') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: [{ blocked_id: 'u2' }, { blocked_id: 'u3' }],
                error: null,
              }),
            }),
          };
        }
        if (table === 'user_public_profiles') {
          return {
            select: jest.fn().mockReturnValue({
              in: jest.fn().mockResolvedValue({
                data: [
                  { id: 'u2', unique_user_id: 'FC-100002', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null },
                  { id: 'u3', unique_user_id: 'FC-100003', first_name: 'Gino', last_name: 'Verdi', profile_image_url: null },
                ],
                error: null,
              }),
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      });

      const result = await fetchBlockedUsers('u1');

      expect(result).toEqual([
        { user_id: 'u2', unique_user_id: 'FC-100002', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null },
        { user_id: 'u3', unique_user_id: 'FC-100003', first_name: 'Gino', last_name: 'Verdi', profile_image_url: null },
      ]);
    });

    it('returns an empty array without querying profiles when nothing is blocked', async () => {
      const eq = jest.fn().mockResolvedValue({ data: [], error: null });
      const fromMock = jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ eq }) });
      (supabase.from as jest.Mock).mockImplementation(fromMock);

      const result = await fetchBlockedUsers('u1');

      expect(result).toEqual([]);
      expect(fromMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('fetchFriendRequests', () => {
    it('splits pending friendships into incoming and outgoing', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'friendships') {
          return {
            select: jest.fn().mockReturnValue({
              or: jest.fn().mockReturnValue({
                eq: jest.fn().mockResolvedValue({
                  data: [
                    { id: 'f1', requester_id: 'u2', receiver_id: 'u1', created_at: '2026-09-06T10:00:00Z' },
                    { id: 'f2', requester_id: 'u1', receiver_id: 'u3', created_at: '2026-09-06T11:00:00Z' },
                  ],
                  error: null,
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
                  { id: 'u2', unique_user_id: 'FC-100002', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null },
                  { id: 'u3', unique_user_id: 'FC-100003', first_name: 'Gino', last_name: 'Verdi', profile_image_url: null },
                ],
                error: null,
              }),
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      });

      const result = await fetchFriendRequests('u1');

      expect(result.incoming).toEqual([
        { id: 'f1', user: { user_id: 'u2', unique_user_id: 'FC-100002', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null }, created_at: '2026-09-06T10:00:00Z' },
      ]);
      expect(result.outgoing).toEqual([
        { id: 'f2', user: { user_id: 'u3', unique_user_id: 'FC-100003', first_name: 'Gino', last_name: 'Verdi', profile_image_url: null }, created_at: '2026-09-06T11:00:00Z' },
      ]);
    });
  });

  describe('fetchFriendshipStatus', () => {
    it('reports friends when an accepted friendship row exists', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'friendships') {
          return {
            select: jest.fn().mockReturnValue({
              or: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'f1', requester_id: 'u1', receiver_id: 'u2', status: 'accepted' }, error: null }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      });

      const result = await fetchFriendshipStatus('u1', 'u2');

      expect(result).toEqual({ kind: 'friends', friendshipId: 'f1' });
    });

    it('reports pending_outgoing when the caller is the requester', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'friendships') {
          return {
            select: jest.fn().mockReturnValue({
              or: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'f1', requester_id: 'u1', receiver_id: 'u2', status: 'pending' }, error: null }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      });

      const result = await fetchFriendshipStatus('u1', 'u2');

      expect(result).toEqual({ kind: 'pending_outgoing', friendshipId: 'f1' });
    });

    it('reports pending_incoming when the caller is the receiver', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'friendships') {
          return {
            select: jest.fn().mockReturnValue({
              or: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'f1', requester_id: 'u2', receiver_id: 'u1', status: 'pending' }, error: null }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      });

      const result = await fetchFriendshipStatus('u1', 'u2');

      expect(result).toEqual({ kind: 'pending_incoming', friendshipId: 'f1' });
    });

    it('checks user_blocks and reports blocked_by_me when no friendship row exists', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'friendships') {
          return {
            select: jest.fn().mockReturnValue({
              or: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          };
        }
        if (table === 'user_blocks') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn().mockResolvedValue({ data: { blocker_id: 'u1', blocked_id: 'u2' }, error: null }),
                }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      });

      const result = await fetchFriendshipStatus('u1', 'u2');

      expect(result).toEqual({ kind: 'blocked_by_me' });
    });

    it('reports none when there is no friendship and no block', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'friendships') {
          return {
            select: jest.fn().mockReturnValue({
              or: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          };
        }
        if (table === 'user_blocks') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      });

      const result = await fetchFriendshipStatus('u1', 'u2');

      expect(result).toEqual({ kind: 'none' });
    });
  });

  describe('sendFriendRequest', () => {
    function mockDeleteThenInsert(insertResult: { error: unknown }) {
      const deleteOr = jest.fn().mockResolvedValue({ error: null });
      const deleteEq = jest.fn().mockReturnValue({ or: deleteOr });
      const del = jest.fn().mockReturnValue({ eq: deleteEq });
      const insert = jest.fn().mockResolvedValue(insertResult);
      (supabase.from as jest.Mock).mockReturnValue({ delete: del, insert });
      return { del, deleteEq, deleteOr, insert };
    }

    it('clears any stale rejected row for the pair before inserting', async () => {
      const { del, deleteEq, deleteOr, insert } = mockDeleteThenInsert({ error: null });

      await sendFriendRequest('u1', 'u2');

      expect(supabase.from).toHaveBeenCalledWith('friendships');
      expect(del).toHaveBeenCalled();
      expect(deleteEq).toHaveBeenCalledWith('status', 'rejected');
      expect(deleteOr).toHaveBeenCalledWith('and(requester_id.eq.u1,receiver_id.eq.u2),and(requester_id.eq.u2,receiver_id.eq.u1)');
      expect(insert).toHaveBeenCalledWith([{ requester_id: 'u1', receiver_id: 'u2' }]);
    });

    it('translates an RLS-denial error (blocked by the other user) to a generic Italian message', async () => {
      mockDeleteThenInsert({ error: { message: 'new row violates row-level security policy for table "friendships"', code: '42501' } });

      await expect(sendFriendRequest('u1', 'u2')).rejects.toThrow('Non è possibile inviare una richiesta a questo utente.');
    });

    it('translates a unique-constraint violation to a generic Italian message', async () => {
      mockDeleteThenInsert({ error: { message: 'duplicate key value violates unique constraint "friendships_unique_pair_idx"', code: '23505' } });

      await expect(sendFriendRequest('u1', 'u2')).rejects.toThrow('Esiste già una richiesta o un’amicizia con questo utente.');
    });

    it('throws the raw Supabase error message for any other failure', async () => {
      mockDeleteThenInsert({ error: { message: 'network error', code: '500' } });

      await expect(sendFriendRequest('u1', 'u2')).rejects.toThrow('network error');
    });
  });

  describe('respondToFriendRequest', () => {
    it('updates status to accepted', async () => {
      const eq = jest.fn().mockResolvedValue({ error: null });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await respondToFriendRequest('f1', true);

      expect(update).toHaveBeenCalledWith({ status: 'accepted' });
      expect(eq).toHaveBeenCalledWith('id', 'f1');
    });

    it('updates status to rejected', async () => {
      const eq = jest.fn().mockResolvedValue({ error: null });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await respondToFriendRequest('f1', false);

      expect(update).toHaveBeenCalledWith({ status: 'rejected' });
    });
  });

  describe('cancelFriendRequest / removeFriend / unblockUser', () => {
    it('cancelFriendRequest deletes the friendships row', async () => {
      const eq = jest.fn().mockResolvedValue({ error: null });
      const del = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ delete: del });

      await cancelFriendRequest('f1');

      expect(supabase.from).toHaveBeenCalledWith('friendships');
      expect(eq).toHaveBeenCalledWith('id', 'f1');
    });

    it('removeFriend deletes the friendships row', async () => {
      const eq = jest.fn().mockResolvedValue({ error: null });
      const del = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ delete: del });

      await removeFriend('f1');

      expect(eq).toHaveBeenCalledWith('id', 'f1');
    });

    it('unblockUser deletes the user_blocks row for the caller and target', async () => {
      const eq2 = jest.fn().mockResolvedValue({ error: null });
      const eq1 = jest.fn().mockReturnValue({ eq: eq2 });
      const del = jest.fn().mockReturnValue({ eq: eq1 });
      (supabase.from as jest.Mock).mockReturnValue({ delete: del });

      await unblockUser('u1', 'u2');

      expect(supabase.from).toHaveBeenCalledWith('user_blocks');
      expect(eq1).toHaveBeenCalledWith('blocker_id', 'u1');
      expect(eq2).toHaveBeenCalledWith('blocked_id', 'u2');
    });
  });

  describe('blockUser', () => {
    it('inserts a user_blocks row', async () => {
      const insert = jest.fn().mockResolvedValue({ error: null });
      (supabase.from as jest.Mock).mockReturnValue({ insert });

      await blockUser('u1', 'u2');

      expect(supabase.from).toHaveBeenCalledWith('user_blocks');
      expect(insert).toHaveBeenCalledWith([{ blocker_id: 'u1', blocked_id: 'u2' }]);
    });
  });

  describe('reportUser', () => {
    it('inserts a reports row with reported_user_id set', async () => {
      const insert = jest.fn().mockResolvedValue({ error: null });
      (supabase.from as jest.Mock).mockReturnValue({ insert });

      await reportUser('u1', 'u2', 'Comportamento scorretto');

      expect(supabase.from).toHaveBeenCalledWith('reports');
      expect(insert).toHaveBeenCalledWith([{ reporter_id: 'u1', reported_user_id: 'u2', reason: 'Comportamento scorretto' }]);
    });
  });
});
