import {
  createLocalKeyProvider,
  DataKeyUnwrapError,
  DataKeyWrapError,
  deriveLocalKeyVersion,
} from '@shipfox/node-envelope-encryption';
import {AgentSessionUnavailableError} from '../errors.js';

const KEK_VERSION_DOMAIN = 'shipfox-agent-session-kek-version';

export interface WrappedSessionDek {
  wrappedDek: string;
  kekVersion: string;
}

export interface SessionKeyProvider {
  readonly currentKeyVersion: string;
  readonly previousKeyVersion: string | null;
  wrapDek(workspaceId: string, plaintextDek: Buffer): WrappedSessionDek;
  unwrapDek(workspaceId: string, wrappedDek: string, kekVersion: string): Buffer;
}

export function createSessionKeyProvider(
  currentKek: Buffer,
  previousKek?: Buffer | undefined,
): SessionKeyProvider {
  const provider = createLocalKeyProvider({
    currentKek,
    previousKek,
    keyVersionDomain: KEK_VERSION_DOMAIN,
  });
  return {
    currentKeyVersion: provider.currentKeyVersion,
    previousKeyVersion: provider.previousKeyVersion,
    wrapDek(workspaceId, plaintextDek) {
      try {
        return provider.wrapDek(workspaceId, plaintextDek);
      } catch (error) {
        if (error instanceof DataKeyWrapError) {
          throw new AgentSessionUnavailableError('encryption_failed');
        }
        throw error;
      }
    },
    unwrapDek(workspaceId, wrappedDek, kekVersion) {
      try {
        return provider.unwrapDek(workspaceId, wrappedDek, kekVersion);
      } catch (error) {
        if (error instanceof DataKeyUnwrapError) {
          throw new AgentSessionUnavailableError('decryption_failed');
        }
        throw error;
      }
    },
  };
}

export function deriveSessionKekVersion(kek: Buffer): string {
  return deriveLocalKeyVersion(kek, KEK_VERSION_DOMAIN);
}
