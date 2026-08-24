import crypto from 'node:crypto';
import {AgentSessionUnavailableError} from '../errors.js';

const CIPHER = 'aes-256-gcm';
const ENCODED_PREFIX = 'v1:';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;
const BASE64_KEY_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/u;
const BASE64_PADDING_SUFFIX = /=+$/u;

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

/**
 * Session-artifact envelope crypto, reusing the secrets-store scheme
 * (`libs/api/secrets/src/core/crypto.ts`): AES-256-GCM with a 12-byte IV and a
 * 16-byte auth tag, AAD bound to the artifact identity. The DEK-wrap variant
 * returns the same `v1:` base64 text format the secrets store persists, so a
 * wrapped session DEK is interchangeable with a secrets DEK in form; the blob
 * variant is raw binary because artifact objects live in S3, not a text column.
 */
export function sealSessionDek(params: SessionAesGcmSealParams): string {
  return aesGcmSealEncoded(params);
}

export function openSessionDek(params: SessionAesGcmOpenParams): Buffer {
  return aesGcmOpenEncoded(params);
}

export function sealSessionBlob(params: SessionAesGcmSealParams): Buffer {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(CIPHER, params.key, iv);
  cipher.setAAD(Buffer.from(params.aad, 'utf8'));

  const ciphertext = Buffer.concat([cipher.update(params.plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, ciphertext]);
}

export function openSessionBlob(params: {key: Buffer; sealed: Buffer; aad: string}): Buffer {
  if (params.sealed.length < IV_BYTES + AUTH_TAG_BYTES) {
    throw new AgentSessionUnavailableError('decryption_failed');
  }

  try {
    const iv = params.sealed.subarray(0, IV_BYTES);
    const authTag = params.sealed.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
    const ciphertext = params.sealed.subarray(IV_BYTES + AUTH_TAG_BYTES);
    const decipher = crypto.createDecipheriv(CIPHER, params.key, iv);
    decipher.setAAD(Buffer.from(params.aad, 'utf8'));
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new AgentSessionUnavailableError('decryption_failed');
  }
}

function aesGcmSealEncoded(params: SessionAesGcmSealParams): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(CIPHER, params.key, iv);
  cipher.setAAD(Buffer.from(params.aad, 'utf8'));

  const ciphertext = Buffer.concat([cipher.update(params.plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENCODED_PREFIX}${Buffer.concat([iv, authTag, ciphertext]).toString('base64')}`;
}

function aesGcmOpenEncoded(params: SessionAesGcmOpenParams): Buffer {
  if (!params.encoded.startsWith(ENCODED_PREFIX)) {
    throw new AgentSessionUnavailableError('decryption_failed');
  }

  const encodedPayload = params.encoded.slice(ENCODED_PREFIX.length);
  const payload = Buffer.from(encodedPayload, 'base64');
  const canonical = payload.toString('base64');
  if (
    !BASE64_KEY_PATTERN.test(encodedPayload) ||
    canonical.replace(BASE64_PADDING_SUFFIX, '') !==
      encodedPayload.replace(BASE64_PADDING_SUFFIX, '')
  ) {
    throw new AgentSessionUnavailableError('decryption_failed');
  }
  if (payload.length < IV_BYTES + AUTH_TAG_BYTES) {
    throw new AgentSessionUnavailableError('decryption_failed');
  }

  try {
    const iv = payload.subarray(0, IV_BYTES);
    const authTag = payload.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
    const ciphertext = payload.subarray(IV_BYTES + AUTH_TAG_BYTES);
    const decipher = crypto.createDecipheriv(CIPHER, params.key, iv);
    decipher.setAAD(Buffer.from(params.aad, 'utf8'));
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new AgentSessionUnavailableError('decryption_failed');
  }
}

/**
 * AAD for a wrapped session DEK: the workspace id plus the KEK version, exactly
 * as the secrets store binds its own DEK rows.
 */
export function aadForSessionDek(workspaceId: string, kekVersion: string): string {
  return JSON.stringify([workspaceId, kekVersion]);
}

/**
 * AAD for a transcript object: the workspace id, session id, and segment, so a
 * sealed blob can never be replayed under another session's or segment's key.
 */
export function aadForSessionObject(params: {
  workspaceId: string;
  sessionId: string;
  segment: number;
}): string {
  return JSON.stringify([params.workspaceId, params.sessionId, params.segment]);
}

/**
 * Decodes a base64 32-byte KEK from configuration, with the same canonical-form
 * validation as the secrets store's `decodeBase64Key`.
 */
export function decodeBase64SessionKek(encoded: string | undefined, label: string): Buffer {
  if (!encoded) {
    throw new Error(
      `${label} is required and must be a base64-encoded 32-byte key. Generate one with openssl rand -base64 32.`,
    );
  }

  const key = Buffer.from(encoded, 'base64');
  if (key.length !== KEY_BYTES || !isCanonicalBase64Key(encoded, key)) {
    throw new Error(
      `${label} must be a canonical base64-encoded 32-byte key. Strip whitespace and generate a new value with openssl rand -base64 32 if needed.`,
    );
  }

  return key;
}

function isCanonicalBase64Key(encoded: string, key: Buffer): boolean {
  return BASE64_KEY_PATTERN.test(encoded) && key.toString('base64') === encoded;
}
