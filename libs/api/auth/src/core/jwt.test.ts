import {SignJWT} from 'jose';
import {signUserToken, type TokenMembership, verifyUserToken} from './jwt.js';

const SECRET = 'test-secret-do-not-use-in-prod';

function encodeSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

describe('jwt', () => {
  test('signs a token with memberships and verifies it round-trip', async () => {
    const userId = crypto.randomUUID();
    const email = `jwt-${crypto.randomUUID()}@example.com`;
    const memberships: TokenMembership[] = [
      {workspaceId: crypto.randomUUID(), role: 'admin'},
      {workspaceId: crypto.randomUUID(), role: 'admin'},
    ];

    const token = await signUserToken({
      userId,
      email,
      name: 'Token User',
      memberships,
      secret: SECRET,
      expiresIn: '7d',
    });
    const claims = await verifyUserToken({token, secret: SECRET});

    expect(claims.sub).toBe(userId);
    expect(claims.email).toBe(email);
    expect(claims.name).toBe('Token User');
    expect(claims.memberships).toEqual(memberships);
    expect(claims).not.toHaveProperty('adminRole');
    expect(claims.iat).toBeTypeOf('number');
    expect(claims.exp).toBeGreaterThan(claims.iat);
  });

  test('signs and verifies a token with empty memberships', async () => {
    const userId = crypto.randomUUID();
    const email = `jwt-${crypto.randomUUID()}@example.com`;

    const token = await signUserToken({
      userId,
      email,
      memberships: [],
      secret: SECRET,
      expiresIn: '7d',
    });
    const claims = await verifyUserToken({token, secret: SECRET});

    expect(claims.memberships).toEqual([]);
  });

  test('verifies legacy tokens without a name claim', async () => {
    const userId = crypto.randomUUID();
    const email = `jwt-${crypto.randomUUID()}@example.com`;
    const token = await new SignJWT({email, memberships: []})
      .setProtectedHeader({alg: 'HS256'})
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(encodeSecret(SECRET));

    const claims = await verifyUserToken({token, secret: SECRET});

    expect(claims.sub).toBe(userId);
    expect(claims.email).toBe(email);
    expect(claims.name).toBeUndefined();
  });

  test('rejects expired token', async () => {
    const userId = crypto.randomUUID();
    const token = await signUserToken({
      userId,
      email: `jwt-${crypto.randomUUID()}@example.com`,
      memberships: [],
      secret: SECRET,
      expiresIn: '-1s',
    });

    await expect(verifyUserToken({token, secret: SECRET})).rejects.toThrow();
  });

  test('rejects tampered signature', async () => {
    const userId = crypto.randomUUID();
    const token = await signUserToken({
      userId,
      email: `jwt-${crypto.randomUUID()}@example.com`,
      memberships: [],
      secret: SECRET,
      expiresIn: '7d',
    });
    const tampered = `${token.slice(0, -4)}xxxx`;

    await expect(verifyUserToken({token: tampered, secret: SECRET})).rejects.toThrow();
  });

  test('rejects malformed token', async () => {
    await expect(verifyUserToken({token: 'not.a.token', secret: SECRET})).rejects.toThrow();
  });

  test('rejects token signed with different secret', async () => {
    const userId = crypto.randomUUID();
    const token = await signUserToken({
      userId,
      email: `jwt-${crypto.randomUUID()}@example.com`,
      memberships: [],
      secret: SECRET,
      expiresIn: '7d',
    });

    await expect(verifyUserToken({token, secret: 'different-secret'})).rejects.toThrow();
  });

  test('rejects a token with missing memberships claim', async () => {
    const token = await new SignJWT({email: `jwt-${crypto.randomUUID()}@example.com`})
      .setProtectedHeader({alg: 'HS256'})
      .setSubject(crypto.randomUUID())
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(encodeSecret(SECRET));

    await expect(verifyUserToken({token, secret: SECRET})).rejects.toThrow();
  });

  test('rejects a token whose memberships is not an array', async () => {
    const token = await new SignJWT({
      email: `jwt-${crypto.randomUUID()}@example.com`,
      memberships: 'not-an-array',
    })
      .setProtectedHeader({alg: 'HS256'})
      .setSubject(crypto.randomUUID())
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(encodeSecret(SECRET));

    await expect(verifyUserToken({token, secret: SECRET})).rejects.toThrow();
  });

  test('rejects a token with non-UUID workspaceId in memberships', async () => {
    const token = await new SignJWT({
      email: `jwt-${crypto.randomUUID()}@example.com`,
      memberships: [{workspaceId: 'not-a-uuid', role: 'admin'}],
    })
      .setProtectedHeader({alg: 'HS256'})
      .setSubject(crypto.randomUUID())
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(encodeSecret(SECRET));

    await expect(verifyUserToken({token, secret: SECRET})).rejects.toThrow();
  });

  test('rejects a token with unknown role value', async () => {
    const token = await new SignJWT({
      email: `jwt-${crypto.randomUUID()}@example.com`,
      memberships: [{workspaceId: crypto.randomUUID(), role: 'owner'}],
    })
      .setProtectedHeader({alg: 'HS256'})
      .setSubject(crypto.randomUUID())
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(encodeSecret(SECRET));

    await expect(verifyUserToken({token, secret: SECRET})).rejects.toThrow();
  });

  test('rejects a token with non-UUID sub', async () => {
    const token = await new SignJWT({
      email: `jwt-${crypto.randomUUID()}@example.com`,
      memberships: [],
    })
      .setProtectedHeader({alg: 'HS256'})
      .setSubject('not-a-uuid')
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(encodeSecret(SECRET));

    await expect(verifyUserToken({token, secret: SECRET})).rejects.toThrow();
  });
});
