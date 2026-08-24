import crypto from 'node:crypto';
import {AgentSessionUnavailableError} from '../errors.js';
import {aadForSessionDek, openSessionDek, sealSessionDek} from './crypto.js';

const KEK_VERSION_DOMAIN = 'shipfox-agent-session-kek-version';

export interface WrappedSessionDek {
  wrappedDek: string;
  kekVersion: string;
}

/**
 * Wraps and unwraps per-workspace session data-encryption keys under the
 * session-artifact KEK, mirroring the secrets store's `KeyProvider`
 * (`libs/api/secrets/src/core/key-provider.ts`).
 */
export interface SessionKeyProvider {
  readonly currentKeyVersion: string;
  wrapDek(workspaceId: string, plaintextDek: Buffer): WrappedSessionDek;
  unwrapDek(workspaceId: string, wrappedDek: string, kekVersion: string): Buffer;
}

export function createSessionKeyProvider(currentKek: Buffer): SessionKeyProvider {
  const currentKeyVersion = deriveSessionKekVersion(currentKek);

  return {
    currentKeyVersion,
    wrapDek(workspaceId, plaintextDek) {
      try {
        return {
          wrappedDek: sealSessionDek({
            key: currentKek,
            plaintext: plaintextDek,
            aad: aadForSessionDek(workspaceId, currentKeyVersion),
          }),
          kekVersion: currentKeyVersion,
        };
      } catch {
        throw new AgentSessionUnavailableError('encryption_failed');
      }
    },
    unwrapDek(workspaceId, wrappedDek, kekVersion) {
      if (kekVersion !== currentKeyVersion) {
        throw new AgentSessionUnavailableError('decryption_failed');
      }
      try {
        return openSessionDek({
          key: currentKek,
          encoded: wrappedDek,
          aad: aadForSessionDek(workspaceId, kekVersion),
        });
      } catch {
        throw new AgentSessionUnavailableError('decryption_failed');
      }
    },
  };
}

export function deriveSessionKekVersion(kek: Buffer): string {
  const hash = crypto.createHash('sha256').update(KEK_VERSION_DOMAIN).update(kek).digest('hex');
  return `local:${hash.slice(0, 16)}`;
}
