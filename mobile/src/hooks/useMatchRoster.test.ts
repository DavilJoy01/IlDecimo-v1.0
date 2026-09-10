// mobile/src/hooks/useMatchRoster.test.ts
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useMatchRoster } from './useMatchRoster';
import { fetchMatchParticipantProfiles, approveParticipant, rejectParticipant, assignTeam, shuffleTeams } from '@/api/participants';

jest.mock('@/api/participants', () => ({
  fetchMatchParticipantProfiles: jest.fn(),
  approveParticipant: jest.fn(),
  rejectParticipant: jest.fn(),
  assignTeam: jest.fn(),
  shuffleTeams: jest.fn(),
}));

const requested = { participant_id: 'p1', user_id: 'u1', status: 'requested' as const, team: null, first_name: 'Mario', last_name: 'Rossi', profile_image_url: null, unique_user_id: 'FC-1', player_role: 'player' as const, preferred_foot: 'right' as const };
const approved = { participant_id: 'p2', user_id: 'u2', status: 'approved' as const, team: null, first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null, unique_user_id: 'FC-2', player_role: 'goalkeeper' as const, preferred_foot: 'left' as const };
const active = { participant_id: 'p3', user_id: 'u3', status: 'active' as const, team: 'A' as const, first_name: 'Gino', last_name: 'Verdi', profile_image_url: null, unique_user_id: 'FC-3', player_role: 'both' as const, preferred_foot: 'both' as const };

describe('useMatchRoster', () => {
  afterEach(() => jest.clearAllMocks());

  it('splits profiles into pendingRequests and approvedParticipants', async () => {
    (fetchMatchParticipantProfiles as jest.Mock).mockResolvedValue([requested, approved, active]);

    const { result } = await renderHook(() => useMatchRoster('m1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.pendingRequests).toEqual([requested]);
    expect(result.current.approvedParticipants).toEqual([approved, active]);
    expect(fetchMatchParticipantProfiles).toHaveBeenCalledWith('m1');
  });

  it('exposes an error when fetching fails', async () => {
    (fetchMatchParticipantProfiles as jest.Mock).mockRejectedValue(new Error('fetch failed'));

    const { result } = await renderHook(() => useMatchRoster('m1'));

    await waitFor(() => expect(result.current.error).toBe('fetch failed'));
    expect(result.current.pendingRequests).toEqual([]);
  });

  it('approve calls approveParticipant with the participant row id and refreshes', async () => {
    (fetchMatchParticipantProfiles as jest.Mock)
      .mockResolvedValueOnce([requested])
      .mockResolvedValueOnce([{ ...requested, status: 'approved' }]);
    (approveParticipant as jest.Mock).mockResolvedValue(undefined);

    const { result } = await renderHook(() => useMatchRoster('m1'));
    await waitFor(() => expect(result.current.pendingRequests).toEqual([requested]));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.approve('p1');
    });

    expect(approveParticipant).toHaveBeenCalledWith('p1');
    expect(success).toBe(true);
    expect(result.current.pendingRequests).toEqual([]);
  });

  it('reject sets an error and returns false on failure', async () => {
    (fetchMatchParticipantProfiles as jest.Mock).mockResolvedValue([requested]);
    (rejectParticipant as jest.Mock).mockRejectedValue(new Error('reject failed'));

    const { result } = await renderHook(() => useMatchRoster('m1'));
    await waitFor(() => expect(result.current.pendingRequests).toEqual([requested]));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.reject('p1');
    });

    expect(success).toBe(false);
    expect(result.current.error).toBe('reject failed');
  });

  it('groups approvedParticipants into unassigned/teamA/teamB by their team field', async () => {
    (fetchMatchParticipantProfiles as jest.Mock).mockResolvedValue([requested, approved, active]);

    const { result } = await renderHook(() => useMatchRoster('m1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.unassignedParticipants).toEqual([approved]);
    expect(result.current.teamAParticipants).toEqual([active]);
    expect(result.current.teamBParticipants).toEqual([]);
  });

  it('assignParticipantTeam calls assignTeam and refreshes', async () => {
    (fetchMatchParticipantProfiles as jest.Mock)
      .mockResolvedValueOnce([approved])
      .mockResolvedValueOnce([{ ...approved, team: 'A' }]);
    (assignTeam as jest.Mock).mockResolvedValue(undefined);

    const { result } = await renderHook(() => useMatchRoster('m1'));
    await waitFor(() => expect(result.current.unassignedParticipants).toEqual([approved]));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.assignParticipantTeam('p2', 'A');
    });

    expect(assignTeam).toHaveBeenCalledWith('p2', 'A');
    expect(success).toBe(true);
    expect(result.current.teamAParticipants).toEqual([{ ...approved, team: 'A' }]);
  });

  it('assignParticipantTeam sets an error and returns false on failure', async () => {
    (fetchMatchParticipantProfiles as jest.Mock).mockResolvedValue([approved]);
    (assignTeam as jest.Mock).mockRejectedValue(new Error('La squadra è già al completo.'));

    const { result } = await renderHook(() => useMatchRoster('m1'));
    await waitFor(() => expect(result.current.unassignedParticipants).toEqual([approved]));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.assignParticipantTeam('p2', 'A');
    });

    expect(success).toBe(false);
    expect(result.current.error).toBe('La squadra è già al completo.');
  });

  it('shuffle calls shuffleTeams with the match id and refreshes', async () => {
    (fetchMatchParticipantProfiles as jest.Mock)
      .mockResolvedValueOnce([approved, active])
      .mockResolvedValueOnce([{ ...approved, team: 'B' }, { ...active, team: 'A' }]);
    (shuffleTeams as jest.Mock).mockResolvedValue(undefined);

    const { result } = await renderHook(() => useMatchRoster('m1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.shuffle();
    });

    expect(shuffleTeams).toHaveBeenCalledWith('m1');
    expect(success).toBe(true);
    expect(result.current.teamAParticipants).toEqual([{ ...active, team: 'A' }]);
    expect(result.current.teamBParticipants).toEqual([{ ...approved, team: 'B' }]);
  });

  it('shuffle sets an error and returns false on failure', async () => {
    (fetchMatchParticipantProfiles as jest.Mock).mockResolvedValue([approved]);
    (shuffleTeams as jest.Mock).mockRejectedValue(new Error('only the match creator can shuffle teams'));

    const { result } = await renderHook(() => useMatchRoster('m1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.shuffle();
    });

    expect(success).toBe(false);
    expect(result.current.error).toBe('only the match creator can shuffle teams');
  });
});
