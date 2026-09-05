// mobile/src/hooks/useConversations.test.ts
import { renderHook, waitFor } from '@testing-library/react-native';
import { useConversations } from './useConversations';
import { fetchConversations } from '@/api/privateMessages';
import { useSessionStore } from '@/stores/sessionStore';

jest.mock('@/api/privateMessages', () => ({
  fetchConversations: jest.fn(),
}));

const conversation = {
  conversation_id: 'c1',
  other_user: { user_id: 'u2', first_name: 'Luca', last_name: 'Bianchi', profile_image_url: null },
  last_message: { body: 'Ciao!', created_at: '2026-09-07T10:00:00Z', sender_id: 'u2' },
  unread: true,
};

describe('useConversations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSessionStore.setState({ session: { user: { id: 'u1' } } as never, profile: null, status: 'signed-in' });
  });

  it('fetches the conversation list on mount', async () => {
    (fetchConversations as jest.Mock).mockResolvedValue([conversation]);

    const { result } = await renderHook(() => useConversations());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchConversations).toHaveBeenCalledWith('u1');
    expect(result.current.conversations).toEqual([conversation]);
  });

  it('exposes an error when the fetch fails', async () => {
    (fetchConversations as jest.Mock).mockRejectedValue(new Error('boom'));

    const { result } = await renderHook(() => useConversations());

    await waitFor(() => expect(result.current.error).toBe('boom'));
  });
});
