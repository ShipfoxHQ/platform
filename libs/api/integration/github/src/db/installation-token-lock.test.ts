import {withInstallationTokenLock} from './installation-token-lock.js';

describe('withInstallationTokenLock', () => {
  it('allows one holder per installation and fails contenders fast', async () => {
    const first = holdInstallationTokenLock(9001, 'winner');

    await first.ready;
    const contender = await withInstallationTokenLock(9001, undefined, async () => 'contender');
    const different = await withInstallationTokenLock(9002, undefined, async () => 'different');
    first.release();
    const winner = await first.result;

    expect(contender).toEqual({acquired: false});
    expect(different).toEqual({acquired: true, value: 'different'});
    expect(winner).toEqual({acquired: true, value: 'winner'});
  });

  it('does not collide installations that differ outside the 32-bit range', async () => {
    const holder = holdInstallationTokenLock(1, 'holder');

    await holder.ready;
    const different = await withInstallationTokenLock(
      1 + 2 ** 32,
      undefined,
      async () => 'different',
    );
    holder.release();
    const held = await holder.result;

    expect(different).toEqual({acquired: true, value: 'different'});
    expect(held).toEqual({acquired: true, value: 'holder'});
  });

  it('does not exhaust a small pool when many contenders miss the try-lock', async () => {
    const holder = holdInstallationTokenLock(9010, 'holder');

    await holder.ready;
    const contenders = await Promise.all(
      Array.from({length: 20}, () =>
        withInstallationTokenLock(9010, undefined, async () => 'contender'),
      ),
    );
    holder.release();
    const held = await holder.result;

    expect(contenders).toEqual(Array.from({length: 20}, () => ({acquired: false})));
    expect(held).toEqual({acquired: true, value: 'holder'});
  });

  it('does not contend scoped and unscoped mints for the same installation', async () => {
    const holder = holdInstallationTokenLock(9003, 'holder');

    await holder.ready;
    const scoped = await withInstallationTokenLock(
      9003,
      '456/contents-write',
      async () => 'scoped',
    );
    holder.release();
    const held = await holder.result;

    expect(scoped).toEqual({acquired: true, value: 'scoped'});
    expect(held).toEqual({acquired: true, value: 'holder'});
  });

  it('never collides a scoped key with an unscoped key of another installation', async () => {
    const scopeKey = '456/contents-write';
    // The legacy scheme folded a 32-bit hash of the scope into the installation
    // base, so installation (1 + hash) shared the scoped key of installation 1.
    // Scoped keys live below every unscoped key, so both locks must acquire.
    let legacyHash = 0;
    for (let index = 0; index < scopeKey.length; index += 1) {
      legacyHash = (legacyHash * 31 + scopeKey.charCodeAt(index)) >>> 0;
    }
    const holder = holdInstallationTokenLock(1, 'holder', scopeKey);

    await holder.ready;
    const different = await withInstallationTokenLock(
      1 + legacyHash,
      undefined,
      async () => 'different',
    );
    holder.release();
    const held = await holder.result;

    expect(different).toEqual({acquired: true, value: 'different'});
    expect(held).toEqual({acquired: true, value: 'holder'});
  });

  it('serializes same-scope contenders for one installation', async () => {
    const holder = holdInstallationTokenLock(9004, 'holder', '456/contents-write');

    await holder.ready;
    const contender = await withInstallationTokenLock(
      9004,
      '456/contents-write',
      async () => 'contender',
    );
    holder.release();
    const held = await holder.result;

    expect(contender).toEqual({acquired: false});
    expect(held).toEqual({acquired: true, value: 'holder'});
  });
});

function holdInstallationTokenLock(installationId: number, value: string, scopeKey?: string) {
  let releaseLock: (() => void) | undefined;
  let markReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  const result = withInstallationTokenLock(
    installationId,
    scopeKey,
    () =>
      new Promise<string>((resolve) => {
        releaseLock = () => resolve(value);
        markReady();
      }),
  );

  return {
    ready,
    release: () => {
      if (!releaseLock) throw new Error('releaseLock was not initialized');
      releaseLock();
    },
    result,
  };
}
