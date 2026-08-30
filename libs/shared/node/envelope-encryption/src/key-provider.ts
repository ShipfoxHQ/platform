import crypto from 'node:crypto';
import {openEnvelopeText, sealEnvelopeText} from './crypto.js';
import {DataKeyUnwrapError, DataKeyWrapError, KeyConfigurationError} from './errors.js';

const KEK_BYTES = 32;

export interface WrappedDataKey {
  wrappedDek: string;
  kekVersion: string;
}

export interface EnvelopeKeyProvider {
  readonly currentKeyVersion: string;
  readonly previousKeyVersion: string | null;
  wrapDek(keyId: string, plaintextDek: Buffer): WrappedDataKey;
  unwrapDek(keyId: string, wrappedDek: string, kekVersion: string): Buffer;
}

export interface LocalKeyProviderParams {
  currentKek: Buffer;
  previousKek?: Buffer | undefined;
  keyVersionDomain: string;
}

export function createLocalKeyProvider(params: LocalKeyProviderParams): EnvelopeKeyProvider {
  const currentKek = Buffer.from(params.currentKek);
  const previousKek = params.previousKek ? Buffer.from(params.previousKek) : undefined;
  const currentKeyVersion = deriveLocalKeyVersion(currentKek, params.keyVersionDomain);
  const previousKeyVersion = previousKek
    ? deriveLocalKeyVersion(previousKek, params.keyVersionDomain)
    : null;

  return {
    currentKeyVersion,
    previousKeyVersion,
    wrapDek(keyId, plaintextDek) {
      try {
        return {
          wrappedDek: sealEnvelopeText({
            key: currentKek,
            plaintext: plaintextDek,
            aad: dataKeyAad(keyId, currentKeyVersion),
          }),
          kekVersion: currentKeyVersion,
        };
      } catch {
        throw new DataKeyWrapError();
      }
    },
    unwrapDek(keyId, wrappedDek, kekVersion) {
      let key: Buffer | undefined;
      if (kekVersion === currentKeyVersion) key = currentKek;
      else if (kekVersion === previousKeyVersion) key = previousKek;
      if (!key) throw new DataKeyUnwrapError();

      try {
        return openEnvelopeText({
          key,
          encoded: wrappedDek,
          aad: dataKeyAad(keyId, kekVersion),
        });
      } catch {
        throw new DataKeyUnwrapError();
      }
    },
  };
}

export function deriveLocalKeyVersion(kek: Buffer, keyVersionDomain: string): string {
  if (kek.length !== KEK_BYTES) {
    throw new KeyConfigurationError('A local KEK must contain exactly 32 bytes.');
  }
  if (keyVersionDomain.length === 0) {
    throw new KeyConfigurationError('A local KEK version domain is required.');
  }
  const hash = crypto.createHash('sha256').update(keyVersionDomain).update(kek).digest('hex');
  return `local:${hash.slice(0, 16)}`;
}

function dataKeyAad(keyId: string, kekVersion: string): string {
  return JSON.stringify([keyId, kekVersion]);
}
