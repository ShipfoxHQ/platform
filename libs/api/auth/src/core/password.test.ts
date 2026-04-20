import {hashPassword, verifyPassword} from './password.js';

describe('password', () => {
  test('hashes a password and verifies it (roundtrip)', async () => {
    const password = 'correct horse battery staple';

    const hash = await hashPassword({password});
    const ok = await verifyPassword({password, hash});

    expect(hash).not.toBe(password);
    expect(hash.startsWith('$argon2')).toBe(true);
    expect(ok).toBe(true);
  });

  test('rejects wrong password', async () => {
    const hash = await hashPassword({password: 'correct horse battery staple'});

    const ok = await verifyPassword({password: 'wrong password', hash});

    expect(ok).toBe(false);
  });

  test('throws on a corrupt hash string', async () => {
    await expect(
      verifyPassword({password: 'anything', hash: 'not-an-argon2-hash'}),
    ).rejects.toThrow();
  });
});
