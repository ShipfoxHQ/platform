import {hashOpaqueToken} from '@shipfox/node-tokens';
import {consumeEmailVerification, createEmailVerification} from './email-verifications.js';
import {createUser} from './users.js';

function emailFor(suffix: string): string {
  return `${suffix}-${crypto.randomUUID()}@example.com`;
}

describe('email-verifications db', () => {
  test('creates a verification and consumes it once', async () => {
    const user = await createUser({email: emailFor('ev1'), hashedPassword: 'h'});
    const raw = `verification-${crypto.randomUUID()}`;
    const verification = await createEmailVerification({
      userId: user.id,
      hashedToken: hashOpaqueToken(raw),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const first = await consumeEmailVerification({hashedToken: verification.hashedToken});
    const second = await consumeEmailVerification({hashedToken: verification.hashedToken});

    expect(first?.id).toBe(verification.id);
    expect(second).toBeUndefined();
  });

  test('rejects expired verification', async () => {
    const user = await createUser({email: emailFor('ev2'), hashedPassword: 'h'});
    const verification = await createEmailVerification({
      userId: user.id,
      hashedToken: hashOpaqueToken(`expired-v-${crypto.randomUUID()}`),
      expiresAt: new Date(Date.now() - 60_000),
    });

    const consumed = await consumeEmailVerification({hashedToken: verification.hashedToken});

    expect(consumed).toBeUndefined();
  });

  test('creating a new verification invalidates prior unused for the same user', async () => {
    const user = await createUser({email: emailFor('ev3'), hashedPassword: 'h'});
    const first = await createEmailVerification({
      userId: user.id,
      hashedToken: hashOpaqueToken(`first-v-${crypto.randomUUID()}`),
      expiresAt: new Date(Date.now() + 60_000),
    });

    await createEmailVerification({
      userId: user.id,
      hashedToken: hashOpaqueToken(`second-v-${crypto.randomUUID()}`),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const consumeFirst = await consumeEmailVerification({hashedToken: first.hashedToken});

    expect(consumeFirst).toBeUndefined();
  });
});
