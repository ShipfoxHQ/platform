import {hashOpaqueToken} from '@shipfox/node-tokens';
import {consumePasswordReset, createPasswordReset} from './password-resets.js';
import {createUser} from './users.js';

function emailFor(suffix: string): string {
  return `${suffix}-${crypto.randomUUID()}@example.com`;
}

describe('password-resets db', () => {
  test('creates a reset and consumes it once', async () => {
    const user = await createUser({email: emailFor('pr1'), hashedPassword: 'h'});
    const raw = `test-token-${crypto.randomUUID()}`;
    const reset = await createPasswordReset({
      userId: user.id,
      hashedToken: hashOpaqueToken(raw),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const first = await consumePasswordReset({hashedToken: reset.hashedToken});
    const second = await consumePasswordReset({hashedToken: reset.hashedToken});

    expect(first?.id).toBe(reset.id);
    expect(second).toBeUndefined();
  });

  test('rejects expired token', async () => {
    const user = await createUser({email: emailFor('pr2'), hashedPassword: 'h'});
    const reset = await createPasswordReset({
      userId: user.id,
      hashedToken: hashOpaqueToken(`expired-${crypto.randomUUID()}`),
      expiresAt: new Date(Date.now() - 60_000),
    });

    const consumed = await consumePasswordReset({hashedToken: reset.hashedToken});

    expect(consumed).toBeUndefined();
  });

  test('creating a new reset invalidates prior unused resets for the same user', async () => {
    const user = await createUser({email: emailFor('pr3'), hashedPassword: 'h'});
    const first = await createPasswordReset({
      userId: user.id,
      hashedToken: hashOpaqueToken(`first-${crypto.randomUUID()}`),
      expiresAt: new Date(Date.now() + 60_000),
    });

    await createPasswordReset({
      userId: user.id,
      hashedToken: hashOpaqueToken(`second-${crypto.randomUUID()}`),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const consumeFirst = await consumePasswordReset({hashedToken: first.hashedToken});

    expect(consumeFirst).toBeUndefined();
  });
});
