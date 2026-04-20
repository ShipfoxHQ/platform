import {findMembership} from '#db/memberships.js';
import {userFactory} from '#test/index.js';
import {MembershipRequiredError, WorkspaceNotFoundError} from './errors.js';
import {createWorkspaceForUser, requireWorkspaceMembership} from './workspaces.js';

describe('workspaces core', () => {
  test('createWorkspaceForUser creates a workspace and membership for the user', async () => {
    const user = userFactory.build();

    const workspace = await createWorkspaceForUser({
      name: 'Core Workspace',
      userId: user.userId,
      userEmail: user.email,
      userName: user.name,
    });
    const membership = await findMembership({userId: user.userId, workspaceId: workspace.id});

    expect(workspace.name).toBe('Core Workspace');
    expect(membership).toBeDefined();
  });

  test('requireWorkspaceMembership returns the workspace for a member', async () => {
    const user = userFactory.build();
    const workspace = await createWorkspaceForUser({
      name: 'Member Workspace',
      userId: user.userId,
      userEmail: user.email,
      userName: user.name,
    });

    const result = await requireWorkspaceMembership({
      workspaceId: workspace.id,
      userId: user.userId,
    });

    expect(result.workspace.id).toBe(workspace.id);
    expect(result.userId).toBe(user.userId);
  });

  test('requireWorkspaceMembership rejects missing workspaces and non-members', async () => {
    const owner = userFactory.build();
    const outsider = userFactory.build();
    const workspace = await createWorkspaceForUser({
      name: 'Private Workspace',
      userId: owner.userId,
      userEmail: owner.email,
      userName: owner.name,
    });

    const missingWorkspace = requireWorkspaceMembership({
      workspaceId: crypto.randomUUID(),
      userId: owner.userId,
    });
    await expect(missingWorkspace).rejects.toBeInstanceOf(WorkspaceNotFoundError);

    const nonMember = requireWorkspaceMembership({
      workspaceId: workspace.id,
      userId: outsider.userId,
    });
    await expect(nonMember).rejects.toBeInstanceOf(MembershipRequiredError);
  });
});
