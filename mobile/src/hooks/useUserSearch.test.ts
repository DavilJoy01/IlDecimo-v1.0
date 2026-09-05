// mobile/src/hooks/useUserSearch.test.ts
import { renderHook, act } from '@testing-library/react-native';
import { useUserSearch } from './useUserSearch';
import { searchUserByCode } from '@/api/friendships';

jest.mock('@/api/friendships', () => ({
  searchUserByCode: jest.fn(),
}));

const found = { user_id: 'u2', unique_user_id: 'FC-100002', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null };

describe('useUserSearch', () => {
  afterEach(() => jest.clearAllMocks());

  it('sets result on a successful search', async () => {
    (searchUserByCode as jest.Mock).mockResolvedValue(found);

    const { result } = await renderHook(() => useUserSearch());

    await act(async () => {
      result.current.setQuery('FC-100002');
    });
    await act(async () => {
      await result.current.search();
    });

    expect(searchUserByCode).toHaveBeenCalledWith('FC-100002');
    expect(result.current.result).toEqual(found);
    expect(result.current.notFound).toBe(false);
  });

  it('sets notFound when the search returns null', async () => {
    (searchUserByCode as jest.Mock).mockResolvedValue(null);

    const { result } = await renderHook(() => useUserSearch());

    await act(async () => {
      result.current.setQuery('FC-999999');
    });
    await act(async () => {
      await result.current.search();
    });

    expect(result.current.result).toBeNull();
    expect(result.current.notFound).toBe(true);
  });

  it('sets an error message on failure', async () => {
    (searchUserByCode as jest.Mock).mockRejectedValue(new Error('search failed'));

    const { result } = await renderHook(() => useUserSearch());

    await act(async () => {
      result.current.setQuery('FC-100002');
    });
    await act(async () => {
      await result.current.search();
    });

    expect(result.current.error).toBe('search failed');
  });

  it('uppercases the query before searching (pasted/autofilled codes are not always upper-case)', async () => {
    (searchUserByCode as jest.Mock).mockResolvedValue(found);

    const { result } = await renderHook(() => useUserSearch());

    await act(async () => {
      result.current.setQuery('fc-100002');
    });
    await act(async () => {
      await result.current.search();
    });

    expect(searchUserByCode).toHaveBeenCalledWith('FC-100002');
  });

  it('does nothing on an empty query', async () => {
    const { result } = await renderHook(() => useUserSearch());

    await act(async () => {
      await result.current.search();
    });

    expect(searchUserByCode).not.toHaveBeenCalled();
  });
});
