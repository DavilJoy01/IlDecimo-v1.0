// mobile/src/hooks/usePrivateMessages.test.ts
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { usePrivateMessages } from './usePrivateMessages';
import { fetchMessages, sendPrivateMessage, markConversationRead } from '@/api/privateMessages';
import { supabase } from '@/api/supabase';
import { useSessionStore } from '@/stores/sessionStore';

jest.mock('@/api/privateMessages', () => ({
  fetchMessages: jest.fn(),
  sendPrivateMessage: jest.fn(),
  markConversationRead: jest.fn(),
}));

jest.mock('@/api/supabase', () => ({
  supabase: { from: jest.fn(), channel: jest.fn(), removeChannel: jest.fn() },
}));

const ownProfile = { id: 'u1', first_name: 'Mario', last_name: 'Rossi' };
const otherProfile = { id: 'u2', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null };

function mockConversationLookup() {
  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    if (table === 'private_conversations') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { user_a_id: 'u1', user_b_id: 'u2' }, error: null }),
          }),
        }),
      };
    }
    if (table === 'user_public_profiles') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: otherProfile, error: null }),
          }),
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });
}

function mockChannel() {
  const channel = { on: jest.fn().mockReturnThis(), subscribe: jest.fn().mockReturnThis() };
  (supabase.channel as jest.Mock).mockReturnValue(channel);
  return channel;
}

describe('usePrivateMessages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSessionStore.setState({ session: { user: { id: 'u1' } } as never, profile: ownProfile as never, status: 'signed-in' });
    (fetchMessages as jest.Mock).mockResolvedValue([]);
    (markConversationRead as jest.Mock).mockResolvedValue(undefined);
    mockConversationLookup();
  });

  it('fetches messages and the other participant, marks the conversation read, and subscribes to the channel', async () => {
    mockChannel();
    const { result } = await renderHook(() => usePrivateMessages('c1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMessages).toHaveBeenCalledWith('c1');
    expect(markConversationRead).toHaveBeenCalledWith('c1', 'u1');
    expect(result.current.otherUser).toEqual({ user_id: 'u2', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null });
    expect(supabase.channel).toHaveBeenCalledWith('private_messages:c1');
  });

  it('unsubscribes on unmount', async () => {
    const channel = mockChannel();
    const { result, unmount } = await renderHook(() => usePrivateMessages('c1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await unmount();

    expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
  });

  it('prepends a new message from the other participant received over Realtime', async () => {
    const channel = mockChannel();
    const { result } = await renderHook(() => usePrivateMessages('c1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const onInsert = channel.on.mock.calls[0][2];
    await act(async () => {
      onInsert({ new: { id: 'm2', conversation_id: 'c1', sender_id: 'u2', body: 'ciao', read_at: null, created_at: '2026-09-07T10:00:00Z' } });
    });

    expect(result.current.messages).toEqual([
      { id: 'm2', conversation_id: 'c1', sender_id: 'u2', body: 'ciao', read_at: null, created_at: '2026-09-07T10:00:00Z' },
    ]);
  });

  it('ignores a Realtime event for a message the current user sent themselves', async () => {
    const channel = mockChannel();
    const { result } = await renderHook(() => usePrivateMessages('c1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const onInsert = channel.on.mock.calls[0][2];
    await act(async () => {
      onInsert({ new: { id: 'm3', conversation_id: 'c1', sender_id: 'u1', body: 'mio', read_at: null, created_at: '2026-09-07T10:00:00Z' } });
    });

    expect(result.current.messages).toEqual([]);
  });

  it('send prepends an optimistic message, then reconciles it with the insert result', async () => {
    mockChannel();
    (sendPrivateMessage as jest.Mock).mockResolvedValue({ id: 'm4', conversation_id: 'c1', sender_id: 'u1', body: 'ciao Luca', read_at: null, created_at: '2026-09-07T10:05:00Z' });

    const { result } = await renderHook(() => usePrivateMessages('c1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.send('ciao Luca');
    });

    expect(sendPrivateMessage).toHaveBeenCalledWith('c1', 'u1', 'ciao Luca');
    expect(success).toBe(true);
    expect(result.current.messages).toEqual([
      { id: 'm4', conversation_id: 'c1', sender_id: 'u1', body: 'ciao Luca', read_at: null, created_at: '2026-09-07T10:05:00Z' },
    ]);
  });

  it('send removes the optimistic message and sets sendError on failure', async () => {
    mockChannel();
    (sendPrivateMessage as jest.Mock).mockRejectedValue(new Error('send failed'));

    const { result } = await renderHook(() => usePrivateMessages('c1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.send('ciao');
    });

    expect(success).toBe(false);
    expect(result.current.sendError).toBe('send failed');
    expect(result.current.messages).toEqual([]);
  });
});
