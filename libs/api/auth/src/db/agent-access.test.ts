import {hashOpaqueToken} from '@shipfox/node-tokens';
import {eq, sql} from 'drizzle-orm';
import {userFactory} from '#test/index.js';
import {
  agentRefreshTokenExpiresAt,
  consumeAgentAuthorizationCode,
  consumeAgentAuthorizationRequest,
  createAgentAuthorizationCode,
  createAgentAuthorizationRequest,
  createAgentClient,
  createAgentGrant,
  createAgentRefreshToken,
  findActiveAgentAuthorizationCodeByHash,
  findActiveAgentRefreshTokenByGrantId,
  findActiveAgentRefreshTokenByHash,
  findAgentAuthorizationCodeByHash,
  findAgentClientByClientId,
  findAgentGrant,
  findAgentRefreshTokenByHash,
  findPendingAgentAuthorizationRequest,
  isWithinAgentRefreshRotationGrace,
  lockAgentGrant,
  pruneAgentAccess,
  pruneAgentAccessBatch,
  resolveAgentRefreshTokenReplay,
  revokeAgentGrant,
  rotateAgentRefreshToken,
  transitionAgentGrantsToTerminal,
  upsertCimdAgentClient,
} from './agent-access.js';
import {db} from './db.js';
import {agentClients, agentGrants, agentRefreshTokens} from './schema/agent-access.js';
import {users} from './schema/users.js';

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
  test('does not accept a future rotation timestamp as a grace replay', () => {
    const now = new Date('2026-09-01T00:00:00.000Z');

    expect(
      isWithinAgentRefreshRotationGrace({
        rotatedAt: new Date(now.getTime() + 1_000),
        now,
        graceSeconds: 30,
      }),
    ).toBe(false);
  });

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
    const refreshToken = await createAgentRefreshToken({
      grantId: first.id,
      hashedToken: hashOpaqueToken(`refresh-${crypto.randomUUID()}`),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const second = await createAgentGrant({...params, scopes: ['read', 'write']});

    expect(second).toMatchObject({id: first.id, scopes: ['read', 'write']});
    expect(
      await findActiveAgentRefreshTokenByHash({hashedToken: refreshToken.hashedToken}),
    ).toBeUndefined();
    expect(await findAgentClientByClientId({clientId: client.clientId})).toMatchObject({
      id: client.id,
      unreferencedAt: null,
    });
  });

  test('refreshes validated CIMD metadata while preserving the client row', async () => {
    const clientId = `https://client.example/.well-known/${crypto.randomUUID()}`;
    const first = await upsertCimdAgentClient({
      clientId,
      name: 'First name',
      redirectUris: ['https://client.example/first'],
    });
    const second = await upsertCimdAgentClient({
      clientId,
      name: 'Updated name',
      redirectUris: ['https://client.example/updated'],
    });

    expect(second).toMatchObject({
      id: first.id,
      clientId,
      name: 'Updated name',
      redirectUris: ['https://client.example/updated'],
      kind: 'cimd',
      unreferencedAt: null,
    });
  });

  test('manages refresh tokens', async () => {
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

    await pruneAgentAccess({retentionDays: 0, now: new Date(Date.now() + 1_000)});

    expect(
      await findAgentRefreshTokenByHash({hashedToken: refreshToken.hashedToken}),
    ).toBeUndefined();
  });

  test('serializes concurrent refresh rotation and revokes the complete grant family', async () => {
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
    const first = await createAgentRefreshToken({
      grantId: grant.id,
      hashedToken: hashOpaqueToken(`concurrent-refresh-${crypto.randomUUID()}`),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const replacements = [
      hashOpaqueToken(`replacement-a-${crypto.randomUUID()}`),
      hashOpaqueToken(`replacement-b-${crypto.randomUUID()}`),
    ];

    const rotations = await Promise.all(
      replacements.map((replacementHashedToken) =>
        rotateAgentRefreshToken({
          hashedToken: first.hashedToken,
          replacementHashedToken,
          replacementExpiresAt: new Date(Date.now() + 60_000),
        }),
      ),
    );

    expect(rotations.filter(Boolean)).toHaveLength(1);
    const refreshRows = await db()
      .select({id: agentRefreshTokens.id, hashedToken: agentRefreshTokens.hashedToken})
      .from(agentRefreshTokens)
      .where(eq(agentRefreshTokens.grantId, grant.id));
    expect(refreshRows).toHaveLength(2);
    expect(await findAgentRefreshTokenByHash({hashedToken: first.hashedToken})).toMatchObject({
      id: first.id,
      rotatedAt: expect.any(Date),
    });
    const live = await findActiveAgentRefreshTokenByGrantId({grantId: grant.id});
    expect(live?.hashedToken).toBeOneOf(replacements);

    const revoked = await revokeAgentGrant({grantId: grant.id});
    expect(revoked).toMatchObject({
      id: grant.id,
      revokedAt: expect.any(Date),
      terminalAt: expect.any(Date),
    });
    expect(await findAgentRefreshTokenByHash({hashedToken: first.hashedToken})).toBeUndefined();
    expect(await findActiveAgentRefreshTokenByGrantId({grantId: grant.id})).toBeUndefined();
    for (const hashedToken of replacements) {
      expect(await findAgentRefreshTokenByHash({hashedToken})).toBeUndefined();
    }
  });

  test('serves retained refresh replays during grace and revokes reuse after grace', async () => {
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
    const predecessor = await createAgentRefreshToken({
      grantId: grant.id,
      hashedToken: hashOpaqueToken(`grace-refresh-${crypto.randomUUID()}`),
    });
    const replacementHashedToken = hashOpaqueToken(`grace-successor-${crypto.randomUUID()}`);
    const expectedSlidingExpiry = agentRefreshTokenExpiresAt();
    const successor = await rotateAgentRefreshToken({
      hashedToken: predecessor.hashedToken,
      replacementHashedToken,
    });
    if (!successor) throw new Error('Expected refresh rotation to create a successor');

    expect(successor?.expiresAt.getTime()).toBeGreaterThanOrEqual(
      expectedSlidingExpiry.getTime() - 1_000,
    );
    const rotated = await findAgentRefreshTokenByHash({hashedToken: predecessor.hashedToken});
    expect(rotated?.rotatedAt).toEqual(expect.any(Date));
    if (!rotated?.rotatedAt) throw new Error('Expected the predecessor to be marked rotated');
    const graceReplay = await resolveAgentRefreshTokenReplay({
      hashedToken: predecessor.hashedToken,
      now: rotated.rotatedAt,
    });
    expect(graceReplay).toMatchObject({
      kind: 'grace',
      grant: {id: grant.id, revokedAt: null},
      predecessor: {id: predecessor.id},
      successor: {id: successor.id},
    });

    await db()
      .update(agentRefreshTokens)
      .set({rotatedAt: new Date(Date.now() - 31_000)})
      .where(eq(agentRefreshTokens.id, predecessor.id));
    const reused = await resolveAgentRefreshTokenReplay({
      hashedToken: predecessor.hashedToken,
    });
    expect(reused).toMatchObject({
      kind: 'reused',
      grant: {
        id: grant.id,
        revokedAt: expect.any(Date),
        terminalAt: expect.any(Date),
      },
    });
    expect(
      await findAgentRefreshTokenByHash({hashedToken: predecessor.hashedToken}),
    ).toBeUndefined();
    expect(
      await findAgentRefreshTokenByHash({hashedToken: replacementHashedToken}),
    ).toBeUndefined();
  });

  test('revokes a grant when a predecessor expires during the rotation grace window', async () => {
    const user = await userFactory.create();
    const client = await createAgentClient({
      clientId: `https://client.example/${crypto.randomUUID()}`,
      name: 'Expired predecessor client',
      redirectUris: ['https://client.example/callback'],
      kind: 'registered',
    });
    const grant = await createAgentGrant({
      userId: user.id,
      workspaceId: crypto.randomUUID(),
      clientId: client.id,
      scopes: ['read'],
    });
    const predecessor = await createAgentRefreshToken({
      grantId: grant.id,
      hashedToken: hashOpaqueToken(`expired-predecessor-${crypto.randomUUID()}`),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const successor = await rotateAgentRefreshToken({
      hashedToken: predecessor.hashedToken,
      replacementHashedToken: hashOpaqueToken(`expired-successor-${crypto.randomUUID()}`),
    });
    if (!successor) throw new Error('Expected refresh rotation to create a successor');

    const rotated = await findAgentRefreshTokenByHash({hashedToken: predecessor.hashedToken});
    if (!rotated?.rotatedAt) throw new Error('Expected the predecessor to be marked rotated');
    const replayNow = new Date(rotated.rotatedAt.getTime() + 1_000);
    await db()
      .update(agentRefreshTokens)
      .set({expiresAt: new Date(replayNow.getTime() - 1)})
      .where(eq(agentRefreshTokens.id, predecessor.id));

    const replay = await resolveAgentRefreshTokenReplay({
      hashedToken: predecessor.hashedToken,
      now: replayNow,
    });
    expect(replay).toMatchObject({
      kind: 'reused',
      grant: {
        id: grant.id,
        revokedAt: expect.any(Date),
        terminalAt: expect.any(Date),
      },
    });
  });

  test('rejects code exchange and refresh rotation for suspended users', async () => {
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
      hashedToken: hashOpaqueToken(`suspended-refresh-${crypto.randomUUID()}`),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const code = await createAgentAuthorizationCode({
      grantId: grant.id,
      hashedCode: hashOpaqueToken(`suspended-code-${crypto.randomUUID()}`),
      codeChallenge: 'challenge',
      redirectUri: 'https://client.example/callback',
      resource: 'https://api.example/mcp',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await db().update(users).set({status: 'suspended'}).where(eq(users.id, user.id));

    expect(
      await rotateAgentRefreshToken({
        hashedToken: refreshToken.hashedToken,
        replacementHashedToken: hashOpaqueToken(`unused-suspended-${crypto.randomUUID()}`),
      }),
    ).toBeUndefined();
    expect(await consumeAgentAuthorizationCode({hashedCode: code.hashedCode})).toBeUndefined();
    expect(
      await findActiveAgentRefreshTokenByHash({hashedToken: refreshToken.hashedToken}),
    ).toMatchObject({id: refreshToken.id});
    expect(
      await findActiveAgentAuthorizationCodeByHash({hashedCode: code.hashedCode}),
    ).toMatchObject({
      id: code.id,
    });
  });

  test('treats a replay after pruning as an unknown token without revoking its grant', async () => {
    const user = await userFactory.create();
    const client = await createAgentClient({
      clientId: `https://client.example/${crypto.randomUUID()}`,
      name: 'Pruned replay client',
      redirectUris: ['https://client.example/callback'],
      kind: 'registered',
    });
    const grant = await createAgentGrant({
      userId: user.id,
      workspaceId: crypto.randomUUID(),
      clientId: client.id,
      scopes: ['read'],
    });
    const predecessor = await createAgentRefreshToken({
      grantId: grant.id,
      hashedToken: hashOpaqueToken(`pruned-replay-${crypto.randomUUID()}`),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const successorHashedToken = hashOpaqueToken(`pruned-successor-${crypto.randomUUID()}`);
    const successor = await rotateAgentRefreshToken({
      hashedToken: predecessor.hashedToken,
      replacementHashedToken: successorHashedToken,
      replacementExpiresAt: new Date(Date.now() + 60_000),
    });
    if (!successor) throw new Error('Expected refresh rotation to create a successor');
    await db()
      .update(agentRefreshTokens)
      .set({rotatedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)})
      .where(eq(agentRefreshTokens.id, predecessor.id));

    await pruneAgentAccess({retentionDays: 0, now: new Date(Date.now() + 1_000)});

    expect(
      await resolveAgentRefreshTokenReplay({hashedToken: predecessor.hashedToken}),
    ).toBeUndefined();
    expect(
      await findActiveAgentRefreshTokenByHash({hashedToken: successorHashedToken}),
    ).toMatchObject({
      id: successor.id,
    });
    expect(await findAgentGrant({id: grant.id})).toMatchObject({
      id: grant.id,
      revokedAt: null,
      terminalAt: null,
    });
  });

  test('keeps terminal transitions serialized with authorization-code exchange', async () => {
    const user = await userFactory.create();
    const client = await createAgentClient({
      clientId: `https://client.example/${crypto.randomUUID()}`,
      name: 'Test client',
      redirectUris: ['https://client.example/callback'],
      kind: 'registered',
    });
    const emptyGrant = await createAgentGrant({
      userId: user.id,
      workspaceId: crypto.randomUUID(),
      clientId: client.id,
      scopes: ['read'],
    });
    expect(await transitionAgentGrantsToTerminal()).toBeGreaterThanOrEqual(1);
    expect(await findAgentGrant({id: emptyGrant.id})).toMatchObject({
      terminalAt: expect.any(Date),
    });

    const grant = await createAgentGrant({
      userId: user.id,
      workspaceId: crypto.randomUUID(),
      clientId: client.id,
      scopes: ['read'],
    });
    const code = await createAgentAuthorizationCode({
      grantId: grant.id,
      hashedCode: hashOpaqueToken(`racing-code-${crypto.randomUUID()}`),
      codeChallenge: 'challenge',
      redirectUri: 'https://client.example/callback',
      resource: 'https://api.example/mcp',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await transitionAgentGrantsToTerminal({limit: 1_000});
    expect(await findAgentGrant({id: grant.id})).toMatchObject({terminalAt: null});

    const [consumed, transitioned] = await Promise.all([
      consumeAgentAuthorizationCode({hashedCode: code.hashedCode}),
      transitionAgentGrantsToTerminal(),
    ]);

    expect(consumed).toMatchObject({id: code.id, grantId: grant.id});
    expect(transitioned).toBeLessThanOrEqual(1);
    expect(await consumeAgentAuthorizationCode({hashedCode: code.hashedCode})).toBeUndefined();
    if (transitioned === 0) {
      expect(await transitionAgentGrantsToTerminal({limit: 1_000})).toBe(1);
    }
    expect(await findAgentGrant({id: grant.id})).toMatchObject({
      terminalAt: expect.any(Date),
    });
  });

  test('applies credential retention windows and retires clients after their grants', async () => {
    const now = new Date('2026-09-01T00:00:00.000Z');
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const user = await userFactory.create();
    const client = await createAgentClient({
      clientId: `https://client.example/${crypto.randomUUID()}`,
      name: 'Retention client',
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
      expiresAt: oneDayAgo,
    });
    const grant = await createAgentGrant({
      userId: user.id,
      workspaceId: crypto.randomUUID(),
      clientId: client.id,
      scopes: ['read'],
    });
    const code = await createAgentAuthorizationCode({
      grantId: grant.id,
      hashedCode: hashOpaqueToken(`retention-code-${crypto.randomUUID()}`),
      codeChallenge: 'challenge',
      redirectUri: 'https://client.example/callback',
      resource: 'https://api.example/mcp',
      expiresAt: oneDayAgo,
    });
    const rotated = await createAgentRefreshToken({
      grantId: grant.id,
      hashedToken: hashOpaqueToken(`retention-rotated-${crypto.randomUUID()}`),
      expiresAt: new Date(now.getTime() + 60_000),
    });
    await db()
      .update(agentRefreshTokens)
      .set({rotatedAt: thirtyDaysAgo})
      .where(eq(agentRefreshTokens.id, rotated.id));
    const revoked = await createAgentRefreshToken({
      grantId: grant.id,
      hashedToken: hashOpaqueToken(`retention-revoked-${crypto.randomUUID()}`),
      expiresAt: new Date(now.getTime() + 60_000),
    });
    await db()
      .update(agentRefreshTokens)
      .set({revokedAt: thirtyDaysAgo})
      .where(eq(agentRefreshTokens.id, revoked.id));
    const expired = await createAgentRefreshToken({
      grantId: grant.id,
      hashedToken: hashOpaqueToken(`retention-expired-${crypto.randomUUID()}`),
      expiresAt: thirtyDaysAgo,
    });
    await pruneAgentAccess({now});

    expect(await findPendingAgentAuthorizationRequest({id: request.id})).toBeUndefined();
    expect(await findAgentAuthorizationCodeByHash({hashedCode: code.hashedCode})).toBeUndefined();
    for (const token of [rotated, revoked, expired]) {
      expect(await findAgentRefreshTokenByHash({hashedToken: token.hashedToken})).toBeUndefined();
    }
    expect(await findAgentGrant({id: grant.id})).toMatchObject({
      terminalAt: expect.any(Date),
    });
    expect(await findAgentClientByClientId({clientId: client.clientId})).toMatchObject({
      id: client.id,
      unreferencedAt: null,
    });

    await db()
      .update(agentGrants)
      .set({terminalAt: ninetyDaysAgo})
      .where(eq(agentGrants.id, grant.id));
    await pruneAgentAccess({now});
    expect(await findAgentGrant({id: grant.id})).toBeUndefined();
    expect(await findAgentClientByClientId({clientId: client.clientId})).toMatchObject({
      id: client.id,
      unreferencedAt: expect.any(Date),
    });

    await pruneAgentAccess({now: new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000)});
    expect(await findAgentClientByClientId({clientId: client.clientId})).toBeUndefined();
  });

  test('retains live credentials and rejects new children after grant revocation', async () => {
    const user = await userFactory.create();
    const client = await createAgentClient({
      clientId: `https://client.example/${crypto.randomUUID()}`,
      name: 'Live client',
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
      hashedToken: hashOpaqueToken(`live-refresh-${crypto.randomUUID()}`),
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await transitionAgentGrantsToTerminal({limit: 1})).toBe(0);
    await pruneAgentAccess({retentionDays: 0, now: new Date(Date.now() + 1_000)});
    expect(await findAgentGrant({id: grant.id})).toMatchObject({terminalAt: null});
    expect(
      await findActiveAgentRefreshTokenByHash({hashedToken: refreshToken.hashedToken}),
    ).toMatchObject({
      id: refreshToken.id,
    });
    await revokeAgentGrant({grantId: grant.id});
    await expect(
      createAgentRefreshToken({
        grantId: grant.id,
        hashedToken: hashOpaqueToken(`rejected-refresh-${crypto.randomUUID()}`),
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).rejects.toThrow('no longer active');
    await expect(
      createAgentAuthorizationCode({
        grantId: grant.id,
        hashedCode: hashOpaqueToken(`rejected-code-${crypto.randomUUID()}`),
        codeChallenge: 'challenge',
        redirectUri: 'https://client.example/callback',
        resource: 'https://api.example/mcp',
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).rejects.toThrow('no longer active');
  });

  test('keeps a never-granted client while it has a live authorization request', async () => {
    const client = await createAgentClient({
      clientId: `https://client.example/${crypto.randomUUID()}`,
      name: 'Pending client',
      redirectUris: ['https://client.example/callback'],
      kind: 'cimd',
    });
    const oldCreatedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await db()
      .update(agentClients)
      .set({createdAt: oldCreatedAt})
      .where(eq(agentClients.id, client.id));
    const request = await createAgentAuthorizationRequest({
      clientId: client.id,
      redirectUri: 'https://client.example/callback',
      resource: 'https://api.example/mcp',
      scopes: ['read'],
      codeChallenge: 'challenge',
      state: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await pruneAgentAccess({retentionDays: 0, now: new Date(Date.now() + 1_000)});
    expect(await findAgentClientByClientId({clientId: client.clientId})).toMatchObject({
      id: client.id,
    });

    expect(await consumeAgentAuthorizationRequest({id: request.id})).toMatchObject({
      id: request.id,
    });
    await pruneAgentAccess({retentionDays: 0, now: new Date(Date.now() + 1_000)});
    expect(await findAgentClientByClientId({clientId: client.clientId})).toBeUndefined();
  });

  test('retains a child revoked after grant terminalization until its own horizon', async () => {
    const now = new Date('2026-09-01T00:00:00.000Z');
    const user = await userFactory.create();
    const client = await createAgentClient({
      clientId: `https://client.example/${crypto.randomUUID()}`,
      name: 'Child retention client',
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
      hashedToken: hashOpaqueToken(`late-revoked-refresh-${crypto.randomUUID()}`),
      expiresAt: new Date(now.getTime() + 60_000),
    });
    const terminalAt = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    await db().update(agentGrants).set({terminalAt}).where(eq(agentGrants.id, grant.id));
    await db()
      .update(agentRefreshTokens)
      .set({revokedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000)})
      .where(eq(agentRefreshTokens.id, refreshToken.id));

    await pruneAgentAccess({now});
    expect(await findAgentGrant({id: grant.id})).toMatchObject({id: grant.id});
    expect(
      await findAgentRefreshTokenByHash({hashedToken: refreshToken.hashedToken}),
    ).toBeUndefined();
    const retainedRefresh = await db()
      .select({id: agentRefreshTokens.id})
      .from(agentRefreshTokens)
      .where(eq(agentRefreshTokens.id, refreshToken.id));
    expect(retainedRefresh).toHaveLength(1);

    await pruneAgentAccess({now: new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000)});
    expect(await findAgentGrant({id: grant.id})).toBeUndefined();
  });

  test('does not let retained children starve newer terminal grants', async () => {
    const now = new Date('2026-09-01T00:00:00.000Z');
    const user = await userFactory.create();
    const blockedClient = await createAgentClient({
      clientId: `https://client.example/${crypto.randomUUID()}`,
      name: 'Blocked terminal client',
      redirectUris: ['https://client.example/callback'],
      kind: 'registered',
    });
    const deletableClient = await createAgentClient({
      clientId: `https://client.example/${crypto.randomUUID()}`,
      name: 'Deletable terminal client',
      redirectUris: ['https://client.example/callback'],
      kind: 'registered',
    });
    const blockedGrant = await createAgentGrant({
      userId: user.id,
      workspaceId: crypto.randomUUID(),
      clientId: blockedClient.id,
      scopes: ['read'],
    });
    const deletableGrant = await createAgentGrant({
      userId: user.id,
      workspaceId: crypto.randomUUID(),
      clientId: deletableClient.id,
      scopes: ['read'],
    });
    const retainedChild = await createAgentRefreshToken({
      grantId: blockedGrant.id,
      hashedToken: hashOpaqueToken(`starving-child-${crypto.randomUUID()}`),
      expiresAt: new Date(now.getTime() + 60_000),
    });
    const terminalAt = new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000);
    await db().update(agentGrants).set({terminalAt}).where(eq(agentGrants.id, blockedGrant.id));
    await db().update(agentGrants).set({terminalAt}).where(eq(agentGrants.id, deletableGrant.id));
    await db()
      .update(agentRefreshTokens)
      .set({revokedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000)})
      .where(eq(agentRefreshTokens.id, retainedChild.id));

    await pruneAgentAccess({now, limit: 1});

    expect(await findAgentGrant({id: blockedGrant.id})).toMatchObject({id: blockedGrant.id});
    expect(await findAgentGrant({id: deletableGrant.id})).toBeUndefined();
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

  test(
    'bounds retention waits on a locked terminal grant',
    async () => {
      const user = await userFactory.create();
      const client = await createAgentClient({
        clientId: `https://client.example/${crypto.randomUUID()}`,
        name: 'Retention lock client',
        redirectUris: ['https://client.example/callback'],
        kind: 'registered',
      });
      const grant = await createAgentGrant({
        userId: user.id,
        workspaceId: crypto.randomUUID(),
        clientId: client.id,
        scopes: ['read'],
      });
      await db()
        .update(agentGrants)
        .set({terminalAt: new Date('2000-01-01T00:00:00.000Z')})
        .where(eq(agentGrants.id, grant.id));

      const holderReady = deferred<void>();
      const releaseHolder = deferred<void>();
      const holder = db().transaction(async (tx) => {
        await tx
          .update(agentGrants)
          .set({updatedAt: sql`now()`})
          .where(eq(agentGrants.id, grant.id));
        holderReady.resolve();
        await releaseHolder.promise;
      });

      try {
        await holderReady.promise;
        await expect(
          pruneAgentAccessBatch({
            now: new Date('2026-09-01T00:00:00.000Z'),
            limit: 1,
            deadlineMs: Date.now() + 1_500,
          }),
        ).rejects.toMatchObject({
          cause: {code: expect.stringMatching('^(55P03|57014)$')},
        });
      } finally {
        releaseHolder.resolve();
        await holder;
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
      expiresAt: new Date(Date.now() - 1_000),
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
      expiresAt: new Date(Date.now() - 1_000),
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
