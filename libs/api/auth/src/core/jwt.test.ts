import {signUserToken, verifyUserToken} from './jwt.js';

const SECRET = 'test-secret-do-not-use-in-prod';

describe('jwt', () => {
  test('signs a token and verifies it', async () => {
    const userId = crypto.randomUUID();
    const email = `jwt-${crypto.randomUUID()}@example.com`;

    const token = await signUserToken({userId, email, secret: SECRET, expiresIn: '7d'});
    const claims = await verifyUserToken({token, secret: SECRET});

    expect(claims.sub).toBe(userId);
    expect(claims.email).toBe(email);
    expect(claims.iat).toBeTypeOf('number');
    expect(claims.exp).toBeGreaterThan(claims.iat);
  });

  test('rejects expired token', async () => {
    const userId = crypto.randomUUID();
    const token = await signUserToken({
      userId,
      email: `jwt-${crypto.randomUUID()}@example.com`,
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
      secret: SECRET,
      expiresIn: '7d',
    });

    await expect(verifyUserToken({token, secret: 'different-secret'})).rejects.toThrow();
  });
});
