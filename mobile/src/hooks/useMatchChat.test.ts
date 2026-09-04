// mobile/src/hooks/useMatchChat.test.ts
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useMatchChat } from './useMatchChat';
import { fetchMatchMessages, fetchChatParticipants, sendMatchMessage } from '@/api/matchMessages';
import { supabase } from '@/api/supabase';
import { useSessionStore } from '@/stores/sessionStore';

jest.mock('@/api/matchMessages', () => ({
  fetchMatchMessages: jest.fn(),
  fetchChatParticipants: jest.fn(),
  sendMatchMessage: jest.fn(),
}));

jest.mock('@/api/supabase', () => ({
  supabase: { channel: jest.fn(), removeChannel: jest.fn() },
}));

const ownProfile = { id: 'u1', first_name: 'Mario', last_name: 'Rossi', profile_image_url: null };
const otherParticipant = { user_id: 'u2', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null };

function mockChannel() {
  const channel = { on: jest.fn().mockReturnThis(), subscribe: jest.fn().mockReturnThis() };
  (supabase.channel as jest.Mock).mockReturnValue(channel);
  return channel;
}

describe('useMatchChat', () => {
  beforeEach(() => {
    useSessionStore.setState({ session: { user: { id: 'u1' } } as never, profile: ownProfile as never, status: 'signed-in' });
    (fetchMatchMessages as jest.Mock).mockResolvedValue([]);
    (fetchChatParticipants as jest.Mock).mockResolvedValue([otherParticipant]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('fetches messages and participants on mount, and subscribes to the match channel', async () => {
    mockChannel();
    const { result } = await renderHook(() => useMatchChat('m1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMatchMessages).toHaveBeenCalledWith('m1');
    expect(fetchChatParticipants).toHaveBeenCalledWith('m1');
    expect(supabase.channel).toHaveBeenCalledWith('match_messages:m1');
  });

  it('unsubscribes on unmount', async () => {
    const channel = mockChannel();
    const { result, unmount } = await renderHook(() => useMatchChat('m1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    unmount();

    expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
  });

  it('prepends a new message from another sender received over Realtime', async () => {
    const channel = mockChannel();
    const { result } = await renderHook(() => useMatchChat('m1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const onInsert = channel.on.mock.calls[0][2];
    act(() => {
      onInsert({ new: { id: 'm2', match_id: 'm1', sender_id: 'u2', body: 'ciao', created_at: '2026-09-04T10:00:00Z' } });
    });

    expect(result.current.messages).toEqual([
      { id: 'm2', match_id: 'm1', sender_id: 'u2', body: 'ciao', created_at: '2026-09-04T10:00:00Z', sender: { first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null } },
    ]);
  });

  it('ignores a Realtime event for a message the current user sent themselves', async () => {
    const channel = mockChannel();
    const { result } = await renderHook(() => useMatchChat('m1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const onInsert = channel.on.mock.calls[0][2];
    act(() => {
      onInsert({ new: { id: 'm3', match_id: 'm1', sender_id: 'u1', body: 'mio', created_at: '2026-09-04T10:00:00Z' } });
    });

    expect(result.current.messages).toEqual([]);
  });

  it('send prepends an optimistic message, then reconciles it with the RPC result', async () => {
    mockChannel();
    (sendMatchMessage as jest.Mock).mockResolvedValue({ id: 'm4', match_id: 'm1', sender_id: 'u1', body: 'ciao a tutti', created_at: '2026-09-04T10:05:00Z' });

    const { result } = await renderHook(() => useMatchChat('m1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.send('ciao a tutti', ['u2']);
    });

    expect(sendMatchMessage).toHaveBeenCalledWith('m1', 'ciao a tutti', ['u2']);
    expect(success).toBe(true);
    expect(result.current.messages).toEqual([
      { id: 'm4', match_id: 'm1', sender_id: 'u1', body: 'ciao a tutti', created_at: '2026-09-04T10:05:00Z', sender: { first_name: 'Mario', last_name: 'Rossi', profile_image_url: null } },
    ]);
  });

  it('send removes the optimistic message and sets sendError on failure', async () => {
    mockChannel();
    (sendMatchMessage as jest.Mock).mockRejectedValue(new Error('send failed'));

    const { result } = await renderHook(() => useMatchChat('m1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.send('ciao', []);
    });

    expect(success).toBe(false);
    expect(result.current.sendError).toBe('send failed');
    expect(result.current.messages).toEqual([]);
  });
});
