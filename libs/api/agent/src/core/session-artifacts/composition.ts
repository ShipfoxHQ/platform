import {config} from '#config.js';
import {decodeBase64SessionKek} from './crypto.js';
import {createSessionKeyProvider, type SessionKeyProvider} from './key-provider.js';

let memoizedKeyProvider: SessionKeyProvider | undefined;

/**
 * Production session-key provider built from configuration, mirroring the
 * secrets module's `keyProvider()` (`libs/api/secrets/src/core/index.ts`):
 * the current KEK (`AGENT_SESSION_ENCRYPTION_KEK`) wraps new DEKs, and the
 * previous KEK (`AGENT_SESSION_ENCRYPTION_KEK_PREVIOUS`), when set, keeps DEKs
 * wrapped before a rotation readable during the rotation window. Callers
 * compose this provider with a `SessionDekManager` and
 * `createSessionArtifactStore`.
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
