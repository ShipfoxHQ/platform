import {
  listInvitationsQueryKey,
  listInvitationsQueryOptions,
  listMembersQueryKey,
  listMembersQueryOptions,
} from '@shipfox/client-workspace-settings';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

describe('@shipfox/client-workspace-settings public query API', () => {
  test('exports membership and invitation query contracts from the package root', () => {
    expect(listMembersQueryKey(WORKSPACE_ID)).toEqual(['workspaces', WORKSPACE_ID, 'members']);
    expect(listInvitationsQueryKey(WORKSPACE_ID)).toEqual([
      'workspaces',
      WORKSPACE_ID,
      'invitations',
    ]);

    const members = listMembersQueryOptions(WORKSPACE_ID);
    const invitations = listInvitationsQueryOptions(WORKSPACE_ID);

    expect(members.queryKey).toEqual(['workspaces', WORKSPACE_ID, 'members']);
    expect(members.queryFn).toEqual(expect.any(Function));
    expect(invitations.queryKey).toEqual(['workspaces', WORKSPACE_ID, 'invitations']);
    expect(invitations.queryFn).toEqual(expect.any(Function));
  });
});
