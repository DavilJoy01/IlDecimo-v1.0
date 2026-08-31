// mobile/src/hooks/useProfileBootstrap.test.ts
import { renderHook, waitFor } from '@testing-library/react-native';
import { useProfileBootstrap } from './useProfileBootstrap';
import { useSessionStore } from '@/stores/sessionStore';
import { fetchOwnProfile } from '@/api/users';

jest.mock('@/api/users', () => ({ fetchOwnProfile: jest.fn() }));

describe('useProfileBootstrap', () => {
  beforeEach(() => {
    useSessionStore.setState({ session: null, profile: null, status: 'loading' });
    jest.clearAllMocks();
  });

  it('does nothing when there is no session', async () => {
    // @testing-library/react-native@14's renderHook returns a Promise -- await it,
    // same as every other renderHook call in this plan (see Task 5's note).
    await renderHook(() => useProfileBootstrap());
    expect(fetchOwnProfile).not.toHaveBeenCalled();
  });

  it('fetches and stores the profile once a session with no profile appears', async () => {
    (fetchOwnProfile as jest.Mock).mockResolvedValue({ id: 'u1', unique_user_id: 'FC-100000' });
    useSessionStore.getState().setSession({ user: { id: 'u1' } } as never);

    await renderHook(() => useProfileBootstrap());

    await waitFor(() => expect(fetchOwnProfile).toHaveBeenCalledWith('u1'));
    await waitFor(() => expect(useSessionStore.getState().status).toBe('signed-in'));
  });

  it('leaves status at needs-profile when the fetch finds no row yet (mid-registration)', async () => {
    (fetchOwnProfile as jest.Mock).mockResolvedValue(null);
    useSessionStore.getState().setSession({ user: { id: 'u1' } } as never);

    await renderHook(() => useProfileBootstrap());

    await waitFor(() => expect(fetchOwnProfile).toHaveBeenCalledWith('u1'));
    expect(useSessionStore.getState().status).toBe('needs-profile');
  });
});
