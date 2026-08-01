import {toast} from '@shipfox/react-ui/toast';
import {beforeEach, describe, expect, it, vi} from '@shipfox/vitest/vi';

import {completeInvitationAcceptance} from './complete-acceptance.js';

describe('completeInvitationAcceptance', () => {
  beforeEach(() => {
    vi.spyOn(toast, 'success').mockImplementation(() => 'toast-id');
  });

  it('refreshes auth before navigating to the joined workspace', async () => {
    const calls: string[] = [];
    const refreshAuth = vi.fn(() => {
      calls.push('refreshAuth');
      return Promise.resolve();
    });
    const navigate = vi.fn(() => {
      calls.push('navigate');
      return Promise.resolve();
    });

    await completeInvitationAcceptance({
      navigate,
      refreshAuth,
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workspaceName: 'Acme',
    });

    expect(refreshAuth).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('You joined Acme.');
    expect(navigate).toHaveBeenCalledWith({to: '/'});
    expect(calls).toEqual(['refreshAuth', 'navigate']);
  });

  it('does not navigate through the stale root route when auth refresh fails', async () => {
    const refreshAuth = vi.fn(() => Promise.reject(new Error('refresh failed')));
    const navigate = vi.fn();

    await expect(
      completeInvitationAcceptance({
        navigate,
        refreshAuth,
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workspaceName: 'Acme',
      }),
    ).resolves.toBe(false);

    expect(toast.success).toHaveBeenCalledWith('You joined Acme.');
    expect(navigate).not.toHaveBeenCalled();
  });
});
