import {workspacesInterModuleContract} from '@shipfox/api-workspaces-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {createInMemoryInterModuleTransport} from '@shipfox/node-module/inter-module';
import {createWorkspaceForUser} from '#core/workspaces.js';
import {createMembership, removeMembership} from '#db/memberships.js';
import {createWorkspace, updateWorkspace} from '#db/workspaces.js';
import {createWorkspacesInterModulePresentation} from './inter-module.js';

function createClient() {
  const transport = createInMemoryInterModuleTransport();
  const client = transport.createClient(workspacesInterModuleContract);
  transport.register(createWorkspacesInterModulePresentation());
  transport.seal();
  return client;
}

describe('Workspaces inter-module presentation', () => {
  test('resolves the workspace creator through the transport', async () => {
    const client = createClient();
    const creatorUserId = crypto.randomUUID();
    const workspace = await createWorkspaceForUser({
      name: 'Creator Workspace',
      userId: creatorUserId,
    });
    await createMembership({workspaceId: workspace.id, userId: crypto.randomUUID()});

    const result = await client.getWorkspaceCreator({workspaceId: workspace.id});

    expect(result).toEqual({creatorUserId});
  });

  test('keeps attributing the workspace to its creator after the creator leaves', async () => {
    const client = createClient();
    const creatorUserId = crypto.randomUUID();
    const workspace = await createWorkspaceForUser({
      name: 'Outlasted Creator Workspace',
      userId: creatorUserId,
    });
    const remainingUserId = crypto.randomUUID();
    await createMembership({workspaceId: workspace.id, userId: remainingUserId});

    await removeMembership({userId: creatorUserId, workspaceId: workspace.id});
    const result = await client.getWorkspaceCreator({workspaceId: workspace.id});

    expect(result).toEqual({creatorUserId});
  });

  test('returns null when a workspace has no known creator', async () => {
    const client = createClient();
    const workspace = await createWorkspace({name: 'Unattributed Workspace'});

    const result = await client.getWorkspaceCreator({workspaceId: workspace.id});

    expect(result).toEqual({creatorUserId: null});
  });

  test('returns only the current workspace operating state', async () => {
    const client = createClient();
    const workspace = await createWorkspace({name: 'Operating State Workspace'});

    expect(await client.getWorkspaceOperatingState({workspaceId: workspace.id})).toEqual({
      status: 'active',
    });

    await updateWorkspace({id: workspace.id, status: 'suspended'});

    expect(await client.getWorkspaceOperatingState({workspaceId: workspace.id})).toEqual({
      status: 'suspended',
    });
  });

  test('maps a missing workspace to the published known error', async () => {
    const client = createClient();
    const workspaceId = crypto.randomUUID();

    const error = await client.getWorkspaceCreator({workspaceId}).catch((caught) => caught);

    expect(
      isInterModuleKnownError(workspacesInterModuleContract.methods.getWorkspaceCreator, error),
    ).toBe(true);
    if (isInterModuleKnownError(workspacesInterModuleContract.methods.getWorkspaceCreator, error)) {
      expect(error.code).toBe('workspace-not-found');
      expect(error.details).toEqual({workspaceId});
    }
  });

  test('maps a missing operating-state workspace to the published known error', async () => {
    const client = createClient();
    const workspaceId = crypto.randomUUID();

    const error = await client.getWorkspaceOperatingState({workspaceId}).catch((caught) => caught);

    expect(
      isInterModuleKnownError(
        workspacesInterModuleContract.methods.getWorkspaceOperatingState,
        error,
      ),
    ).toBe(true);
    if (
      isInterModuleKnownError(
        workspacesInterModuleContract.methods.getWorkspaceOperatingState,
        error,
      )
    ) {
      expect(error.code).toBe('workspace-not-found');
      expect(error.details).toEqual({workspaceId});
    }
  });
});
