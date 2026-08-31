import {hashOpaqueToken} from '@shipfox/node-tokens';
import {sql} from 'drizzle-orm';
import {
  consumeAgentAuthorizationCode,
  consumeAgentAuthorizationRequest,
  createAgentAuthorizationCode,
  createAgentAuthorizationRequest,
  createAgentClient,
  createAgentGrant,
  lockAgentGrant,
} from './agent-access.js';
import {db} from './db.js';
import {createUser} from './users.js';

function emailFor(suffix: string): string {
  return `${suffix}-${crypto.randomUUID()}@example.com`;
}

async function waitForLockWait(
  waiterPid: number,
  query: () => Promise<{rows: Array<{blockers: number[]}>}>,
): Promise<void> {
  const deadline = Date.now() + 5_000;
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

    const [first, second] = await Promise.all([
      consumeAgentAuthorizationRequest({id: request.id}),
      consumeAgentAuthorizationRequest({id: request.id}),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect([first, second].filter((value) => value === undefined)).toHaveLength(1);
  });

  test('reuses an active grant during reauthorization', async () => {
    const user = await createUser({email: emailFor('agent-grant'), hashedPassword: 'h'});
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

    const first = await createAgentGrant(params);
    const second = await createAgentGrant({...params, scopes: ['read', 'write']});

    expect(second).toMatchObject({id: first.id, scopes: ['read', 'write']});
  });

  test('consumes an authorization code exactly once and preserves its bindings', async () => {
    const user = await createUser({email: emailFor('agent-code'), hashedPassword: 'h'});
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

    const [first, second] = await Promise.all([
      consumeAgentAuthorizationCode({hashedCode: code.hashedCode}),
      consumeAgentAuthorizationCode({hashedCode: code.hashedCode}),
    ]);
    const consumed = [first, second].find(Boolean);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(consumed).toMatchObject({
      grantId: grant.id,
      codeChallenge: 'challenge',
      redirectUri: 'https://client.example/callback',
      resource: 'https://api.example/mcp',
    });
  });

  test('serializes grant lifecycle work on the grant row lock', async () => {
    const user = await createUser({email: emailFor('agent-lock'), hashedPassword: 'h'});
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
        await waitForLockWait(waiterPid, () =>
          tx.execute(sql`select pg_blocking_pids(${waiterPid}) as blockers`),
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
  });

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
    const user = await createUser({email: emailFor('agent-expired'), hashedPassword: 'h'});
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

    const consumedRequest = await consumeAgentAuthorizationRequest({id: request.id});
    const consumedCode = await consumeAgentAuthorizationCode({hashedCode: code.hashedCode});

    expect(consumedRequest).toBeUndefined();
    expect(consumedCode).toBeUndefined();
  });
});
