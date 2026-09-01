import {hkdfSync} from 'node:crypto';
import {createConfig, str} from '@shipfox/config';

const AUTH_ROOT_KEY_BYTES = 32;
const HKDF_SALT = 'shipfox/auth-root/v1';
const CANONICAL_BASE64_KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;

const config = createConfig({
  AUTH_ROOT_KEY: str({
    desc: 'Root key used to derive API authentication and email-challenge keys. Required. Generate a unique value per environment with openssl rand -base64 32 and provide it from a secret manager.',
  }),
});

const rootKey = decodeAuthRootKey(config.AUTH_ROOT_KEY);

const userAccessKey = deriveKey('shipfox/user-access-token/v1');
const agentAccessTokenDerivedKey = deriveKey('shipfox/agent-access-token/v1');
const jobLeaseKey = deriveKey('shipfox/job-lease-token/v1');
const runnerSessionKey = deriveKey('shipfox/runner-session-token/v1');
const rateLimitKey = deriveKey('shipfox/rate-limit-identifier/v1');
const emailChallengeDerivedKey = deriveKey('shipfox/email-challenge/v1');

export function userAccessTokenKey(): Uint8Array {
  return userAccessKey;
}

export function agentAccessTokenKey(): Uint8Array {
  return agentAccessTokenDerivedKey;
}

export function jobLeaseTokenKey(): Uint8Array {
  return jobLeaseKey;
}

export function runnerSessionTokenKey(): Uint8Array {
  return runnerSessionKey;
}

export function rateLimitIdentifierKey(): Uint8Array {
  return rateLimitKey;
}

export function emailChallengeKey(): Uint8Array {
  return emailChallengeDerivedKey;
}

function deriveKey(label: string): Uint8Array {
  return Buffer.from(hkdfSync('sha256', rootKey, HKDF_SALT, label, AUTH_ROOT_KEY_BYTES));
}

function decodeAuthRootKey(encoded: string | undefined): Buffer {
  if (!encoded) {
    throw new Error(
      'AUTH_ROOT_KEY is required and must be a canonical base64-encoded 32-byte key. Generate one with openssl rand -base64 32.',
    );
  }

  const key = Buffer.from(encoded, 'base64');
  const isCanonical =
    CANONICAL_BASE64_KEY_PATTERN.test(encoded) && key.toString('base64') === encoded;
  if (key.length !== AUTH_ROOT_KEY_BYTES || !isCanonical) {
    throw new Error(
      'AUTH_ROOT_KEY must be a canonical base64-encoded 32-byte key. Strip whitespace and generate a new value with openssl rand -base64 32 if needed.',
    );
  }

  return key;
}
