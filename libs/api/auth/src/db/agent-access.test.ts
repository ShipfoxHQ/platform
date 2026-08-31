import {pgClient} from '@shipfox/node-postgres';
import {hashOpaqueToken} from '@shipfox/node-tokens';
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

async function waitForLockWait(): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await pgClient().query<{count: number}>(`
      SELECT count(*)::int AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND state = 'active'
        AND wait_event_type = 'Lock'
    `);
    if ((result.rows[0]?.count ?? 0) > 0) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('Timed out waiting for a PostgreSQL row lock');
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
      state: 'state',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const [first, second] = await Promise.all([
      consumeAgentAuthorizationRequest({id: request.id}),
      consumeAgentAuthorizationRequest({id: request.id}),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect([first, second].filter((value) => value === undefined)).toHaveLength(1);
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
    const holder = db().transaction(async (tx) => {
      await lockAgentGrant(tx, {grantId: grant.id});
      holderReady();
      await holderReleased;
    });
    await lockAcquired;

    const waiter = db().transaction((tx) => lockAgentGrant(tx, {grantId: grant.id}));
    waiter.catch(() => undefined);
    try {
      await waitForLockWait();
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
