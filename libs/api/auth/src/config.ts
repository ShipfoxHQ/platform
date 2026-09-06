import {bool, createConfig, num, str, url} from '@shipfox/config';
import {SIGNUP_DENIAL_MESSAGE_MAX_LENGTH} from '#core/ports.js';

export const config = createConfig({
  ADMIN_BOOTSTRAP_TOKEN: str({
    desc: 'Deployment secret accepted once to create the first administrator owner. Set it before bootstrap and remove or rotate it after successful bootstrap.',
    default: undefined,
  }),
  API_PUBLIC_URL: url({
    desc: 'Public origin of the API used by Agent Access OAuth metadata and redirect flows. Required. Set an externally reachable URL including the scheme. Use HTTPS outside localhost.',
  }),
  AUTH_JWT_EXPIRES_IN: str({
    desc: 'How long an access token stays valid. Accepts a duration string such as 15m, 1h, or 7d.',
    default: '15m',
  }),
  AUTH_IMPERSONATION_ENABLED: bool({
    desc: 'Whether administrators can mint impersonated sessions for target users. Defaults to false: the source-available client ships no impersonation banner, so enable it only where every signed-in surface renders one.',
    default: false,
  }),
  AUTH_JOB_LEASE_TOKEN_EXPIRES_IN: str({
    desc: 'How long a job lease token stays valid. Set it longer than the longest job (JOB_MAX_DURATION is 60 minutes) plus a safety margin.',
    default: '90m',
  }),
  AUTH_RUNNER_SESSION_TOKEN_EXPIRES_IN: str({
    desc: 'How long a runner session token stays valid. A revoked registration token can leave existing sessions usable until this lifetime ends.',
    default: '1h',
  }),
  AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS: num({
    desc: 'How many days a refresh token stays valid before the user must sign in again.',
    default: 14,
  }),
  AUTH_REFRESH_ROTATION_GRACE_SECONDS: num({
    desc: 'Window after a refresh token is rotated during which the now-rotated token is still accepted, so concurrent refreshes from parallel tabs do not log the user out. Reuse past this window is treated as a compromise and revokes the session.',
    default: 30,
  }),
  AUTH_REFRESH_COOKIE_NAME: str({
    desc: 'Name of the browser cookie that stores the refresh token.',
    default: 'shipfox_refresh_token',
  }),
  AUTH_PASSWORD_ENABLED: bool({
    desc: 'Whether password login is available. Use true or false. Defaults to true. When false, password and email-verification routes are not registered, and server startup requires another module to contribute a login method.',
    default: true,
  }),
  AUTH_SIGNUP_GATE_ENABLED: bool({
    desc: 'Whether new account creation is restricted to the configured signup email allowlist. Defaults to false, which allows every signup.',
    default: false,
  }),
  AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS: str({
    desc: 'Comma-separated email domains allowed to create accounts, such as shipfox.io,acme.com. Required when AUTH_SIGNUP_GATE_ENABLED is true unless AUTH_SIGNUP_ALLOWED_EMAILS is set.',
    default: '',
  }),
  AUTH_SIGNUP_ALLOWED_EMAILS: str({
    desc: 'Comma-separated exact email addresses allowed to create accounts. Required when AUTH_SIGNUP_GATE_ENABLED is true unless AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS is set.',
    default: '',
  }),
  AUTH_SIGNUP_NOT_ALLOWED_MESSAGE: str({
    desc: 'Markdown message returned when the signup gate blocks an account. Use at most 500 characters. Optional. The default is This Shipfox deployment does not accept new accounts right now.',
    default: undefined,
  }),
  CLIENT_BASE_URL: str({
    desc: 'Base URL of the client app. Used to build links in emails such as password resets.',
    default: 'http://localhost:5173',
  }),
});

if (
  config.AUTH_SIGNUP_GATE_ENABLED &&
  !hasSignupAllowlistEntry(config.AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS) &&
  !hasSignupAllowlistEntry(config.AUTH_SIGNUP_ALLOWED_EMAILS)
) {
  throw new Error(
    'AUTH_SIGNUP_GATE_ENABLED requires AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS or AUTH_SIGNUP_ALLOWED_EMAILS to be set.',
  );
}

if (
  config.AUTH_SIGNUP_NOT_ALLOWED_MESSAGE !== undefined &&
  config.AUTH_SIGNUP_NOT_ALLOWED_MESSAGE.length > SIGNUP_DENIAL_MESSAGE_MAX_LENGTH
) {
  throw new Error(
    `AUTH_SIGNUP_NOT_ALLOWED_MESSAGE must contain at most ${SIGNUP_DENIAL_MESSAGE_MAX_LENGTH} characters.`,
  );
}

function hasSignupAllowlistEntry(value: string): boolean {
  return value.split(',').some((entry) => entry.trim().length > 0);
}
