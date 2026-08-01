import {beforeEach, describe, expect, it, vi} from '@shipfox/vitest/vi';
import {type CreateReadyWorkspace, readyWorkspaceFixtures} from './ready-workspace.js';

describe('createReadyWorkspace fixture', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a user, workspace, project, session, and browser login', async () => {
    const user = {user: {id: 'user-1'}};
    const workspace = {id: 'workspace-1', slug: 'ready-workspace'};
    const project = {id: 'project-1'};
    const session = {token: 'session-token'};
    const page = {};
    const auth = {
      createUser: vi.fn().mockResolvedValue(user),
      createSession: vi.fn().mockResolvedValue(session),
      loginAs: vi.fn().mockResolvedValue(undefined),
    };
    const workspaces = {
      create: vi.fn().mockResolvedValue(workspace),
    };
    const projects = {
      createProject: vi.fn().mockResolvedValue(project),
    };
    let createReadyWorkspace: CreateReadyWorkspace | undefined;
    await readyWorkspaceFixtures.createReadyWorkspace(
      {auth, workspaces, projects, page} as never,
      (create) => {
        createReadyWorkspace = create;
        return Promise.resolve();
      },
    );

    const result = await createReadyWorkspace?.({name: 'Ready Workspace'});

    expect(auth.createUser).toHaveBeenCalledWith();
    expect(workspaces.create).toHaveBeenCalledWith({
      userId: 'user-1',
      name: 'Ready Workspace',
    });
    expect(projects.createProject).toHaveBeenCalledWith({workspaceId: 'workspace-1'});
    expect(auth.createSession).toHaveBeenCalledWith({user_id: 'user-1'});
    expect(auth.loginAs).toHaveBeenCalledWith(page, user);
    expect(result).toEqual({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workspaceSlug: 'ready-workspace',
      projectId: 'project-1',
      sessionToken: 'session-token',
    });
  });
});
