import {config} from '#config.js';
import {decodeBase64SessionKek} from './crypto.js';
import {createSessionKeyProvider, type SessionKeyProvider} from './key-provider.js';
import {
  type RotateAgentSessionDataKeysOptions,
  rotateAgentSessionDataKeysWithProvider,
} from './rotate-kek.js';

let memoizedKeyProvider: SessionKeyProvider | undefined;

/**
 * The current KEK wraps new session DEKs. The optional previous KEK keeps old
 * wraps readable until `rotateAgentSessionDataKeys` finishes rewrapping them.
 */
export function sessionKeyProvider(): SessionKeyProvider {
  if (memoizedKeyProvider) return memoizedKeyProvider;
  memoizedKeyProvider = createSessionKeyProvider(
    decodeBase64SessionKek(config.AGENT_SESSION_ENCRYPTION_KEK, 'AGENT_SESSION_ENCRYPTION_KEK'),
    config.AGENT_SESSION_ENCRYPTION_KEK_PREVIOUS
      ? decodeBase64SessionKek(
          config.AGENT_SESSION_ENCRYPTION_KEK_PREVIOUS,
          'AGENT_SESSION_ENCRYPTION_KEK_PREVIOUS',
        )
      : undefined,
  );
  return memoizedKeyProvider;
}

export function rotateAgentSessionDataKeys(options: RotateAgentSessionDataKeysOptions = {}) {
  return rotateAgentSessionDataKeysWithProvider(sessionKeyProvider(), options);
}
