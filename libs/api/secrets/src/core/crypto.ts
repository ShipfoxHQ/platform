import {
  decodeBase64Key as decodeEnvelopeKey,
  KeyConfigurationError,
  openEnvelopeText,
  sealEnvelopeText,
} from '@shipfox/node-envelope-encryption';
import {KekConfigurationError, SecretDecryptionError} from './errors.js';

export interface AesGcmSealParams {
  key: Buffer;
  plaintext: Buffer;
  aad: string;
}

export interface AesGcmOpenParams {
  key: Buffer;
  encoded: string;
  aad: string;
}

export interface SecretScope {
  projectId?: string | null | undefined;
}

export interface SecretValueAadParams {
  workspaceId: string;
  scope?: SecretScope | undefined;
  namespace: string;
  key: string;
}

export function aesGcmSeal(params: AesGcmSealParams): string {
  return sealEnvelopeText(params);
}

export function aesGcmOpen(params: AesGcmOpenParams): Buffer {
  try {
    return openEnvelopeText(params);
  } catch {
    throw new SecretDecryptionError();
  }
}

export function decodeBase64Key(encoded: string | undefined, label: string): Buffer {
  try {
    return decodeEnvelopeKey(encoded, label);
  } catch (error) {
    if (error instanceof KeyConfigurationError) throw new KekConfigurationError(error.message);
    throw error;
  }
}

export function aadForDek(workspaceId: string, kekVersion: string): string {
  return JSON.stringify([workspaceId, kekVersion]);
}

export function aadForValue(params: SecretValueAadParams): string {
  const projectId = params.scope?.projectId ?? null;
  const scopeTuple = projectId !== null ? ['project', projectId] : ['workspace'];
  return JSON.stringify([params.workspaceId, scopeTuple, params.namespace, params.key]);
}
