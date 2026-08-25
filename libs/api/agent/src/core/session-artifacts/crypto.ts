import {
  decodeBase64Key,
  KeyConfigurationError,
  openEnvelopeBinary,
  openEnvelopeText,
  sealEnvelopeBinary,
  sealEnvelopeText,
} from '@shipfox/node-envelope-encryption';
import {AgentSessionUnavailableError} from '../errors.js';

export interface SessionAesGcmSealParams {
  key: Buffer;
  plaintext: Buffer;
  aad: string;
}

export interface SessionAesGcmOpenParams {
  key: Buffer;
  encoded: string;
  aad: string;
}

export function sealSessionDek(params: SessionAesGcmSealParams): string {
  return sealEnvelopeText(params);
}

export function openSessionDek(params: SessionAesGcmOpenParams): Buffer {
  try {
    return openEnvelopeText(params);
  } catch {
    throw new AgentSessionUnavailableError('decryption_failed');
  }
}

export function sealSessionBlob(params: SessionAesGcmSealParams): Buffer {
  return sealEnvelopeBinary(params);
}

export function openSessionBlob(params: {key: Buffer; sealed: Buffer; aad: string}): Buffer {
  try {
    return openEnvelopeBinary(params);
  } catch {
    throw new AgentSessionUnavailableError('decryption_failed');
  }
}

export function aadForSessionDek(workspaceId: string, kekVersion: string): string {
  return JSON.stringify([workspaceId, kekVersion]);
}

export function aadForSessionObject(params: {
  workspaceId: string;
  sessionId: string;
  segment: number;
}): string {
  return JSON.stringify([params.workspaceId, params.sessionId, params.segment]);
}

export function decodeBase64SessionKek(encoded: string | undefined, label: string): Buffer {
  try {
    return decodeBase64Key(encoded, label);
  } catch (error) {
    if (error instanceof KeyConfigurationError) throw new Error(error.message);
    throw error;
  }
}
