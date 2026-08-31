// mobile/src/hooks/useNearbyMatches.test.ts
import { renderHook, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { useNearbyMatches } from './useNearbyMatches';
import { fetchNearbyMatches } from '@/api/matches';

jest.mock('expo-location');
jest.mock('@/api/matches', () => ({ fetchNearbyMatches: jest.fn() }));

describe('useNearbyMatches', () => {
  afterEach(() => jest.clearAllMocks());

  it('requests location permission, then fetches matches at the current position', async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
      coords: { latitude: 38.1157, longitude: 13.3615 },
    });
    (fetchNearbyMatches as jest.Mock).mockResolvedValue([{ id: 'm1' }]);

    // @testing-library/react-native@14's renderHook returns a Promise -- await it.
    const { result } = await renderHook(() => useNearbyMatches());

    await waitFor(() => expect(result.current.matches).toHaveLength(1));
    expect(fetchNearbyMatches).toHaveBeenCalledWith(38.1157, 13.3615, 20);
    expect(result.current.permissionDenied).toBe(false);
  });

  it('sets permissionDenied and does not fetch when permission is refused', async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });

    // @testing-library/react-native@14's renderHook returns a Promise -- await it.
    const { result } = await renderHook(() => useNearbyMatches());

    await waitFor(() => expect(result.current.permissionDenied).toBe(true));
    expect(fetchNearbyMatches).not.toHaveBeenCalled();
  });

  it('exposes an error when fetching matches fails', async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
      coords: { latitude: 38.1157, longitude: 13.3615 },
    });
    (fetchNearbyMatches as jest.Mock).mockRejectedValue(new Error('boom'));

    // @testing-library/react-native@14's renderHook returns a Promise -- await it.
    const { result } = await renderHook(() => useNearbyMatches());

    await waitFor(() => expect(result.current.error).toBe('boom'));
  });
});
