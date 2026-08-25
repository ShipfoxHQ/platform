import crypto from 'node:crypto';
import {
  BINARY_ENVELOPE_OVERHEAD_BYTES,
  decodeBase64Key,
  EnvelopeDecryptionError,
  KeyConfigurationError,
  openEnvelopeBinary,
  openEnvelopeText,
  sealEnvelopeBinary,
  sealEnvelopeText,
} from './index.js';

const TEXT_ENVELOPE_PATTERN = /^v1:[A-Za-z0-9+/]+={0,2}$/u;
const BASE64_PADDING_STRIP_PATTERN = /=+$/u;
const BASE64_SINGLE_PADDING_STRIP_PATTERN = /=$/u;

describe('envelope codecs', () => {
  test('round-trips the text envelope and keeps the existing v1 format', () => {
    const key = crypto.randomBytes(32);
    const plaintext = Buffer.from('secret value');
    const encoded = sealEnvelopeText({key, plaintext, aad: 'scope'});

    expect(encoded).toMatch(TEXT_ENVELOPE_PATTERN);
    expect(openEnvelopeText({key, encoded, aad: 'scope'})).toEqual(plaintext);
    expect(() => openEnvelopeText({key, encoded, aad: 'other-scope'})).toThrow(
      EnvelopeDecryptionError,
    );
  });

  test('opens ciphertext written by the pre-unification text codec', () => {
    const encoded = 'v1:YmJiYmJiYmJiYmJi+Ab1nnSL0UyroNb292Y3pNlWlweDiw==';
    expect(
      openEnvelopeText({key: Buffer.from('a'.repeat(32)), encoded, aad: 'scope'}).toString(),
    ).toBe('legacy');
  });

  test('uses a versioned binary envelope and rejects legacy unversioned bytes', () => {
    const key = crypto.randomBytes(32);
    const plaintext = crypto.randomBytes(128);
    const sealed = sealEnvelopeBinary({key, plaintext, aad: 'artifact'});

    expect(sealed.subarray(0, 5).toString('hex')).toBe('5346584501');
    expect(sealed).toHaveLength(BINARY_ENVELOPE_OVERHEAD_BYTES + plaintext.length);
    expect(openEnvelopeBinary({key, sealed, aad: 'artifact'})).toEqual(plaintext);
    expect(() => openEnvelopeBinary({key, sealed: sealed.subarray(5), aad: 'artifact'})).toThrow(
      EnvelopeDecryptionError,
    );

    const unknownVersion = Buffer.from(sealed);
    unknownVersion[4] = 2;
    expect(() => openEnvelopeBinary({key, sealed: unknownVersion, aad: 'artifact'})).toThrow(
      EnvelopeDecryptionError,
    );
  });

  test('rejects tampered and non-canonical text envelopes', () => {
    const key = crypto.randomBytes(32);
    // 'values' (6 bytes) yields a 34-byte payload whose canonical base64 ends
    // with one padding character, so the padding variants below are meaningful.
    const encoded = sealEnvelopeText({key, plaintext: Buffer.from('values'), aad: 'scope'});
    const payload = Buffer.from(encoded.slice(3), 'base64');
    payload[payload.length - 1] = (payload[payload.length - 1] ?? 0) ^ 1;

    expect(() =>
      openEnvelopeText({key, encoded: `v1:${payload.toString('base64')}`, aad: 'scope'}),
    ).toThrow(EnvelopeDecryptionError);
    expect(() => openEnvelopeText({key, encoded: 'v1: YWJj', aad: 'scope'})).toThrow(
      EnvelopeDecryptionError,
    );

    // Trailing padding is part of the canonical encoding: omitting or shortening
    // it decodes to the same payload but must still be rejected.
    expect(() =>
      openEnvelopeText({
        key,
        encoded: encoded.replace(BASE64_PADDING_STRIP_PATTERN, ''),
        aad: 'scope',
      }),
    ).toThrow(EnvelopeDecryptionError);
    expect(() =>
      openEnvelopeText({
        key,
        encoded: encoded.replace(BASE64_SINGLE_PADDING_STRIP_PATTERN, ''),
        aad: 'scope',
      }),
    ).toThrow(EnvelopeDecryptionError);
  });

  test('accepts only canonical base64 32-byte keys', () => {
    const encoded = Buffer.from('a'.repeat(32)).toString('base64');
    expect(decodeBase64Key(encoded, 'TEST_KEK')).toEqual(Buffer.from('a'.repeat(32)));
    expect(() => decodeBase64Key(undefined, 'TEST_KEK')).toThrow(KeyConfigurationError);
    expect(() => decodeBase64Key('c2hvcnQ=', 'TEST_KEK')).toThrow(KeyConfigurationError);
    expect(() => decodeBase64Key(`${encoded}\n`, 'TEST_KEK')).toThrow(KeyConfigurationError);
  });
});
