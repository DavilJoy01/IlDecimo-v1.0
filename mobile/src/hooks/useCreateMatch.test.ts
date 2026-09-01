import { renderHook, act } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { useCreateMatch } from './useCreateMatch';
import { createMatch } from '@/api/matches';
import { useSessionStore } from '@/stores/sessionStore';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-location');
jest.mock('@/api/matches', () => ({ createMatch: jest.fn() }));

const formValues = {
  matchType: 5 as const,
  fieldName: 'Campo Test',
  address: 'Via Test 1',
  matchDate: '2026-09-05',
  startTime: '19:00',
  endTime: '20:30',
  maxPlayers: '10',
  description: '',
};

describe('useCreateMatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSessionStore.setState({
      session: { user: { id: 'u1' } } as never,
      profile: null,
      status: 'signed-in',
    });
  });

  it('requests location permission, creates the match with the current position, and navigates to its detail page', async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
      coords: { latitude: 38.1157, longitude: 13.3615 },
    });
    (createMatch as jest.Mock).mockResolvedValue({ id: 'm1' });

    // @testing-library/react-native@14's renderHook returns a Promise -- await it.
    const { result } = await renderHook(() => useCreateMatch());

    await act(async () => {
      await result.current.create(formValues);
    });

    expect(createMatch).toHaveBeenCalledWith(
      expect.objectContaining({
        creator_id: 'u1',
        latitude: 38.1157,
        longitude: 13.3615,
        field_name: 'Campo Test',
        max_players: 10,
      })
    );
    expect(router.push).toHaveBeenCalledWith({ pathname: '/(tabs)/home/match/[id]', params: { id: 'm1' } });
    expect(result.current.error).toBeNull();
  });

  it('sets permissionDenied and does not create a match when location permission is refused', async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });

    const { result } = await renderHook(() => useCreateMatch());

    await act(async () => {
      await result.current.create(formValues);
    });

    expect(result.current.permissionDenied).toBe(true);
    expect(createMatch).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('sets an error and does not navigate when creating the match fails', async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
      coords: { latitude: 38.1157, longitude: 13.3615 },
    });
    (createMatch as jest.Mock).mockRejectedValue(new Error('insert failed'));

    const { result } = await renderHook(() => useCreateMatch());

    await act(async () => {
      await result.current.create(formValues);
    });

    expect(result.current.error).toBe('insert failed');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('sets an error and does not attempt location/creation when there is no session', async () => {
    useSessionStore.setState({ session: null, profile: null, status: 'signed-out' });

    const { result } = await renderHook(() => useCreateMatch());

    await act(async () => {
      await result.current.create(formValues);
    });

    expect(result.current.error).toBeTruthy();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(createMatch).not.toHaveBeenCalled();
  });
});
