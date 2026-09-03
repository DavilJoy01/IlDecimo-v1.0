import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useMatchDetail } from './useMatchDetail';
import { fetchMatchById, updateMatch, cancelMatch } from '@/api/matches';

jest.mock('@/api/matches', () => ({
  fetchMatchById: jest.fn(),
  updateMatch: jest.fn(),
  cancelMatch: jest.fn(),
}));

const sampleMatch = {
  id: 'm1',
  creator_id: 'u1',
  match_type: 5,
  field_name: 'Campo Test',
  address: 'Via Test 1',
  latitude: 38.1157,
  longitude: 13.3615,
  match_date: '2026-09-05',
  start_time: '19:00:00',
  end_time: '20:30:00',
  max_players: 10,
  description: null,
  status: 'open',
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
};

const editableFields = {
  match_type: 5 as const,
  field_name: 'Campo Nuovo',
  address: 'Via Test 1',
  match_date: '2026-09-05',
  start_time: '19:00',
  end_time: '20:30',
  max_players: 10,
  description: null,
};

describe('useMatchDetail', () => {
  afterEach(() => jest.clearAllMocks());

  it('fetches the match by id on mount', async () => {
    (fetchMatchById as jest.Mock).mockResolvedValue(sampleMatch);

    // @testing-library/react-native@14's renderHook returns a Promise -- await it
    // (a real version-specific requirement, verified against the installed package's
    // own source, not a style choice -- applies to every renderHook call in this plan).
    const { result } = await renderHook(() => useMatchDetail('m1'));

    await waitFor(() => expect(result.current.match).toEqual(sampleMatch));
    expect(fetchMatchById).toHaveBeenCalledWith('m1');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('exposes an error when fetching fails', async () => {
    (fetchMatchById as jest.Mock).mockRejectedValue(new Error('not found'));

    const { result } = await renderHook(() => useMatchDetail('missing'));

    await waitFor(() => expect(result.current.error).toBe('not found'));
    expect(result.current.match).toBeNull();
  });

  it('update calls updateMatch and replaces the local match on success', async () => {
    (fetchMatchById as jest.Mock).mockResolvedValue(sampleMatch);
    const updatedMatch = { ...sampleMatch, field_name: 'Campo Nuovo' };
    (updateMatch as jest.Mock).mockResolvedValue(updatedMatch);

    const { result } = await renderHook(() => useMatchDetail('m1'));
    await waitFor(() => expect(result.current.match).toEqual(sampleMatch));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.update(editableFields);
    });

    expect(updateMatch).toHaveBeenCalledWith('m1', expect.objectContaining({ field_name: 'Campo Nuovo' }));
    expect(success).toBe(true);
    expect(result.current.match).toEqual(updatedMatch);
  });

  it('update sets an error and returns false on failure', async () => {
    (fetchMatchById as jest.Mock).mockResolvedValue(sampleMatch);
    (updateMatch as jest.Mock).mockRejectedValue(new Error('update failed'));

    const { result } = await renderHook(() => useMatchDetail('m1'));
    await waitFor(() => expect(result.current.match).toEqual(sampleMatch));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.update(editableFields);
    });

    expect(success).toBe(false);
    expect(result.current.error).toBe('update failed');
    expect(result.current.match).toEqual(sampleMatch);
  });

  it('remove calls cancelMatch and returns true on success', async () => {
    (fetchMatchById as jest.Mock).mockResolvedValue(sampleMatch);
    (cancelMatch as jest.Mock).mockResolvedValue(undefined);

    const { result } = await renderHook(() => useMatchDetail('m1'));
    await waitFor(() => expect(result.current.match).toEqual(sampleMatch));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.remove();
    });

    expect(cancelMatch).toHaveBeenCalledWith('m1');
    expect(success).toBe(true);
  });

  it('remove sets an error and returns false on failure', async () => {
    (fetchMatchById as jest.Mock).mockResolvedValue(sampleMatch);
    (cancelMatch as jest.Mock).mockRejectedValue(new Error('delete failed'));

    const { result } = await renderHook(() => useMatchDetail('m1'));
    await waitFor(() => expect(result.current.match).toEqual(sampleMatch));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.remove();
    });

    expect(success).toBe(false);
    expect(result.current.error).toBe('delete failed');
  });
});
