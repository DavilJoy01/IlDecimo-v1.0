import { supabase } from './supabase';
import { fetchFriends } from './friendships';
import { fetchInvitableFriends, sendMatchInvitation, markInvitationViewed } from './matchInvitations';

jest.mock('./supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('./friendships', () => ({ fetchFriends: jest.fn() }));

describe('matchInvitations api', () => {
  afterEach(() => jest.clearAllMocks());

  describe('fetchInvitableFriends', () => {
    it('returns friends minus existing participants and existing invitees', async () => {
      (fetchFriends as jest.Mock).mockResolvedValue([
        { user_id: 'u2', unique_user_id: 'code2', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null },
        { user_id: 'u3', unique_user_id: 'code3', first_name: 'Gino', last_name: 'Verdi', profile_image_url: null },
        { user_id: 'u4', unique_user_id: 'code4', first_name: 'Anna', last_name: 'Neri', profile_image_url: null },
      ]);
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'match_participants') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: [{ user_id: 'u2' }], error: null }),
            }),
          };
        }
        if (table === 'match_invitations') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: [{ invitee_id: 'u4' }], error: null }),
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      });

      const result = await fetchInvitableFriends('u1', 'm1');

      // u2 excluded (already a participant), u4 excluded (already invited), u3 remains
      expect(result).toEqual([{ user_id: 'u3', first_name: 'Gino', last_name: 'Verdi', profile_image_url: null }]);
    });

    it('returns an empty array without querying anything else when there are no friendships', async () => {
      (fetchFriends as jest.Mock).mockResolvedValue([]);

      const result = await fetchInvitableFriends('u1', 'm1');

      expect(result).toEqual([]);
      expect(supabase.from).not.toHaveBeenCalled();
    });
  });

  describe('sendMatchInvitation', () => {
    it('inserts an invitation row', async () => {
      const insertMock = jest.fn().mockResolvedValue({ error: null });
      (supabase.from as jest.Mock).mockReturnValue({ insert: insertMock });

      await sendMatchInvitation('m1', 'u1', 'u2');

      expect(supabase.from).toHaveBeenCalledWith('match_invitations');
      expect(insertMock).toHaveBeenCalledWith([{ match_id: 'm1', inviter_id: 'u1', invitee_id: 'u2' }]);
    });

    it('translates a 42501 RLS denial into a neutral Italian message', async () => {
      const insertMock = jest.fn().mockResolvedValue({
        error: { message: 'new row violates row-level security policy for table "match_invitations"', code: '42501' },
      });
      (supabase.from as jest.Mock).mockReturnValue({ insert: insertMock });

      await expect(sendMatchInvitation('m1', 'u1', 'u2')).rejects.toThrow('Non è possibile invitare questo utente.');
    });

    it('translates a 23505 unique-constraint violation into a neutral Italian message', async () => {
      const insertMock = jest.fn().mockResolvedValue({
        error: { message: 'duplicate key value violates unique constraint "match_invitations_match_id_invitee_id_key"', code: '23505' },
      });
      (supabase.from as jest.Mock).mockReturnValue({ insert: insertMock });

      await expect(sendMatchInvitation('m1', 'u1', 'u2')).rejects.toThrow('Questo utente è già stato invitato a questa partita.');
    });

    it('throws the raw message for a non-42501 error', async () => {
      const insertMock = jest.fn().mockResolvedValue({ error: { message: 'something else broke', code: 'XX000' } });
      (supabase.from as jest.Mock).mockReturnValue({ insert: insertMock });

      await expect(sendMatchInvitation('m1', 'u1', 'u2')).rejects.toThrow('something else broke');
    });
  });

  describe('markInvitationViewed', () => {
    it('updates the invitation status to viewed, scoped to sent status', async () => {
      const eqStatus = jest.fn().mockResolvedValue({ error: null });
      const eqInvitee = jest.fn().mockReturnValue({ eq: eqStatus });
      const eqMatch = jest.fn().mockReturnValue({ eq: eqInvitee });
      const updateMock = jest.fn().mockReturnValue({ eq: eqMatch });
      (supabase.from as jest.Mock).mockReturnValue({ update: updateMock });

      await markInvitationViewed('m1', 'u2');

      expect(supabase.from).toHaveBeenCalledWith('match_invitations');
      expect(updateMock).toHaveBeenCalledWith({ status: 'viewed' });
      expect(eqMatch).toHaveBeenCalledWith('match_id', 'm1');
      expect(eqInvitee).toHaveBeenCalledWith('invitee_id', 'u2');
      expect(eqStatus).toHaveBeenCalledWith('status', 'sent');
    });

    it('throws the Supabase error message on failure', async () => {
      const eqStatus = jest.fn().mockResolvedValue({ error: { message: 'update failed' } });
      const eqInvitee = jest.fn().mockReturnValue({ eq: eqStatus });
      const eqMatch = jest.fn().mockReturnValue({ eq: eqInvitee });
      (supabase.from as jest.Mock).mockReturnValue({ update: jest.fn().mockReturnValue({ eq: eqMatch }) });

      await expect(markInvitationViewed('m1', 'u2')).rejects.toThrow('update failed');
    });
  });
});
