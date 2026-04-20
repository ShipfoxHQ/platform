import {hashOpaqueToken} from '@shipfox/node-tokens';
import {
  createRefreshToken,
  findActiveRefreshTokenByHash,
  revokeRefreshTokenByHash,
  revokeRefreshTokensForUser,
  rotateActiveRefreshToken,
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

  test('rotates an active refresh token and rejects stale reuse', async () => {
    const user = await createUser({email: emailFor('rt-rotate'), hashedPassword: 'h'});
    const currentHashedToken = hashOpaqueToken(`current-${crypto.randomUUID()}`);
    const nextHashedToken = hashOpaqueToken(`next-${crypto.randomUUID()}`);
    const created = await createRefreshToken({
      userId: user.id,
      hashedToken: currentHashedToken,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const rotated = await rotateActiveRefreshToken({
      id: created.id,
      currentHashedToken,
      nextHashedToken,
      expiresAt: new Date(Date.now() + 120_000),
    });
    const stale = await rotateActiveRefreshToken({
      id: created.id,
      currentHashedToken,
      nextHashedToken: hashOpaqueToken(`stale-${crypto.randomUUID()}`),
      expiresAt: new Date(Date.now() + 120_000),
    });

    expect(rotated?.hashedToken).toBe(nextHashedToken);
    expect(stale).toBeUndefined();
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
