import {provisionUser, signup} from '#core/auth.js';

const testConfig = vi.hoisted(() => ({
  AUTH_JWT_EXPIRES_IN: '15m',
  AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS: 14,
  AUTH_REFRESH_ROTATION_GRACE_SECONDS: 30,
  AUTH_REFRESH_COOKIE_NAME: 'shipfox_refresh_token',
  AUTH_SIGNUP_GATE_ENABLED: true,
  AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS: 'allowed.example',
  AUTH_SIGNUP_ALLOWED_EMAILS: '',
  AUTH_SIGNUP_NOT_ALLOWED_MESSAGE: undefined as string | undefined,
  CLIENT_BASE_URL: 'https://app.example.test',
}));

vi.mock('#config.js', () => ({config: testConfig}));

describe('low-level account creation defaults', () => {
  test('signup uses the environment policy when no policy is supplied', async () => {
    const email = `signup-default-${crypto.randomUUID()}@allowed.example`;

    const user = await signup({email, password: 'correct horse battery staple'});

    expect(user.email).toBe(email);
  });

  test('signup rejects an unlisted email when no policy is supplied', async () => {
    const email = `signup-default-${crypto.randomUUID()}@blocked.example`;

    await expect(signup({email, password: 'correct horse battery staple'})).rejects.toMatchObject({
      name: 'SignupNotAllowedError',
      format: 'markdown',
    });
  });

  test('provisionUser uses the environment policy when no policy is supplied', async () => {
    const email = `provision-default-${crypto.randomUUID()}@allowed.example`;

    const user = await provisionUser({email});

    expect(user.email).toBe(email);
  });

  test('provisionUser rejects an unlisted email when no policy is supplied', async () => {
    const email = `provision-default-${crypto.randomUUID()}@blocked.example`;

    await expect(provisionUser({email})).rejects.toMatchObject({
      name: 'SignupNotAllowedError',
      format: 'markdown',
    });
  });

  test('an explicit policy overrides the environment policy for both paths', async () => {
    const signupEmail = `signup-override-${crypto.randomUUID()}@blocked.example`;
    const provisionEmail = `provision-override-${crypto.randomUUID()}@blocked.example`;
    const isSignupAllowed = vi.fn().mockResolvedValue({allowed: true});
    const signupPolicy = {isSignupAllowed};

    await signup({
      email: signupEmail,
      password: 'correct horse battery staple',
      signupPolicy,
    });
    await provisionUser({email: provisionEmail, signupPolicy});

    expect(isSignupAllowed).toHaveBeenCalledTimes(2);
  });
});
