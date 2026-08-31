import { useSessionStore } from './sessionStore';

describe('useSessionStore', () => {
  beforeEach(() => {
    useSessionStore.setState({ session: null, profile: null, status: 'loading' });
  });

  it('starts in the loading status with no session', () => {
    const state = useSessionStore.getState();
    expect(state.status).toBe('loading');
    expect(state.session).toBeNull();
  });

  it('setSession(null) moves status to signed-out', () => {
    useSessionStore.getState().setSession(null);
    expect(useSessionStore.getState().status).toBe('signed-out');
  });

  it('setSession(a session) with no profile moves status to needs-profile', () => {
    useSessionStore.getState().setSession({ user: { id: 'u1' } } as never);
    expect(useSessionStore.getState().status).toBe('needs-profile');
  });

  it('setProfile after a session moves status to signed-in', () => {
    useSessionStore.getState().setSession({ user: { id: 'u1' } } as never);
    useSessionStore.getState().setProfile({ id: 'u1', unique_user_id: 'FC-100000' } as never);
    expect(useSessionStore.getState().status).toBe('signed-in');
  });
});
