import crypto from 'node:crypto';
import {afterEach, describe, expect, it, vi} from '@shipfox/vitest/vi';
import {decodeBase64SessionKek} from './crypto.js';
import {createSessionKeyProvider} from './key-provider.js';

describe('session artifact composition', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('wires the configured previous KEK so DEKs wrapped before a rotation stay readable', async () => {
    const previousKek = crypto.randomBytes(32).toString('base64');
    const currentKek = crypto.randomBytes(32).toString('base64');

    // A DEK wrapped under the previous KEK, as if persisted before the rotation.
    const previousProvider = createSessionKeyProvider(decodeBase64SessionKek(previousKek, 'TEST'));
    const dek = crypto.randomBytes(32);
    const wrapped = previousProvider.wrapDek('workspace-1', dek);

    vi.resetModules();
    vi.stubEnv('AGENT_SESSION_ENCRYPTION_KEK', currentKek);
    vi.stubEnv('AGENT_SESSION_ENCRYPTION_KEK_PREVIOUS', previousKek);

    const {sessionKeyProvider} = await import('./composition.js');
    const provider = sessionKeyProvider();

    expect(provider.previousKeyVersion).toBe(previousProvider.currentKeyVersion);
    expect(provider.unwrapDek('workspace-1', wrapped.wrappedDek, wrapped.kekVersion)).toEqual(dek);
  });

  it('exposes only the current KEK when no previous key is configured', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_SESSION_ENCRYPTION_KEK', crypto.randomBytes(32).toString('base64'));

    const {sessionKeyProvider} = await import('./composition.js');

    expect(sessionKeyProvider().previousKeyVersion).toBeNull();
  });
});
