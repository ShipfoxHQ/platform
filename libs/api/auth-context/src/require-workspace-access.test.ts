import {ClientError} from '@shipfox/node-fastify';
import {
  buildUserContext,
  requireWorkspaceAccess,
  setUserContext,
  type UserContextMembership,
} from './index.js';

function requestWith(params: {
  userId: string;
  memberships: ReadonlyArray<UserContextMembership>;
}): object {
  const request = {};
  setUserContext(
    request,
    buildUserContext({
      userId: params.userId,
      email: 'user@example.com',
      memberships: params.memberships,
    }),
  );
  return request;
}

describe('requireWorkspaceAccess', () => {
  test('returns workspaceId, userId, and role when the token grants access', () => {
    const userId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const request = requestWith({
      userId,
      memberships: [{workspaceId, role: 'admin', workspaceStatus: 'active'}],
    });

    const result = requireWorkspaceAccess({request, workspaceId});

    expect(result.workspaceId).toBe(workspaceId);
    expect(result.userId).toBe(userId);
    expect(result.role).toBe('admin');
  });

  test('throws 403 when the token does not include the workspace', () => {
    const request = requestWith({
      userId: crypto.randomUUID(),
      memberships: [{workspaceId: crypto.randomUUID(), role: 'admin', workspaceStatus: 'active'}],
    });

    const act = () => requireWorkspaceAccess({request, workspaceId: crypto.randomUUID()});

    expect(act).toThrow(ClientError);
    expect(act).toThrow(expect.objectContaining({status: 403}));
  });

  test('throws 401 when the request has no user context', () => {
    const act = () => requireWorkspaceAccess({request: {}, workspaceId: crypto.randomUUID()});

    expect(act).toThrow(ClientError);
    expect(act).toThrow(expect.objectContaining({status: 401}));
  });

  test.each([
    ['suspended', 'workspace-suspended', 409],
    ['deleted', 'workspace-inactive', 403],
  ] as const)('maps a %s workspace claim to the stable access error', (workspaceStatus, code, status) => {
    const workspaceId = crypto.randomUUID();
    const request = requestWith({
      userId: crypto.randomUUID(),
      memberships: [{workspaceId, role: 'admin', workspaceStatus}],
    });

    const act = () => requireWorkspaceAccess({request, workspaceId});

    expect(act).toThrow(ClientError);
    expect(act).toThrow(expect.objectContaining({code, status}));
  });
});

test('context access helpers only authorize active memberships', () => {
  const workspaceId = crypto.randomUUID();
  const context = buildUserContext({
    userId: crypto.randomUUID(),
    email: 'user@example.com',
    memberships: [
      {workspaceId, role: 'admin', workspaceStatus: 'suspended'},
      {workspaceId: crypto.randomUUID(), role: 'admin', workspaceStatus: 'deleted'},
    ],
  });

  expect(context.canAccess(workspaceId)).toBe(false);
  expect(context.hasRole(workspaceId, 'admin')).toBe(false);
});
