import type {CreateGiteaConnectionResponseDto} from '@shipfox/api-integration-gitea-dto';
import {connectGiteaOrg} from './connect.js';
import {
  bestEffortDeleteOrg,
  type CreatedOrg,
  commitFiles,
  createIssue,
  createOrg,
  createRepo,
  deleteOrg,
  deleteRepo,
  listIssueComments,
} from './instance.js';

export type {CreateGiteaConnectionResponseDto} from '@shipfox/api-integration-gitea-dto';
export {type ConnectGiteaOrgParams, connectGiteaOrg} from './connect.js';
export {GiteaInstanceError} from './gitea-client.js';
export {
  type CommitFile,
  type CommitFileOperation,
  type CommitFilesParams,
  type CreatedIssue,
  type CreatedOrg,
  type CreatedRepo,
  type CreateIssueParams,
  type CreateOrgParams,
  type CreateRepoParams,
  commitFiles,
  createIssue,
  createOrg,
  createRepo,
  deleteOrg,
  deleteRepo,
  generateOrgName,
  type IssueComment,
  listIssueComments,
} from './instance.js';

export interface CreateConnectedOrgParams {
  workspaceId: string;
  sessionToken: string;
  name?: string;
}

export interface ConnectedOrg extends CreatedOrg {
  connection: CreateGiteaConnectionResponseDto;
}

// The one-import path: a fresh org (team, bot, webhook) linked to the workspace,
// ready for a scenario to push into.
export async function createConnectedOrg(params: CreateConnectedOrgParams): Promise<ConnectedOrg> {
  const org = await createOrg(params.name === undefined ? {} : {name: params.name});

  // If linking fails, the org (with its live webhook) is not returned, so undo it
  // here rather than leak it into the shared instance.
  try {
    const connection = await connectGiteaOrg({
      workspaceId: params.workspaceId,
      org: org.org,
      sessionToken: params.sessionToken,
    });

    return {...org, connection};
  } catch (error) {
    await bestEffortDeleteOrg(org.org);
    throw error;
  }
}

export function createGiteaHelper() {
  return {
    createOrg,
    createRepo,
    createIssue,
    listIssueComments,
    commitFiles,
    deleteRepo,
    deleteOrg,
    connectOrg: connectGiteaOrg,
    createConnectedOrg,
    have: {
      org: createOrg,
      connectedOrg: createConnectedOrg,
    },
  };
}

export type GiteaHelper = ReturnType<typeof createGiteaHelper>;

export interface GiteaFixtures {
  gitea: GiteaHelper;
}

export const giteaHelper = {
  gitea: async (
    {request: _request}: {request: unknown},
    use: (helper: GiteaHelper) => Promise<void>,
  ) => {
    await use(createGiteaHelper());
  },
};
