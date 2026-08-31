import {hashOpaqueToken} from '@shipfox/node-tokens';
import {eq, sql} from 'drizzle-orm';
import {userFactory} from '#test/index.js';
import {
  consumeAgentAuthorizationCode,
  consumeAgentAuthorizationRequest,
  createAgentAuthorizationCode,
  createAgentAuthorizationRequest,
  createAgentClient,
  createAgentGrant,
  createAgentPersonalAccessToken,
  createAgentRefreshToken,
  findActiveAgentAuthorizationCodeByHash,
  findActiveAgentPersonalAccessTokenByHash,
  findActiveAgentRefreshTokenByHash,
  findAgentClientByClientId,
  findPendingAgentAuthorizationRequest,
  lockAgentGrant,
  markAgentPersonalAccessTokenUsed,
  pruneAgentAccess,
  revokeAgentPersonalAccessToken,
  rotateAgentRefreshToken,
} from './agent-access.js';
import {db} from './db.js';
import {agentClients} from './schema/agent-access.js';

const GRANT_LOCK_TEST_TIMEOUT_MS = 30_000;

async function waitForLockWait(
  waiterPid: number,
  query: () => Promise<{rows: Array<{blockers: number[]}>}>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await query();
    if ((result.rows[0]?.blockers.length ?? 0) > 0) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for PostgreSQL row lock on backend ${waiterPid}`);
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return {promise, resolve, reject};
}

describe('agent-access db', () => {
  test('consumes a pending authorization request exactly once under concurrency', async () => {
    const client = await createAgentClient({
      clientId: `https://client.example/${crypto.randomUUID()}`,
      name: 'Test client',
      redirectUris: ['https://client.example/callback'],
      kind: 'registered',
    });
    const request = await createAgentAuthorizationRequest({
      clientId: client.id,
      redirectUri: 'https://client.example/callback',
      resource: 'https://api.example/mcp',
      scopes: ['read'],
      codeChallenge: 'challenge',
      state: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(request.state).toBeNull();
    expect(await findPendingAgentAuthorizationRequest({id: request.id})).toMatchObject({
      id: request.id,
      state: null,
    });

    const [first, second] = await Promise.all([
      consumeAgentAuthorizationRequest({id: request.id}),
      consumeAgentAuthorizationRequest({id: request.id}),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect([first, second].filter((value) => value === undefined)).toHaveLength(1);
    expect(await findPendingAgentAuthorizationRequest({id: request.id})).toBeUndefined();
  });

  test('reuses an active grant during reauthorization', async () => {
    const user = await userFactory.create();
    const client = await createAgentClient({
      clientId: `https://client.example/${crypto.randomUUID()}`,
      name: 'Test client',
      redirectUris: ['https://client.example/callback'],
      kind: 'registered',
    });
    const params = {
      userId: user.id,
      workspaceId: crypto.randomUUID(),
      clientId: client.id,
      scopes: ['read'],
    };

    const duplicateClient = await createAgentClient({
      clientId: client.clientId,
      name: 'Changed name is ignored for an existing client',
      redirectUris: client.redirectUris,
      kind: client.kind,
    });
    expect(duplicateClient.id).toBe(client.id);

    await db()
      .update(agentClients)
      .set({unreferencedAt: new Date()})
      .where(eq(agentClients.id, client.id));

    const first = await createAgentGrant(params);
    const second = await createAgentGrant({...params, scopes: ['read', 'write']});

    expect(second).toMatchObject({id: first.id, scopes: ['read', 'write']});
    expect(await findAgentClientByClientId({clientId: client.clientId})).toMatchObject({
      id: client.id,
      unreferencedAt: null,
    });
  });

  test('manages refresh tokens and personal access tokens', async () => {
    const user = await userFactory.create();
    const client = await createAgentClient({
      clientId: `https://client.example/${crypto.randomUUID()}`,
      name: 'Test client',
      redirectUris: ['https://client.example/callback'],
      kind: 'registered',
    });
    const grant = await createAgentGrant({
      userId: user.id,
      workspaceId: crypto.randomUUID(),
      clientId: client.id,
      scopes: ['read'],
    });
    const refreshToken = await createAgentRefreshToken({
      grantId: grant.id,
      hashedToken: hashOpaqueToken('refresh-token'),
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(
      await findActiveAgentRefreshTokenByHash({hashedToken: refreshToken.hashedToken}),
    ).toMatchObject({id: refreshToken.id});
    const rotated = await rotateAgentRefreshToken({
      hashedToken: refreshToken.hashedToken,
      replacementHashedToken: hashOpaqueToken('replacement-refresh-token'),
      replacementExpiresAt: new Date(Date.now() + 60_000),
    });
    expect(rotated).toMatchObject({
      grantId: grant.id,
      hashedToken: hashOpaqueToken('replacement-refresh-token'),
    });
    expect(
      await findActiveAgentRefreshTokenByHash({hashedToken: refreshToken.hashedToken}),
    ).toBeUndefined();
    expect(
      await rotateAgentRefreshToken({
        hashedToken: refreshToken.hashedToken,
        replacementHashedToken: hashOpaqueToken('unused-refresh-token'),
        replacementExpiresAt: new Date(Date.now() + 60_000),
      }),
    ).toBeUndefined();

    const pat = await createAgentPersonalAccessToken({
      userId: user.id,
      workspaceId: grant.workspaceId,
      hashedToken: hashOpaqueToken('pat-token'),
      prefix: 'sf_pat_test',
      name: 'Test PAT',
      scopes: ['read'],
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(
      await findActiveAgentPersonalAccessTokenByHash({hashedToken: pat.hashedToken}),
    ).toMatchObject({id: pat.id});
    expect(await markAgentPersonalAccessTokenUsed({id: pat.id})).toMatchObject({
      id: pat.id,
      lastUsedAt: expect.any(Date),
    });
    await revokeAgentPersonalAccessToken({id: pat.id});
    expect(
      await findActiveAgentPersonalAccessTokenByHash({hashedToken: pat.hashedToken}),
    ).toBeUndefined();
  });

  test('consumes an authorization code exactly once and preserves its bindings', async () => {
    const user = await userFactory.create();
    const client = await createAgentClient({
      clientId: `https://client.example/${crypto.randomUUID()}`,
      name: 'Test client',
      redirectUris: ['https://client.example/callback'],
      kind: 'registered',
    });
    const grant = await createAgentGrant({
      userId: user.id,
      workspaceId: crypto.randomUUID(),
      clientId: client.id,
      scopes: ['read'],
    });
    const rawCode = `code-${crypto.randomUUID()}`;
    const code = await createAgentAuthorizationCode({
      grantId: grant.id,
      hashedCode: hashOpaqueToken(rawCode),
      codeChallenge: 'challenge',
      redirectUri: 'https://client.example/callback',
      resource: 'https://api.example/mcp',
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(
      await findActiveAgentAuthorizationCodeByHash({hashedCode: code.hashedCode}),
    ).toMatchObject({
      id: code.id,
    });

    const [first, second] = await Promise.all([
      consumeAgentAuthorizationCode({hashedCode: code.hashedCode}),
      consumeAgentAuthorizationCode({hashedCode: code.hashedCode}),
    ]);
    const consumed = [first, second].find(Boolean);

    expect(
      await findActiveAgentAuthorizationCodeByHash({hashedCode: code.hashedCode}),
    ).toBeUndefined();
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(consumed).toMatchObject({
      grantId: grant.id,
      codeChallenge: 'challenge',
      redirectUri: 'https://client.example/callback',
      resource: 'https://api.example/mcp',
    });
  });

  test(
    'serializes grant lifecycle work on the grant row lock',
    async () => {
      const user = await userFactory.create();
      const client = await createAgentClient({
        clientId: `https://client.example/${crypto.randomUUID()}`,
        name: 'Test client',
        redirectUris: ['https://client.example/callback'],
        kind: 'registered',
      });
      const grant = await createAgentGrant({
        userId: user.id,
        workspaceId: crypto.randomUUID(),
        clientId: client.id,
        scopes: ['read'],
      });

      let releaseHolder!: () => void;
      const holderReleased = new Promise<void>((resolve) => {
        releaseHolder = resolve;
      });
      let holderReady!: () => void;
      const lockAcquired = new Promise<void>((resolve) => {
        holderReady = resolve;
      });
      const waiterReady = deferred<number>();
      const lockObserved = deferred<void>();
      const holder = db().transaction(async (tx) => {
        try {
          await lockAgentGrant(tx, {grantId: grant.id});
          holderReady();
          const waiterPid = await waiterReady.promise;
          await waitForLockWait(
            waiterPid,
            () => tx.execute(sql`select pg_blocking_pids(${waiterPid}) as blockers`),
            GRANT_LOCK_TEST_TIMEOUT_MS,
          );
          lockObserved.resolve();
          await holderReleased;
        } catch (error) {
          lockObserved.reject(error);
          throw error;
        }
      });
      await lockAcquired;

      const waiter = db().transaction(async (tx) => {
        const result = await tx.execute(sql`select pg_backend_pid() as pid`);
        const waiterPid = result.rows[0]?.pid;
        if (typeof waiterPid !== 'number') throw new Error('Expected waiter backend pid');
        waiterReady.resolve(waiterPid);
        return await lockAgentGrant(tx, {grantId: grant.id});
      });
      waiter.catch(waiterReady.reject);
      try {
        await lockObserved.promise;
        releaseHolder();
        const lockedGrant = await waiter;

        expect(lockedGrant?.id).toBe(grant.id);
      } finally {
        releaseHolder();
        await Promise.all([holder, waiter.catch(() => undefined)]);
      }
    },
    GRANT_LOCK_TEST_TIMEOUT_MS,
  );

  test('does not consume an expired request or code', async () => {
    const client = await createAgentClient({
      clientId: `https://client.example/${crypto.randomUUID()}`,
      name: 'Test client',
      redirectUris: ['https://client.example/callback'],
      kind: 'registered',
    });
    const request = await createAgentAuthorizationRequest({
      clientId: client.id,
      redirectUri: 'https://client.example/callback',
      resource: 'https://api.example/mcp',
      scopes: ['read'],
      codeChallenge: 'challenge',
      state: 'state',
      expiresAt: new Date(Date.now() - 1),
    });
    const user = await userFactory.create();
    const grant = await createAgentGrant({
      userId: user.id,
      workspaceId: crypto.randomUUID(),
      clientId: client.id,
      scopes: ['read'],
    });
    const code = await createAgentAuthorizationCode({
      grantId: grant.id,
      hashedCode: hashOpaqueToken(`expired-${crypto.randomUUID()}`),
      codeChallenge: 'challenge',
      redirectUri: 'https://client.example/callback',
      resource: 'https://api.example/mcp',
      expiresAt: new Date(Date.now() - 1),
    });

    const pendingRequest = await findPendingAgentAuthorizationRequest({id: request.id});
    const activeCode = await findActiveAgentAuthorizationCodeByHash({hashedCode: code.hashedCode});
    const consumedRequest = await consumeAgentAuthorizationRequest({id: request.id});
    const consumedCode = await consumeAgentAuthorizationCode({hashedCode: code.hashedCode});

    expect(pendingRequest).toBeUndefined();
    expect(activeCode).toBeUndefined();
    expect(consumedRequest).toBeUndefined();
    expect(consumedCode).toBeUndefined();
    expect(
      await pruneAgentAccess({retentionDays: 0, now: new Date(Date.now() + 1_000)}),
    ).toBeGreaterThanOrEqual(2);
  });
});
