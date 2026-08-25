import {SECRETS_MAX_LIST_LIMIT} from '@shipfox/api-secrets-dto';
import {createConfig, num, str} from '@shipfox/config';
import {decodeBase64Key} from '#core/crypto.js';

export const MAX_VALUE_BYTES = 64 * 1024;

export const config = createConfig({
  SECRETS_ENCRYPTION_KEK: str({
    desc: 'Master key used to protect all stored secrets. Required. Generate a unique value per environment with openssl rand -base64 32 and provide it from a secret manager. Do not reuse AGENT_SESSION_ENCRYPTION_KEK. The committed .env value is only for local development. Losing this key makes stored secrets unrecoverable. To rotate it, set SECRETS_ENCRYPTION_KEK_PREVIOUS to the old value during the rotation window.',
  }),
  SECRETS_ENCRYPTION_KEK_PREVIOUS: str({
    desc: 'Previous master key used only while rotating stored secret data keys. Optional. Set it to the old SECRETS_ENCRYPTION_KEK value until rotation has completed.',
    default: undefined,
  }),
  SECRETS_MAX_PER_WORKSPACE: num({
    desc: 'Maximum number of secrets and variables allowed per workspace across all project scopes and namespaces.',
    default: 10000,
  }),
  SECRETS_SHORT_VALUE_WARN_LENGTH: num({
    desc: 'Secret values shorter than this many characters are classified for a write warning by management routes.',
    default: 12,
  }),
});

decodeBase64Key(config.SECRETS_ENCRYPTION_KEK, 'SECRETS_ENCRYPTION_KEK');
if (config.SECRETS_ENCRYPTION_KEK_PREVIOUS) {
  decodeBase64Key(config.SECRETS_ENCRYPTION_KEK_PREVIOUS, 'SECRETS_ENCRYPTION_KEK_PREVIOUS');
}
if (config.SECRETS_MAX_PER_WORKSPACE < 1) {
  throw new Error('SECRETS_MAX_PER_WORKSPACE must be greater than 0.');
}
if (config.SECRETS_MAX_PER_WORKSPACE > SECRETS_MAX_LIST_LIMIT) {
  // The settings UI lists the whole bounded set in one call (limit = SECRETS_MAX_LIST_LIMIT).
  // A cap above that would let the list silently truncate, so fail fast instead.
  throw new Error(
    `SECRETS_MAX_PER_WORKSPACE (${config.SECRETS_MAX_PER_WORKSPACE}) cannot exceed SECRETS_MAX_LIST_LIMIT (${SECRETS_MAX_LIST_LIMIT}).`,
  );
}
if (config.SECRETS_SHORT_VALUE_WARN_LENGTH < 1) {
  throw new Error('SECRETS_SHORT_VALUE_WARN_LENGTH must be greater than 0.');
}
