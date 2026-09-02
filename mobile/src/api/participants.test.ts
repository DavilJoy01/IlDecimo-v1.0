// mobile/src/api/participants.test.ts
import { supabase } from './supabase';
import {
  requestToJoin,
  reRequestToJoin,
  leaveMatch,
  approveParticipant,
  rejectParticipant,
  fetchMyParticipation,
  fetchMatchParticipantProfiles,
  fetchMyParticipatingMatches,
} from './participants';

jest.mock('./supabase', () => ({ supabase: { from: jest.fn() } }));

describe('participants api', () => {
  afterEach(() => jest.clearAllMocks());

  describe('requestToJoin', () => {
    it('inserts a requested row for the given match and user', async () => {
      const insert = jest.fn().mockResolvedValue({ error: null });
      (supabase.from as jest.Mock).mockReturnValue({ insert });

      await requestToJoin('m1', 'u1');

      expect(supabase.from).toHaveBeenCalledWith('match_participants');
      expect(insert).toHaveBeenCalledWith([{ match_id: 'm1', user_id: 'u1', status: 'requested' }]);
    });

    it('throws the Supabase error message on failure', async () => {
      const insert = jest.fn().mockResolvedValue({ error: { message: 'insert failed' } });
      (supabase.from as jest.Mock).mockReturnValue({ insert });

      await expect(requestToJoin('m1', 'u1')).rejects.toThrow('insert failed');
    });
  });

  describe('reRequestToJoin', () => {
    it('updates the participation row back to requested', async () => {
      const eq = jest.fn().mockResolvedValue({ error: null });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await reRequestToJoin('p1');

      expect(supabase.from).toHaveBeenCalledWith('match_participants');
      expect(update).toHaveBeenCalledWith({ status: 'requested' });
      expect(eq).toHaveBeenCalledWith('id', 'p1');
    });

    it('throws the Supabase error message on failure (e.g. leave_count >= 2)', async () => {
      const eq = jest.fn().mockResolvedValue({ error: { message: 'maximum number of re-entries (2) reached for this match' } });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await expect(reRequestToJoin('p1')).rejects.toThrow('maximum number of re-entries (2) reached for this match');
    });
  });

  describe('leaveMatch', () => {
    it('updates the participation row to left', async () => {
      const eq = jest.fn().mockResolvedValue({ error: null });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await leaveMatch('p1');

      expect(update).toHaveBeenCalledWith({ status: 'left' });
      expect(eq).toHaveBeenCalledWith('id', 'p1');
    });

    it('throws the Supabase error message on failure', async () => {
      const eq = jest.fn().mockResolvedValue({ error: { message: 'leave failed' } });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await expect(leaveMatch('p1')).rejects.toThrow('leave failed');
    });
  });

  describe('approveParticipant', () => {
    it('updates the participation row to approved', async () => {
      const eq = jest.fn().mockResolvedValue({ error: null });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await approveParticipant('p1');

      expect(update).toHaveBeenCalledWith({ status: 'approved' });
      expect(eq).toHaveBeenCalledWith('id', 'p1');
    });

    it('throws the Supabase error message on failure', async () => {
      const eq = jest.fn().mockResolvedValue({ error: { message: 'approve failed' } });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await expect(approveParticipant('p1')).rejects.toThrow('approve failed');
    });
  });

  describe('rejectParticipant', () => {
    it('updates the participation row to rejected', async () => {
      const eq = jest.fn().mockResolvedValue({ error: null });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await rejectParticipant('p1');

      expect(update).toHaveBeenCalledWith({ status: 'rejected' });
      expect(eq).toHaveBeenCalledWith('id', 'p1');
    });

    it('throws the Supabase error message on failure', async () => {
      const eq = jest.fn().mockResolvedValue({ error: { message: 'reject failed' } });
      const update = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await expect(rejectParticipant('p1')).rejects.toThrow('reject failed');
    });
  });

  describe('fetchMyParticipation', () => {
    it('selects the current user\'s own row for a match', async () => {
      const single = jest.fn().mockResolvedValue({
        data: { id: 'p1', status: 'approved', leave_count: 0 },
        error: null,
      });
      const eq2 = jest.fn().mockReturnValue({ single });
      const eq1 = jest.fn().mockReturnValue({ eq: eq2 });
      const select = jest.fn().mockReturnValue({ eq: eq1 });
      (supabase.from as jest.Mock).mockReturnValue({ select });

      const result = await fetchMyParticipation('m1', 'u1');

      expect(supabase.from).toHaveBeenCalledWith('match_participants');
      expect(select).toHaveBeenCalledWith('id, status, leave_count');
      expect(eq1).toHaveBeenCalledWith('match_id', 'm1');
      expect(eq2).toHaveBeenCalledWith('user_id', 'u1');
      expect(result).toEqual({ id: 'p1', status: 'approved', leave_count: 0 });
    });

    it('returns null when the user has never interacted with this match', async () => {
      const single = jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'no rows' } });
      const eq2 = jest.fn().mockReturnValue({ single });
      const eq1 = jest.fn().mockReturnValue({ eq: eq2 });
      const select = jest.fn().mockReturnValue({ eq: eq1 });
      (supabase.from as jest.Mock).mockReturnValue({ select });

      const result = await fetchMyParticipation('m1', 'u1');

      expect(result).toBeNull();
    });

    it('throws on a real error', async () => {
      const single = jest.fn().mockResolvedValue({ data: null, error: { code: '500', message: 'boom' } });
      const eq2 = jest.fn().mockReturnValue({ single });
      const eq1 = jest.fn().mockReturnValue({ eq: eq2 });
      const select = jest.fn().mockReturnValue({ eq: eq1 });
      (supabase.from as jest.Mock).mockReturnValue({ select });

      await expect(fetchMyParticipation('m1', 'u1')).rejects.toThrow('boom');
    });
  });

  describe('fetchMatchParticipantProfiles', () => {
    it('joins match_participants rows with their public profiles', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'match_participants') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: [
                  { id: 'p1', user_id: 'u1', status: 'requested' },
                  { id: 'p2', user_id: 'u2', status: 'approved' },
                ],
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
                  { id: 'u1', first_name: 'Mario', last_name: 'Rossi', profile_image_url: null, unique_user_id: 'FC-1', player_role: 'player' },
                  { id: 'u2', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null, unique_user_id: 'FC-2', player_role: 'goalkeeper' },
                ],
                error: null,
              }),
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      });

      const result = await fetchMatchParticipantProfiles('m1');

      expect(result).toEqual([
        { participant_id: 'p1', user_id: 'u1', status: 'requested', first_name: 'Mario', last_name: 'Rossi', profile_image_url: null, unique_user_id: 'FC-1', player_role: 'player' },
        { participant_id: 'p2', user_id: 'u2', status: 'approved', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null, unique_user_id: 'FC-2', player_role: 'goalkeeper' },
      ]);
    });

    it('returns an empty array without querying profiles when there are no participants', async () => {
      const participantsEq = jest.fn().mockResolvedValue({ data: [], error: null });
      const fromMock = jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ eq: participantsEq }) });
      (supabase.from as jest.Mock).mockImplementation(fromMock);

      const result = await fetchMatchParticipantProfiles('m1');

      expect(result).toEqual([]);
      expect(fromMock).toHaveBeenCalledTimes(1);
      expect(fromMock).toHaveBeenCalledWith('match_participants');
    });

    it('throws the Supabase error message when the participants query fails', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: null, error: { message: 'participants failed' } }) }),
      });

      await expect(fetchMatchParticipantProfiles('m1')).rejects.toThrow('participants failed');
    });

    it('throws the Supabase error message when the profiles query fails', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'match_participants') {
          return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: [{ id: 'p1', user_id: 'u1', status: 'requested' }], error: null }) }) };
        }
        return { select: jest.fn().mockReturnValue({ in: jest.fn().mockResolvedValue({ data: null, error: { message: 'profiles failed' } }) }) };
      });

      await expect(fetchMatchParticipantProfiles('m1')).rejects.toThrow('profiles failed');
    });
  });

  describe('fetchMyParticipatingMatches', () => {
    it('returns matches with their participation status via the embedded join', async () => {
      const inFn = jest.fn().mockResolvedValue({
        data: [{ status: 'approved', matches: { id: 'm1', field_name: 'Campo Test' } }],
        error: null,
      });
      const eq = jest.fn().mockReturnValue({ in: inFn });
      const select = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ select });

      const result = await fetchMyParticipatingMatches('u1');

      expect(supabase.from).toHaveBeenCalledWith('match_participants');
      expect(select).toHaveBeenCalledWith('status, matches(*)');
      expect(eq).toHaveBeenCalledWith('user_id', 'u1');
      expect(inFn).toHaveBeenCalledWith('status', ['requested', 'approved', 'active']);
      expect(result).toEqual([{ match: { id: 'm1', field_name: 'Campo Test' }, status: 'approved' }]);
    });

    it('throws the Supabase error message on failure', async () => {
      const inFn = jest.fn().mockResolvedValue({ data: null, error: { message: 'query failed' } });
      const eq = jest.fn().mockReturnValue({ in: inFn });
      const select = jest.fn().mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ select });

      await expect(fetchMyParticipatingMatches('u1')).rejects.toThrow('query failed');
    });
  });
});
