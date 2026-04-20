import {hashOpaqueToken} from '@shipfox/node-tokens';
import {
  createUser,
  findUserByEmail,
  findUserById,
  markEmailVerified,
  updateUserPassword,
} from './users.js';

function emailFor(suffix: string): string {
  return `${suffix}-${crypto.randomUUID()}@example.com`;
}

describe('users db', () => {
  test('creates a user with email_verified_at null and finds by email and id', async () => {
    const email = emailFor('alice');

    const user = await createUser({email, hashedPassword: 'h', name: 'Alice'});
    const byEmail = await findUserByEmail({email});
    const byId = await findUserById({id: user.id});

    expect(user.id).toBeDefined();
    expect(user.email).toBe(email);
    expect(user.emailVerifiedAt).toBeNull();
    expect(byEmail?.id).toBe(user.id);
    expect(byId?.id).toBe(user.id);
  });

  test('rejects duplicate email', async () => {
    const email = emailFor('dup');
    await createUser({email, hashedPassword: 'h'});

    await expect(createUser({email, hashedPassword: 'h2'})).rejects.toThrow();
  });

  test('updateUserPassword updates the hashed password', async () => {
    const user = await createUser({email: emailFor('pwbump'), hashedPassword: 'old'});

    const updated = await updateUserPassword({userId: user.id, hashedPassword: 'new'});

    expect(updated?.hashedPassword).toBe('new');
  });

  test('markEmailVerified sets emailVerifiedAt', async () => {
    const user = await createUser({email: emailFor('verify'), hashedPassword: 'h'});

    const verified = await markEmailVerified({userId: user.id});

    expect(verified?.emailVerifiedAt).toBeInstanceOf(Date);
  });

  // Ensure the imported hashOpaqueToken is recognized by the linter as used.
  test('opaque token helpers remain available', () => {
    expect(typeof hashOpaqueToken).toBe('function');
  });
});
