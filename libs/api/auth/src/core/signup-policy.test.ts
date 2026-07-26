import {config} from '#config.js';
import {
  createEnvironmentSignupPolicy,
  DEFAULT_SIGNUP_NOT_ALLOWED_MESSAGE,
} from './signup-policy.js';

vi.mock('#config.js', () => ({
  config: {
    AUTH_SIGNUP_GATE_ENABLED: true,
    AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS: ' Shipfox.io, acme.com ',
    AUTH_SIGNUP_ALLOWED_EMAILS: ' Alice@Example.com, ',
    AUTH_SIGNUP_NOT_ALLOWED_MESSAGE: undefined,
  },
}));

describe('createEnvironmentSignupPolicy', () => {
  afterEach(() => {
    vi.mocked(config).AUTH_SIGNUP_GATE_ENABLED = true;
    vi.mocked(config).AUTH_SIGNUP_NOT_ALLOWED_MESSAGE = undefined;
  });

  test('allows exact addresses and domains after normalization', async () => {
    const policy = createEnvironmentSignupPolicy();

    await expect(
      policy.isSignupAllowed({
        email: ' alice@example.com ',
        emailVerified: false,
        source: 'password',
      }),
    ).resolves.toEqual({allowed: true});
    await expect(
      policy.isSignupAllowed({
        email: 'member@SHIPFOX.IO',
        emailVerified: true,
        source: 'oauth-google',
      }),
    ).resolves.toEqual({allowed: true});
  });

  test('does not match subdomains', async () => {
    const policy = createEnvironmentSignupPolicy();

    await expect(
      policy.isSignupAllowed({
        email: 'member@eu.shipfox.io',
        emailVerified: true,
        source: 'oauth-google',
      }),
    ).resolves.toEqual({allowed: false, message: DEFAULT_SIGNUP_NOT_ALLOWED_MESSAGE});
  });

  test('returns the configured denial message for an unmatched address', async () => {
    vi.mocked(config).AUTH_SIGNUP_NOT_ALLOWED_MESSAGE = 'Ask your administrator for access.';
    const policy = createEnvironmentSignupPolicy();

    await expect(
      policy.isSignupAllowed({
        email: 'member@other.example',
        emailVerified: true,
        source: 'oauth-google',
      }),
    ).resolves.toEqual({allowed: false, message: 'Ask your administrator for access.'});
  });

  test('allows every address when the gate is disabled', async () => {
    vi.mocked(config).AUTH_SIGNUP_GATE_ENABLED = false;
    const policy = createEnvironmentSignupPolicy();

    await expect(
      policy.isSignupAllowed({
        email: 'member@other.example',
        emailVerified: false,
        source: 'password',
      }),
    ).resolves.toEqual({allowed: true});
  });
});
