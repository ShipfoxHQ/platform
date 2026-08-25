import crypto from 'node:crypto';
import {
  createLocalKeyProvider,
  DataKeyUnwrapError,
  deriveLocalKeyVersion,
  KeyConfigurationError,
} from './index.js';

describe('local envelope key provider', () => {
  test('wraps with the current key and unwraps with the previous key', () => {
    const previousKek = crypto.randomBytes(32);
    const currentKek = crypto.randomBytes(32);
    const previousProvider = createLocalKeyProvider({
      currentKek: previousKek,
      keyVersionDomain: 'test-domain',
    });
    const dek = crypto.randomBytes(32);
    const wrapped = previousProvider.wrapDek('workspace-1', dek);

    const provider = createLocalKeyProvider({
      currentKek,
      previousKek,
      keyVersionDomain: 'test-domain',
    });
    expect(provider.previousKeyVersion).toBe(previousProvider.currentKeyVersion);
    expect(provider.unwrapDek('workspace-1', wrapped.wrappedDek, wrapped.kekVersion)).toEqual(dek);
    expect(() => provider.unwrapDek('workspace-2', wrapped.wrappedDek, wrapped.kekVersion)).toThrow(
      DataKeyUnwrapError,
    );
  });

  test('derives stable, domain-separated key versions', () => {
    const key = crypto.randomBytes(32);
    expect(deriveLocalKeyVersion(key, 'domain-a')).toBe(deriveLocalKeyVersion(key, 'domain-a'));
    expect(deriveLocalKeyVersion(key, 'domain-a')).not.toBe(deriveLocalKeyVersion(key, 'domain-b'));
  });

  test('rejects invalid local key-provider inputs before first use', () => {
    expect(() =>
      createLocalKeyProvider({currentKek: Buffer.alloc(31), keyVersionDomain: 'test-domain'}),
    ).toThrow(KeyConfigurationError);
    expect(() =>
      createLocalKeyProvider({currentKek: crypto.randomBytes(32), keyVersionDomain: ''}),
    ).toThrow(KeyConfigurationError);
  });
});
