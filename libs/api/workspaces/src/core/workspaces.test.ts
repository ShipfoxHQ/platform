import {WORKSPACES_WORKSPACE_CREATED} from '@shipfox/api-workspaces-dto';
import {sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {findMembership} from '#db/memberships.js';
import {workspacesOutbox} from '#db/schema/outbox.js';
import {updateWorkspace} from '#db/workspaces.js';
import {userFactory} from '#test/index.js';
import {MembershipRequiredError, WorkspaceInactiveError, WorkspaceNotFoundError} from './errors.js';
import {
  createWorkspaceForUser,
  getWorkspaceOperatingState,
  requireWorkspaceMembership,
} from './workspaces.js';

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

  test('createWorkspaceForUser emits a workspace created event in the transaction', async () => {
    const user = userFactory.build();

    const workspace = await createWorkspaceForUser({
      name: 'Evented Workspace',
      userId: user.userId,
      userEmail: user.email,
      userName: user.name,
    });
    const [event] = await db()
      .select()
      .from(workspacesOutbox)
      .where(sql`${workspacesOutbox.payload}->>'workspaceId' = ${workspace.id}`);

    expect(event).toMatchObject({
      eventType: WORKSPACES_WORKSPACE_CREATED,
      payload: {
        workspaceId: workspace.id,
        name: workspace.name,
        creatorUserId: user.userId,
      },
    });
  });

  test('requireWorkspaceMembership returns the workspace + role when memberships include it', async () => {
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
      memberships: [{workspaceId: workspace.id, role: 'admin', workspaceStatus: 'active'}],
    });

    expect(result.workspace.id).toBe(workspace.id);
    expect(result.userId).toBe(user.userId);
    expect(result.role).toBe('admin');
  });

  test('getWorkspaceOperatingState returns the current status without workspace details', async () => {
    const workspace = await createWorkspaceForUser({
      name: 'Operating State Workspace',
      userId: crypto.randomUUID(),
    });

    expect(await getWorkspaceOperatingState({workspaceId: workspace.id})).toBe('active');

    await updateWorkspace({id: workspace.id, status: 'suspended'});

    expect(await getWorkspaceOperatingState({workspaceId: workspace.id})).toBe('suspended');
  });

  test('requireWorkspaceMembership rejects a suspended workspace', async () => {
    const user = userFactory.build();
    const workspace = await createWorkspaceForUser({
      name: 'Suspended Workspace',
      userId: user.userId,
      userEmail: user.email,
      userName: user.name,
    });
    await updateWorkspace({id: workspace.id, status: 'suspended'});

    const membership = requireWorkspaceMembership({
      workspaceId: workspace.id,
      userId: user.userId,
      memberships: [{workspaceId: workspace.id, role: 'admin', workspaceStatus: 'active'}],
    });

    await expect(membership).rejects.toBeInstanceOf(WorkspaceInactiveError);
  });

  test('requireWorkspaceMembership rejects when memberships do not include the workspace', async () => {
    const owner = userFactory.build();
    const outsider = userFactory.build();
    const workspace = await createWorkspaceForUser({
      name: 'Private Workspace',
      userId: owner.userId,
      userEmail: owner.email,
      userName: owner.name,
    });

    const nonMember = requireWorkspaceMembership({
      workspaceId: workspace.id,
      userId: outsider.userId,
      memberships: [],
    });
    await expect(nonMember).rejects.toBeInstanceOf(MembershipRequiredError);
  });

  test('requireWorkspaceMembership rejects with WorkspaceNotFoundError when workspace does not exist', async () => {
    const owner = userFactory.build();
    const ghostId = crypto.randomUUID();

    const missingWorkspace = requireWorkspaceMembership({
      workspaceId: ghostId,
      userId: owner.userId,
      memberships: [{workspaceId: ghostId, role: 'admin', workspaceStatus: 'active'}],
    });

    await expect(missingWorkspace).rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });
});
