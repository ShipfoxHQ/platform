import crypto from 'node:crypto';
import {EnvelopeDecryptionError, KeyConfigurationError} from './errors.js';

const CIPHER = 'aes-256-gcm';
const TEXT_ENVELOPE_PREFIX = 'v1:';
const BINARY_ENVELOPE_PREFIX = Buffer.from([0x53, 0x46, 0x58, 0x45, 0x01]);
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/u;

export const BINARY_ENVELOPE_OVERHEAD_BYTES =
  BINARY_ENVELOPE_PREFIX.length + IV_BYTES + AUTH_TAG_BYTES;

export interface EnvelopeSealParams {
  key: Buffer;
  plaintext: Buffer;
  aad: string;
}

export interface TextEnvelopeOpenParams {
  key: Buffer;
  encoded: string;
  aad: string;
}

export interface BinaryEnvelopeOpenParams {
  key: Buffer;
  sealed: Buffer;
  aad: string;
}

export function sealEnvelopeText(params: EnvelopeSealParams): string {
  return `${TEXT_ENVELOPE_PREFIX}${sealPayload(params).toString('base64')}`;
}

export function openEnvelopeText(params: TextEnvelopeOpenParams): Buffer {
  if (!params.encoded.startsWith(TEXT_ENVELOPE_PREFIX)) throw new EnvelopeDecryptionError();

  const encodedPayload = params.encoded.slice(TEXT_ENVELOPE_PREFIX.length);
  const payload = Buffer.from(encodedPayload, 'base64');
  const canonical = payload.toString('base64');
  // The payload must use the exact canonical base64 encoding (including padding)
  // emitted by `sealEnvelopeText`; omitting or shortening trailing padding must
  // not decode to an accepted envelope.
  if (!BASE64_PATTERN.test(encodedPayload) || canonical !== encodedPayload) {
    throw new EnvelopeDecryptionError();
  }

  return openPayload({key: params.key, payload, aad: params.aad});
}

export function sealEnvelopeBinary(params: EnvelopeSealParams): Buffer {
  return Buffer.concat([BINARY_ENVELOPE_PREFIX, sealPayload(params)]);
}

export function openEnvelopeBinary(params: BinaryEnvelopeOpenParams): Buffer {
  if (
    params.sealed.length < BINARY_ENVELOPE_OVERHEAD_BYTES ||
    !params.sealed.subarray(0, BINARY_ENVELOPE_PREFIX.length).equals(BINARY_ENVELOPE_PREFIX)
  ) {
    throw new EnvelopeDecryptionError();
  }

  return openPayload({
    key: params.key,
    payload: params.sealed.subarray(BINARY_ENVELOPE_PREFIX.length),
    aad: params.aad,
  });
}

export function decodeBase64Key(encoded: string | undefined, label: string): Buffer {
  if (!encoded) {
    throw new KeyConfigurationError(
      `${label} is required and must be a base64-encoded 32-byte key. Generate one with openssl rand -base64 32.`,
    );
  }

  const key = Buffer.from(encoded, 'base64');
  if (
    key.length !== KEY_BYTES ||
    !BASE64_PATTERN.test(encoded) ||
    key.toString('base64') !== encoded
  ) {
    throw new KeyConfigurationError(
      `${label} must be a canonical base64-encoded 32-byte key. Strip whitespace and generate a new value with openssl rand -base64 32 if needed.`,
    );
  }

  return key;
}

function sealPayload(params: EnvelopeSealParams): Buffer {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(CIPHER, params.key, iv);
  cipher.setAAD(Buffer.from(params.aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(params.plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

function openPayload(params: {key: Buffer; payload: Buffer; aad: string}): Buffer {
  if (params.payload.length < IV_BYTES + AUTH_TAG_BYTES) throw new EnvelopeDecryptionError();

  try {
    const iv = params.payload.subarray(0, IV_BYTES);
    const authTag = params.payload.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
    const ciphertext = params.payload.subarray(IV_BYTES + AUTH_TAG_BYTES);
    const decipher = crypto.createDecipheriv(CIPHER, params.key, iv);
    decipher.setAAD(Buffer.from(params.aad, 'utf8'));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new EnvelopeDecryptionError();
  }
}
