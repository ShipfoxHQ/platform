import {getUserContext} from '@shipfox/api-auth-context';
import {ClientError} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import type {Workspace} from '#core/entities/workspace.js';
import {findMembership} from '#db/memberships.js';
import {getWorkspaceById} from '#db/workspaces.js';

export interface RequireMembershipParams {
  request: FastifyRequest;
  workspaceId: string;
}

export interface RequireMembershipResult {
  workspaceId: string;
  workspace: Workspace;
  userId: string;
}

export async function requireMembership(
  params: RequireMembershipParams,
): Promise<RequireMembershipResult> {
  const client = getUserContext(params.request);
  if (!client) {
    throw new ClientError('Authentication required', 'unauthorized', {status: 401});
  }

  const workspace = await getWorkspaceById(params.workspaceId);
  if (!workspace) {
    throw new ClientError('Workspace not found', 'not-found', {status: 404});
  }

  const membership = await findMembership({userId: client.userId, workspaceId: params.workspaceId});
  if (!membership) {
    throw new ClientError('Not a member of this workspace', 'forbidden', {status: 403});
  }

  return {workspaceId: workspace.id, workspace, userId: client.userId};
}
