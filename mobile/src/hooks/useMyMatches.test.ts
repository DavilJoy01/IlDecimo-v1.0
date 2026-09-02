// mobile/src/hooks/useMyMatches.test.ts
import { renderHook, waitFor } from '@testing-library/react-native';
import { useMyMatches } from './useMyMatches';
import { fetchMatchesByCreator } from '@/api/matches';
import { fetchMyParticipatingMatches } from '@/api/participants';
import { useSessionStore } from '@/stores/sessionStore';

jest.mock('@/api/matches', () => ({ fetchMatchesByCreator: jest.fn() }));
jest.mock('@/api/participants', () => ({ fetchMyParticipatingMatches: jest.fn() }));

const createdMatch = { id: 'm1', field_name: 'Campo Creato' };
const participatingRow = { match: { id: 'm2', field_name: 'Campo Partecipo' }, status: 'approved' as const };

describe('useMyMatches', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSessionStore.setState({ session: { user: { id: 'u1' } } as never, profile: null, status: 'signed-in' });
  });

  it('fetches created and participating matches in parallel on mount', async () => {
    (fetchMatchesByCreator as jest.Mock).mockResolvedValue([createdMatch]);
    (fetchMyParticipatingMatches as jest.Mock).mockResolvedValue([participatingRow]);

    const { result } = await renderHook(() => useMyMatches());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMatchesByCreator).toHaveBeenCalledWith('u1');
    expect(fetchMyParticipatingMatches).toHaveBeenCalledWith('u1');
    expect(result.current.created).toEqual([createdMatch]);
    expect(result.current.participating).toEqual([participatingRow]);
  });

  it('exposes an error when either fetch fails', async () => {
    (fetchMatchesByCreator as jest.Mock).mockRejectedValue(new Error('boom'));
    (fetchMyParticipatingMatches as jest.Mock).mockResolvedValue([]);

    const { result } = await renderHook(() => useMyMatches());

    await waitFor(() => expect(result.current.error).toBe('boom'));
  });

  it('does not fetch when there is no session', async () => {
    useSessionStore.setState({ session: null, profile: null, status: 'signed-out' });

    const { result } = await renderHook(() => useMyMatches());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMatchesByCreator).not.toHaveBeenCalled();
    expect(fetchMyParticipatingMatches).not.toHaveBeenCalled();
  });
});
