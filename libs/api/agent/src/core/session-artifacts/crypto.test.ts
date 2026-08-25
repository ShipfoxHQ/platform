import crypto from 'node:crypto';
import {BINARY_ENVELOPE_OVERHEAD_BYTES} from '@shipfox/node-envelope-encryption';
import {AgentSessionUnavailableError} from '#core/errors.js';
import {
  aadForSessionDek,
  aadForSessionObject,
  decodeBase64SessionKek,
  openSessionBlob,
  openSessionDek,
  sealSessionBlob,
  sealSessionDek,
} from '#core/session-artifacts/crypto.js';
import {
  createSessionKeyProvider,
  deriveSessionKekVersion,
} from '#core/session-artifacts/key-provider.js';

const V1_ENCODED_PATTERN = /^v1:[A-Za-z0-9+/]+={0,2}$/u;
const LOCAL_KEK_VERSION_PATTERN = /^local:[0-9a-f]{16}$/u;
const KEK_REQUIRED_PATTERN = /TEST_KEK is required/u;
const KEK_CANONICAL_PATTERN = /TEST_KEK must be a canonical base64-encoded 32-byte key/u;
const KEK_CANONICAL_SHORT_PATTERN = /canonical/u;

function newKek(): Buffer {
  return crypto.randomBytes(32);
}

describe('session artifact envelope crypto', () => {
  it('round-trips a wrapped DEK under the secrets-store v1: base64 format', () => {
    const kek = newKek();
    const provider = createSessionKeyProvider(kek);
    const dek = crypto.randomBytes(32);

    const wrapped = provider.wrapDek('workspace-1', dek);
    expect(wrapped.kekVersion).toBe(provider.currentKeyVersion);
    expect(wrapped.wrappedDek).toMatch(V1_ENCODED_PATTERN);

    const unwrapped = provider.unwrapDek('workspace-1', wrapped.wrappedDek, wrapped.kekVersion);
    expect(unwrapped).toEqual(dek);
  });

  it('binds a wrapped DEK to its workspace and KEK version', () => {
    const kek = newKek();
    const provider = createSessionKeyProvider(kek);
    const dek = crypto.randomBytes(32);
    const wrapped = provider.wrapDek('workspace-1', dek);

    expect(() => provider.unwrapDek('workspace-2', wrapped.wrappedDek, wrapped.kekVersion)).toThrow(
      AgentSessionUnavailableError,
    );
    expect(() =>
      provider.unwrapDek('workspace-1', wrapped.wrappedDek, 'local:0000000000000000'),
    ).toThrow(AgentSessionUnavailableError);
  });

  it('unwraps DEKs wrapped under the previous KEK during rotation', () => {
    const previousKek = newKek();
    const currentKek = newKek();
    const previousProvider = createSessionKeyProvider(previousKek);
    const dek = crypto.randomBytes(32);
    const wrapped = previousProvider.wrapDek('workspace-1', dek);

    expect(createSessionKeyProvider(previousKek).currentKeyVersion).toBe(wrapped.kekVersion);

    const rotated = createSessionKeyProvider(currentKek, previousKek);
    expect(rotated.previousKeyVersion).toBe(previousProvider.currentKeyVersion);
    expect(rotated.unwrapDek('workspace-1', wrapped.wrappedDek, wrapped.kekVersion)).toEqual(dek);

    // Without the previous KEK configured, the same DEK is unreadable again.
    expect(() =>
      createSessionKeyProvider(currentKek).unwrapDek(
        'workspace-1',
        wrapped.wrappedDek,
        wrapped.kekVersion,
      ),
    ).toThrow(AgentSessionUnavailableError);
  });

  it('derives a stable local KEK version per key', () => {
    const kek = newKek();
    const version = deriveSessionKekVersion(kek);
    expect(version).toMatch(LOCAL_KEK_VERSION_PATTERN);
    expect(deriveSessionKekVersion(kek)).toBe(version);
    expect(deriveSessionKekVersion(newKek())).not.toBe(version);
  });

  it('rejects a tampered wrapped DEK', () => {
    const kek = newKek();
    const provider = createSessionKeyProvider(kek);
    const wrapped = provider.wrapDek('workspace-1', crypto.randomBytes(32));

    const tampered = `v1:${Buffer.from('AAAA'.repeat(10)).toString('base64')}`;
    expect(() => provider.unwrapDek('workspace-1', tampered, wrapped.kekVersion)).toThrow(
      AgentSessionUnavailableError,
    );
  });

  it('round-trips a sealed blob in the versioned binary format', () => {
    const dek = crypto.randomBytes(32);
    const aad = aadForSessionObject({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      segment: 3,
    });
    const plaintext = crypto.randomBytes(1024);

    const sealed = sealSessionBlob({key: dek, plaintext, aad});
    expect(sealed.length).toBe(BINARY_ENVELOPE_OVERHEAD_BYTES + plaintext.length);

    expect(openSessionBlob({key: dek, sealed, aad})).toEqual(plaintext);
  });

  it('fails to open a blob under a different AAD or a tampered seal', () => {
    const dek = crypto.randomBytes(32);
    const aad = aadForSessionObject({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      segment: 3,
    });
    const sealed = sealSessionBlob({key: dek, plaintext: Buffer.from('secret transcript'), aad});

    const otherAad = aadForSessionObject({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      segment: 4,
    });
    expect(() => openSessionBlob({key: dek, sealed, aad: otherAad})).toThrow(
      AgentSessionUnavailableError,
    );

    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0x01;
    expect(() => openSessionBlob({key: dek, sealed: tampered, aad})).toThrow(
      AgentSessionUnavailableError,
    );
    expect(() => openSessionBlob({key: dek, sealed: Buffer.alloc(10), aad})).toThrow(
      AgentSessionUnavailableError,
    );
  });

  it('sealSessionDek/openSessionDek round-trip with the encoded format', () => {
    const kek = newKek();
    const version = deriveSessionKekVersion(kek);
    const aad = aadForSessionDek('workspace-1', version);
    const dek = crypto.randomBytes(32);

    const encoded = sealSessionDek({key: kek, plaintext: dek, aad});
    expect(openSessionDek({key: kek, encoded, aad})).toEqual(dek);
    expect(() => openSessionDek({key: kek, encoded: 'v9:AAAA', aad})).toThrow(
      AgentSessionUnavailableError,
    );
    expect(() =>
      openSessionDek({key: kek, encoded: Buffer.alloc(0).toString('base64'), aad}),
    ).toThrow(AgentSessionUnavailableError);
  });

  it('decodes a canonical base64 32-byte KEK and rejects anything else', () => {
    const key = Buffer.from('a'.repeat(32)).toString('base64');
    expect(decodeBase64SessionKek(key, 'TEST_KEK')).toEqual(Buffer.from('a'.repeat(32)));

    expect(() => decodeBase64SessionKek(undefined, 'TEST_KEK')).toThrow(KEK_REQUIRED_PATTERN);
    expect(() => decodeBase64SessionKek('c2hvcnQ=', 'TEST_KEK')).toThrow(KEK_CANONICAL_PATTERN);
    expect(() => decodeBase64SessionKek(' YWJj', 'TEST_KEK')).toThrow(KEK_CANONICAL_SHORT_PATTERN);
  });
});
