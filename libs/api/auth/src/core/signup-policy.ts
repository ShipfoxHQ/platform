import {config} from '#config.js';
import type {SignupPolicy} from './ports.js';

export const DEFAULT_SIGNUP_NOT_ALLOWED_MESSAGE =
  'This Shipfox deployment does not accept new accounts right now.';

/**
 * Builds the default signup policy from the Auth module's environment settings.
 *
 * The allowlist is resolved once at startup. Environment values are normalized
 * before matching, but the configured denial message is returned unchanged.
 */
export function createEnvironmentSignupPolicy(): SignupPolicy {
  const allowedEmails = parseAllowlist(config.AUTH_SIGNUP_ALLOWED_EMAILS);
  const allowedDomains = parseAllowlist(config.AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS);

  return {
    isSignupAllowed({email}) {
      if (!config.AUTH_SIGNUP_GATE_ENABLED) return Promise.resolve({allowed: true});

      const normalizedEmail = normalize(email);
      if (allowedEmails.has(normalizedEmail)) return Promise.resolve({allowed: true});

      const atIndex = normalizedEmail.lastIndexOf('@');
      const domain = atIndex === -1 ? '' : normalizedEmail.slice(atIndex + 1);
      if (allowedDomains.has(domain)) return Promise.resolve({allowed: true});

      return Promise.resolve({
        allowed: false,
        message: config.AUTH_SIGNUP_NOT_ALLOWED_MESSAGE ?? DEFAULT_SIGNUP_NOT_ALLOWED_MESSAGE,
        format: 'markdown',
      });
    },
  };
}

function parseAllowlist(value: string): ReadonlySet<string> {
  return new Set(value.split(',').map(normalize).filter(Boolean));
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
