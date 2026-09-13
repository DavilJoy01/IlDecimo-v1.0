import { renderHook, act } from '@testing-library/react-native';
import { router } from 'expo-router';
import { geocodeAddress } from '@/api/geocoding';
import { useCreateMatch } from './useCreateMatch';
import { createMatch } from '@/api/matches';
import { useSessionStore } from '@/stores/sessionStore';

jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('@/api/geocoding', () => ({ geocodeAddress: jest.fn() }));
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

  it('geocodes the typed address, creates the match with those coordinates, and navigates to its detail page', async () => {
    (geocodeAddress as jest.Mock).mockResolvedValue({ latitude: 45.4642, longitude: 9.19 });
    (createMatch as jest.Mock).mockResolvedValue({ id: 'm1' });

    // @testing-library/react-native@14's renderHook returns a Promise -- await it.
    const { result } = await renderHook(() => useCreateMatch());

    await act(async () => {
      await result.current.create(formValues);
    });

    expect(geocodeAddress).toHaveBeenCalledWith('Via Test 1');
    expect(createMatch).toHaveBeenCalledWith(
      expect.objectContaining({
        creator_id: 'u1',
        latitude: 45.4642,
        longitude: 9.19,
        field_name: 'Campo Test',
        max_players: 10,
      })
    );
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/(tabs)/home/match/[id]', params: { id: 'm1' } });
    expect(result.current.error).toBeNull();
  });

  it('sets an error and does not create a match when geocoding the address fails', async () => {
    (geocodeAddress as jest.Mock).mockRejectedValue(
      new Error('Località non trovata, prova a essere più specifico.')
    );

    const { result } = await renderHook(() => useCreateMatch());

    await act(async () => {
      await result.current.create(formValues);
    });

    expect(result.current.error).toBe('Località non trovata, prova a essere più specifico.');
    expect(createMatch).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('sets an error and does not navigate when creating the match fails', async () => {
    (geocodeAddress as jest.Mock).mockResolvedValue({ latitude: 45.4642, longitude: 9.19 });
    (createMatch as jest.Mock).mockRejectedValue(new Error('insert failed'));

    const { result } = await renderHook(() => useCreateMatch());

    await act(async () => {
      await result.current.create(formValues);
    });

    expect(result.current.error).toBe('insert failed');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('sets an error and does not attempt geocoding/creation when there is no session', async () => {
    useSessionStore.setState({ session: null, profile: null, status: 'signed-out' });

    const { result } = await renderHook(() => useCreateMatch());

    await act(async () => {
      await result.current.create(formValues);
    });

    expect(result.current.error).toBeTruthy();
    expect(geocodeAddress).not.toHaveBeenCalled();
    expect(createMatch).not.toHaveBeenCalled();
  });
});
