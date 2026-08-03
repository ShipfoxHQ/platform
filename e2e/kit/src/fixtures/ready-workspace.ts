import type {Page} from '@shipfox/playwright';
import type {WorkspaceFixtures} from './workspace.js';

export interface ReadyWorkspace {
  userId: string;
  workspaceId: string;
  workspaceSlug: string;
  projectId: string;
  sessionToken: string;
}

export interface CreateReadyWorkspaceParams {
  name?: string;
}

export type CreateReadyWorkspace = (params?: CreateReadyWorkspaceParams) => Promise<ReadyWorkspace>;

export interface ReadyWorkspaceFixtures {
  createReadyWorkspace: CreateReadyWorkspace;
}

async function createReadyWorkspace(params: {
  auth: WorkspaceFixtures['auth'];
  workspaces: WorkspaceFixtures['workspaces'];
  projects: WorkspaceFixtures['projects'];
  page: Page;
  workspace: CreateReadyWorkspaceParams | undefined;
}): Promise<ReadyWorkspace> {
  const user = await params.auth.createUser();
  const workspace = await params.workspaces.create({
    userId: user.user.id,
    ...(params.workspace?.name === undefined ? {} : {name: params.workspace.name}),
  });
  const project = await params.projects.createProject({workspaceId: workspace.id});
  const session = await params.auth.createSession({user_id: user.user.id});
  await params.auth.loginAs(params.page, user);

  return {
    userId: user.user.id,
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    projectId: project.id,
    sessionToken: session.token,
  };
}

export const readyWorkspaceFixtures = {
  createReadyWorkspace: async (
    {auth, workspaces, projects, page}: WorkspaceFixtures & {page: Page},
    use: (create: CreateReadyWorkspace) => Promise<void>,
  ) => {
    await use((workspace) => createReadyWorkspace({auth, workspaces, projects, page, workspace}));
  },
};
