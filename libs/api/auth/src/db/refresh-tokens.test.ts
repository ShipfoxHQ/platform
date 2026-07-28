import {hashOpaqueToken} from '@shipfox/node-tokens';
import {
  createRefreshToken,
  findActiveRefreshTokenByHash,
  findRefreshTokenByHash,
  revokeRefreshSession,
  revokeRefreshTokenByHash,
  revokeRefreshTokensForUser,
  rotateRefreshToken,
} from './refresh-tokens.js';
import {createUser} from './users.js';

function emailFor(suffix: string): string {
  return `${suffix}-${crypto.randomUUID()}@example.com`;
}

describe('refresh-tokens db', () => {
  test('creates and finds an active refresh token', async () => {
    const user = await createUser({email: emailFor('rt-create'), hashedPassword: 'h'});
    const hashedToken = hashOpaqueToken(`refresh-${crypto.randomUUID()}`);

    const created = await createRefreshToken({
      userId: user.id,
      hashedToken,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const found = await findActiveRefreshTokenByHash({hashedToken});

    expect(created.userId).toBe(user.id);
    expect(found?.id).toBe(created.id);
  });

  test('rejects expired refresh tokens', async () => {
    const user = await createUser({email: emailFor('rt-exp'), hashedPassword: 'h'});
    const hashedToken = hashOpaqueToken(`expired-${crypto.randomUUID()}`);
    await createRefreshToken({
      userId: user.id,
      hashedToken,
      expiresAt: new Date(Date.now() - 60_000),
    });

    const found = await findActiveRefreshTokenByHash({hashedToken});

    expect(found).toBeUndefined();
  });

  test('rotates a token once, creates the successor, and only the first caller wins', async () => {
    const user = await createUser({email: emailFor('rt-rotate'), hashedPassword: 'h'});
    const currentHashedToken = hashOpaqueToken(`current-${crypto.randomUUID()}`);
    const nextHashedToken = hashOpaqueToken(`next-${crypto.randomUUID()}`);
    const created = await createRefreshToken({
      userId: user.id,
      hashedToken: currentHashedToken,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const won = await rotateRefreshToken({
      id: created.id,
      currentHashedToken,
      nextHashedToken,
      expiresAt: new Date(Date.now() + 120_000),
    });
    const lost = await rotateRefreshToken({
      id: created.id,
      currentHashedToken,
      nextHashedToken: hashOpaqueToken(`lost-${crypto.randomUUID()}`),
      expiresAt: new Date(Date.now() + 120_000),
    });
    const successor = await findActiveRefreshTokenByHash({hashedToken: nextHashedToken});

    expect(won?.rotatedAt).toBeInstanceOf(Date);
    expect(lost).toBeUndefined();
    expect(successor?.hashedToken).toBe(nextHashedToken);
  });

  test('rolls back the rotation when successor creation fails', async () => {
    const user = await createUser({email: emailFor('rt-rotate-rollback'), hashedPassword: 'h'});
    const currentHashedToken = hashOpaqueToken(`current-${crypto.randomUUID()}`);
    const duplicateHashedToken = hashOpaqueToken(`duplicate-${crypto.randomUUID()}`);
    const created = await createRefreshToken({
      userId: user.id,
      hashedToken: currentHashedToken,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await createRefreshToken({
      userId: user.id,
      hashedToken: duplicateHashedToken,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const failed = rotateRefreshToken({
      id: created.id,
      currentHashedToken,
      nextHashedToken: duplicateHashedToken,
      expiresAt: new Date(Date.now() + 120_000),
    });

    await expect(failed).rejects.toThrow();
    const active = await findActiveRefreshTokenByHash({hashedToken: currentHashedToken});
    expect(active?.id).toBe(created.id);
    expect(active?.rotatedAt).toBeNull();
  });

  test('rotated tokens drop out of the active lookup but stay findable for the grace window', async () => {
    const user = await createUser({email: emailFor('rt-rotated-find'), hashedPassword: 'h'});
    const currentHashedToken = hashOpaqueToken(`current-${crypto.randomUUID()}`);
    const nextHashedToken = hashOpaqueToken(`next-${crypto.randomUUID()}`);
    const created = await createRefreshToken({
      userId: user.id,
      hashedToken: currentHashedToken,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await rotateRefreshToken({
      id: created.id,
      currentHashedToken,
      nextHashedToken,
      expiresAt: new Date(Date.now() + 120_000),
    });

    const active = await findActiveRefreshTokenByHash({hashedToken: currentHashedToken});
    const found = await findRefreshTokenByHash({hashedToken: currentHashedToken});

    expect(active).toBeUndefined();
    expect(found?.id).toBe(created.id);
    expect(found?.rotatedAt).toBeInstanceOf(Date);
  });

  test('revokes a single refresh token by hash', async () => {
    const user = await createUser({email: emailFor('rt-revoke'), hashedPassword: 'h'});
    const hashedToken = hashOpaqueToken(`revoke-${crypto.randomUUID()}`);
    await createRefreshToken({
      userId: user.id,
      hashedToken,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await revokeRefreshTokenByHash({hashedToken});
    const found = await findActiveRefreshTokenByHash({hashedToken});

    expect(found).toBeUndefined();
  });

  test('revokes every token in one refresh-session lineage', async () => {
    const user = await createUser({email: emailFor('rt-revoke-session'), hashedPassword: 'h'});
    const currentHashedToken = hashOpaqueToken(`current-${crypto.randomUUID()}`);
    const nextHashedToken = hashOpaqueToken(`next-${crypto.randomUUID()}`);
    const created = await createRefreshToken({
      userId: user.id,
      hashedToken: currentHashedToken,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await rotateRefreshToken({
      id: created.id,
      currentHashedToken,
      nextHashedToken,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await revokeRefreshSession({sessionId: created.sessionId, userId: user.id});

    expect(await findRefreshTokenByHash({hashedToken: currentHashedToken})).toBeUndefined();
    expect(await findActiveRefreshTokenByHash({hashedToken: nextHashedToken})).toBeUndefined();
  });

  test('revokes all user refresh tokens except the selected session', async () => {
    const user = await createUser({email: emailFor('rt-revoke-user'), hashedPassword: 'h'});
    const keepHash = hashOpaqueToken(`keep-${crypto.randomUUID()}`);
    const revokeHash = hashOpaqueToken(`revoke-${crypto.randomUUID()}`);
    const keep = await createRefreshToken({
      userId: user.id,
      hashedToken: keepHash,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await createRefreshToken({
      userId: user.id,
      hashedToken: revokeHash,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await revokeRefreshTokensForUser({userId: user.id, exceptRefreshTokenId: keep.id});
    const kept = await findActiveRefreshTokenByHash({hashedToken: keepHash});
    const revoked = await findActiveRefreshTokenByHash({hashedToken: revokeHash});

    expect(kept?.id).toBe(keep.id);
    expect(revoked).toBeUndefined();
  });
});
