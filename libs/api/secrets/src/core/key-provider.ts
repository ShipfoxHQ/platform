import {
  createLocalKeyProvider as createEnvelopeKeyProvider,
  DataKeyUnwrapError,
  DataKeyWrapError,
  deriveLocalKeyVersion,
} from '@shipfox/node-envelope-encryption';
import {DekUnwrapError, DekWrapError} from './errors.js';

const KEK_VERSION_DOMAIN = 'shipfox-secrets-kek-version';

export interface WrappedDek {
  wrappedDek: string;
  kekVersion: string;
}

export interface KeyProvider {
  readonly currentKeyVersion: string;
  readonly previousKeyVersion: string | null;
  wrapDek(workspaceId: string, plaintextDek: Buffer): WrappedDek;
  unwrapDek(workspaceId: string, wrappedDek: string, kekVersion: string): Buffer;
}

export interface LocalKeyProviderParams {
  currentKek: Buffer;
  previousKek?: Buffer | undefined;
}

export function createLocalKeyProvider(params: LocalKeyProviderParams): KeyProvider {
  const provider = createEnvelopeKeyProvider({...params, keyVersionDomain: KEK_VERSION_DOMAIN});
  return {
    currentKeyVersion: provider.currentKeyVersion,
    previousKeyVersion: provider.previousKeyVersion,
    wrapDek(workspaceId, plaintextDek) {
      try {
        return provider.wrapDek(workspaceId, plaintextDek);
      } catch (error) {
        if (error instanceof DataKeyWrapError) throw new DekWrapError();
        throw error;
      }
    },
    unwrapDek(workspaceId, wrappedDek, kekVersion) {
      try {
        return provider.unwrapDek(workspaceId, wrappedDek, kekVersion);
      } catch (error) {
        if (error instanceof DataKeyUnwrapError) throw new DekUnwrapError();
        throw error;
      }
    },
  };
}

export function deriveLocalKekVersion(kek: Buffer): string {
  return deriveLocalKeyVersion(kek, KEK_VERSION_DOMAIN);
}
