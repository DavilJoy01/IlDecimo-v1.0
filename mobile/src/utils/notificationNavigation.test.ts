import type { useRouter } from 'expo-router';
import { navigateForNotification } from './notificationNavigation';
import { markInvitationViewed } from '@/api/matchInvitations';

jest.mock('@/api/matchInvitations', () => ({ markInvitationViewed: jest.fn() }));

function mockRouter(): ReturnType<typeof useRouter> {
  return { push: jest.fn() } as unknown as ReturnType<typeof useRouter>;
}

describe('navigateForNotification', () => {
  beforeEach(() => {
    (markInvitationViewed as jest.Mock).mockResolvedValue(undefined);
  });
  afterEach(() => jest.clearAllMocks());

  it('routes friend_request_received to the friend-requests screen', () => {
    const router = mockRouter();
    navigateForNotification({ type: 'friend_request_received', payload: {} }, router);
    expect(router.push).toHaveBeenCalledWith('/(tabs)/people/friend-requests');
  });

  it('routes friend_request_approved to the other user\'s profile', () => {
    const router = mockRouter();
    navigateForNotification({ type: 'friend_request_approved', payload: { user_id: 'u2' } }, router);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/(tabs)/people/user/[id]', params: { id: 'u2' } });
  });

  it('routes friend_request_rejected to the other user\'s profile', () => {
    const router = mockRouter();
    navigateForNotification({ type: 'friend_request_rejected', payload: { user_id: 'u3' } }, router);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/(tabs)/people/user/[id]', params: { id: 'u3' } });
  });

  it('does nothing for friend_request_approved without a user_id in the payload', () => {
    const router = mockRouter();
    navigateForNotification({ type: 'friend_request_approved', payload: {} }, router);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('routes private_message to the conversation', () => {
    const router = mockRouter();
    navigateForNotification({ type: 'private_message', payload: { conversation_id: 'c1' } }, router);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/(tabs)/messages/[id]', params: { id: 'c1' } });
  });

  it('routes match_invitation to the match detail and marks the invitation viewed', async () => {
    const router = mockRouter();
    navigateForNotification({ type: 'match_invitation', payload: { match_id: 'm1' } }, router, 'u1');
    expect(router.push).toHaveBeenCalledWith({ pathname: '/(tabs)/home/match/[id]', params: { id: 'm1' } });
    expect(markInvitationViewed).toHaveBeenCalledWith('m1', 'u1');
  });

  it('does not mark the invitation viewed when there is no userId', () => {
    const router = mockRouter();
    navigateForNotification({ type: 'match_invitation', payload: { match_id: 'm1' } }, router);
    expect(markInvitationViewed).not.toHaveBeenCalled();
  });

  it('routes match_message to the match chat', () => {
    const router = mockRouter();
    navigateForNotification({ type: 'match_message', payload: { match_id: 'm2' } }, router);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/(tabs)/home/match/[id]/chat', params: { id: 'm2' } });
  });

  it('routes match_message_mention to the match chat', () => {
    const router = mockRouter();
    navigateForNotification({ type: 'match_message_mention', payload: { match_id: 'm2' } }, router);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/(tabs)/home/match/[id]/chat', params: { id: 'm2' } });
  });

  it('routes any other type with a match_id to the match detail', () => {
    const router = mockRouter();
    navigateForNotification({ type: 'match_cancelled', payload: { match_id: 'm3' } }, router);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/(tabs)/home/match/[id]', params: { id: 'm3' } });
  });

  it('does nothing for an unknown type with no match_id', () => {
    const router = mockRouter();
    navigateForNotification({ type: 'something_unrecognized', payload: {} }, router);
    expect(router.push).not.toHaveBeenCalled();
  });
});
