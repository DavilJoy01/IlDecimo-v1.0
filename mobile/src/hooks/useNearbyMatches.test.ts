// mobile/src/hooks/useNearbyMatches.test.ts
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { geocodeAddress } from '@/api/geocoding';
import { fetchNearbyMatches } from '@/api/matches';
import { getLastSearchLocation, saveLastSearchLocation } from '@/api/lastSearchLocation';
import { useNearbyMatches } from './useNearbyMatches';

jest.mock('@/api/geocoding', () => ({ geocodeAddress: jest.fn() }));
jest.mock('@/api/matches', () => ({ fetchNearbyMatches: jest.fn() }));
jest.mock('@/api/lastSearchLocation', () => ({
  getLastSearchLocation: jest.fn(),
  saveLastSearchLocation: jest.fn(),
}));

describe('useNearbyMatches', () => {
  afterEach(() => jest.clearAllMocks());

  it('auto-searches at mount using a previously saved location', async () => {
    (getLastSearchLocation as jest.Mock).mockResolvedValue({
      label: 'Milano',
      latitude: 45.4642,
      longitude: 9.19,
    });
    (fetchNearbyMatches as jest.Mock).mockResolvedValue([{ id: 'm1' }]);

    // @testing-library/react-native@14's renderHook returns a Promise -- await it.
    const { result } = await renderHook(() => useNearbyMatches());

    await waitFor(() => expect(result.current.matches).toHaveLength(1));
    expect(fetchNearbyMatches).toHaveBeenCalledWith(45.4642, 9.19, 20);
    expect(result.current.locationLabel).toBe('Milano');
    expect(geocodeAddress).not.toHaveBeenCalled();
  });

  it('does not search at mount when no location was ever saved', async () => {
    (getLastSearchLocation as jest.Mock).mockResolvedValue(null);

    // @testing-library/react-native@14's renderHook returns a Promise -- await it.
    const { result } = await renderHook(() => useNearbyMatches());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchNearbyMatches).not.toHaveBeenCalled();
    expect(result.current.locationLabel).toBeNull();
  });

  it('geocodes, saves, and searches a manually entered location', async () => {
    (getLastSearchLocation as jest.Mock).mockResolvedValue(null);
    (geocodeAddress as jest.Mock).mockResolvedValue({ latitude: 41.9028, longitude: 12.4964 });
    (fetchNearbyMatches as jest.Mock).mockResolvedValue([{ id: 'm2' }]);

    const { result } = await renderHook(() => useNearbyMatches());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.searchLocation('Roma');
    });

    expect(geocodeAddress).toHaveBeenCalledWith('Roma');
    expect(saveLastSearchLocation).toHaveBeenCalledWith({
      label: 'Roma',
      latitude: 41.9028,
      longitude: 12.4964,
    });
    expect(fetchNearbyMatches).toHaveBeenCalledWith(41.9028, 12.4964, 20);
    expect(result.current.matches).toHaveLength(1);
    expect(result.current.locationLabel).toBe('Roma');
  });

  it('keeps the previous results when a manual search fails', async () => {
    (getLastSearchLocation as jest.Mock).mockResolvedValue({
      label: 'Milano',
      latitude: 45.4642,
      longitude: 9.19,
    });
    (fetchNearbyMatches as jest.Mock).mockResolvedValue([{ id: 'm1' }]);

    const { result } = await renderHook(() => useNearbyMatches());
    await waitFor(() => expect(result.current.matches).toHaveLength(1));

    (geocodeAddress as jest.Mock).mockRejectedValue(
      new Error('Località non trovata, prova a essere più specifico.')
    );

    await act(async () => {
      await result.current.searchLocation('asdkjhasdkjh');
    });

    expect(result.current.error).toBe('Località non trovata, prova a essere più specifico.');
    expect(result.current.matches).toHaveLength(1);
    expect(result.current.locationLabel).toBe('Milano');
  });

  it('refresh re-reads the saved location and searches again', async () => {
    (getLastSearchLocation as jest.Mock).mockResolvedValue({
      label: 'Milano',
      latitude: 45.4642,
      longitude: 9.19,
    });
    (fetchNearbyMatches as jest.Mock).mockResolvedValue([{ id: 'm1' }]);

    const { result } = await renderHook(() => useNearbyMatches());
    await waitFor(() => expect(result.current.matches).toHaveLength(1));

    (fetchNearbyMatches as jest.Mock).mockResolvedValue([{ id: 'm1' }, { id: 'm3' }]);

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.matches).toHaveLength(2);
    expect(fetchNearbyMatches).toHaveBeenCalledTimes(2);
  });

  it('refresh does nothing when no location has ever been saved', async () => {
    (getLastSearchLocation as jest.Mock).mockResolvedValue(null);

    const { result } = await renderHook(() => useNearbyMatches());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.refresh();
    });

    expect(fetchNearbyMatches).not.toHaveBeenCalled();
  });

  it('shows the saved location label right away even when the auto-search at mount fails', async () => {
    (getLastSearchLocation as jest.Mock).mockResolvedValue({
      label: 'Milano',
      latitude: 45.4642,
      longitude: 9.19,
    });
    (fetchNearbyMatches as jest.Mock).mockRejectedValue(new Error('Rete assente.'));

    const { result } = await renderHook(() => useNearbyMatches());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.locationLabel).toBe('Milano');
    expect(result.current.error).toBe('Rete assente.');
  });

  it('trims the query before geocoding, saving, and displaying it', async () => {
    (getLastSearchLocation as jest.Mock).mockResolvedValue(null);
    (geocodeAddress as jest.Mock).mockResolvedValue({ latitude: 41.9028, longitude: 12.4964 });
    (fetchNearbyMatches as jest.Mock).mockResolvedValue([{ id: 'm2' }]);

    const { result } = await renderHook(() => useNearbyMatches());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.searchLocation('  Roma  ');
    });

    expect(geocodeAddress).toHaveBeenCalledWith('Roma');
    expect(saveLastSearchLocation).toHaveBeenCalledWith({
      label: 'Roma',
      latitude: 41.9028,
      longitude: 12.4964,
    });
    expect(result.current.locationLabel).toBe('Roma');
  });

  it('still shows the geocoded results when saving the search location fails', async () => {
    (getLastSearchLocation as jest.Mock).mockResolvedValue(null);
    (geocodeAddress as jest.Mock).mockResolvedValue({ latitude: 41.9028, longitude: 12.4964 });
    (fetchNearbyMatches as jest.Mock).mockResolvedValue([{ id: 'm2' }]);
    (saveLastSearchLocation as jest.Mock).mockRejectedValue(new Error('Keychain non disponibile.'));

    const { result } = await renderHook(() => useNearbyMatches());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.searchLocation('Roma');
    });

    expect(result.current.matches).toHaveLength(1);
    expect(result.current.locationLabel).toBe('Roma');
    expect(result.current.error).toBeNull();
  });
});
