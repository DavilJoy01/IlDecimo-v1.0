import { renderHook, waitFor, act } from '@testing-library/react-native';
import { useUserMatchHistory } from './useUserMatchHistory';
import { fetchUserMatchHistory } from '@/api/users';

jest.mock('@/api/users', () => ({ fetchUserMatchHistory: jest.fn() }));

const entry = (id: string, date: string) => ({
  match_id: id,
  role: 'creator' as const,
  outcome: 'completed' as const,
  match_type: 5 as const,
  field_name: 'Campo',
  address: 'Via Roma 1',
  match_date: date,
  start_time: '10:00',
});

describe('useUserMatchHistory', () => {
  beforeEach(() => jest.clearAllMocks());

  it('loads the first page on mount', async () => {
    const page = [entry('m1', '2026-01-10'), entry('m2', '2026-01-05')];
    (fetchUserMatchHistory as jest.Mock).mockResolvedValue(page);

    const { result } = await renderHook(() => useUserMatchHistory('u2'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchUserMatchHistory).toHaveBeenCalledWith('u2', null, 20);
    expect(result.current.matches).toEqual(page);
    expect(result.current.hasMore).toBe(false); // page shorter than PAGE_SIZE=20
    expect(result.current.error).toBeNull();
  });

  it('hasMore is true when the first page is exactly full', async () => {
    const fullPage = Array.from({ length: 20 }, (_, i) => entry(`m${i}`, '2026-01-10'));
    (fetchUserMatchHistory as jest.Mock).mockResolvedValue(fullPage);

    const { result } = await renderHook(() => useUserMatchHistory('u2'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasMore).toBe(true);
  });

  it('loadMore appends the next page using the last entry as cursor', async () => {
    const firstPage = Array.from({ length: 20 }, (_, i) => entry(`m${i}`, '2026-01-10'));
    const secondPage = [entry('m20', '2026-01-01')];
    (fetchUserMatchHistory as jest.Mock)
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage);

    const { result } = await renderHook(() => useUserMatchHistory('u2'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.loadMore();
    });

    const last = firstPage[firstPage.length - 1];
    expect(fetchUserMatchHistory).toHaveBeenCalledWith('u2', { date: last.match_date, time: last.start_time, id: last.match_id }, 20);
    expect(result.current.matches).toEqual([...firstPage, ...secondPage]);
    expect(result.current.hasMore).toBe(false);
  });

  it('sets an error and leaves already-loaded matches untouched when loadMore fails', async () => {
    const firstPage = Array.from({ length: 20 }, (_, i) => entry(`m${i}`, '2026-01-10'));
    (fetchUserMatchHistory as jest.Mock)
      .mockResolvedValueOnce(firstPage)
      .mockRejectedValueOnce(new Error('network error'));

    const { result } = await renderHook(() => useUserMatchHistory('u2'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.error).toBe('network error');
    expect(result.current.matches).toEqual(firstPage);
  });

  it('retry reloads the first page and clears a prior error', async () => {
    (fetchUserMatchHistory as jest.Mock).mockRejectedValueOnce(new Error('network error'));
    const { result } = await renderHook(() => useUserMatchHistory('u2'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('network error');

    (fetchUserMatchHistory as jest.Mock).mockResolvedValueOnce([entry('m1', '2026-01-10')]);
    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.matches).toEqual([entry('m1', '2026-01-10')]);
  });
});
