import {setUserContext} from '@shipfox/api-auth-context';
import {ClientError} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import {createMembership} from '#db/memberships.js';
import {createWorkspace} from '#db/workspaces.js';
import {requireMembership} from './require-membership.js';

function buildRequest(client: {userId: string; email: string}): FastifyRequest {
  const request = {} as FastifyRequest;
  setUserContext(request, client);
  return request;
}

function emailFor(suffix: string): string {
  return `${suffix}-${crypto.randomUUID()}@example.com`;
}

async function createUser(params: {email: string; hashedPassword?: string; name?: string}) {
  await Promise.resolve();
  return {userId: crypto.randomUUID(), email: params.email};
}

describe('requireMembership', () => {
  test('allows when caller is a member of the requested workspace', async () => {
    const user = await createUser({email: emailFor('req-ok'), hashedPassword: 'h'});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});
    await createMembership({userId: user.userId, workspaceId: workspace.id});

    const result = await requireMembership({
      request: buildRequest({userId: user.userId, email: user.email}),
      workspaceId: workspace.id,
    });

    expect(result.workspaceId).toBe(workspace.id);
    expect(result.userId).toBe(user.userId);
    expect(result.workspace.name).toBe(workspace.name);
  });

  test('throws 403 when caller is not a member', async () => {
    const user = await createUser({email: emailFor('req-no'), hashedPassword: 'h'});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});

    const promise = requireMembership({
      request: buildRequest({userId: user.userId, email: user.email}),
      workspaceId: workspace.id,
    });

    await expect(promise).rejects.toBeInstanceOf(ClientError);
    await promise.catch((error: ClientError) => {
      expect(error.status).toBe(403);
    });
  });

  test('throws 404 when workspace does not exist', async () => {
    const user = await createUser({email: emailFor('req-tn'), hashedPassword: 'h'});

    const promise = requireMembership({
      request: buildRequest({userId: user.userId, email: user.email}),
      workspaceId: crypto.randomUUID(),
    });

    await expect(promise).rejects.toBeInstanceOf(ClientError);
    await promise.catch((error: ClientError) => {
      expect(error.status).toBe(404);
    });
  });

  test('throws 401 when client context is absent', async () => {
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});

    const promise = requireMembership({
      request: {} as unknown as FastifyRequest,
      workspaceId: workspace.id,
    });

    await expect(promise).rejects.toBeInstanceOf(ClientError);
    await promise.catch((error: ClientError) => {
      expect(error.status).toBe(401);
    });
  });
});
