import {withInstallationTokenLock} from './installation-token-lock.js';

describe('withInstallationTokenLock', () => {
  it('allows one holder per installation and fails contenders fast', async () => {
    const first = holdInstallationTokenLock(9001, 'winner');

    await first.ready;
    const contender = await withInstallationTokenLock(9001, async () => 'contender');
    const differentProfile = await withInstallationTokenLock(
      9001,
      'narrow',
      async () => 'different-profile',
    );
    const different = await withInstallationTokenLock(9002, async () => 'different');
    first.release();
    const winner = await first.result;

    expect(contender).toEqual({acquired: false});
    expect(differentProfile).toEqual({acquired: true, value: 'different-profile'});
    expect(different).toEqual({acquired: true, value: 'different'});
    expect(winner).toEqual({acquired: true, value: 'winner'});
  });

  it('does not collide installations that differ outside the 32-bit range', async () => {
    const holder = holdInstallationTokenLock(1, 'holder');

    await holder.ready;
    const different = await withInstallationTokenLock(1 + 2 ** 32, async () => 'different');
    holder.release();
    const held = await holder.result;

    expect(different).toEqual({acquired: true, value: 'different'});
    expect(held).toEqual({acquired: true, value: 'holder'});
  });

  it('does not exhaust a small pool when many contenders miss the try-lock', async () => {
    const holder = holdInstallationTokenLock(9010, 'holder');

    await holder.ready;
    const contenders = await Promise.all(
      Array.from({length: 20}, () => withInstallationTokenLock(9010, async () => 'contender')),
    );
    holder.release();
    const held = await holder.result;

    expect(contenders).toEqual(Array.from({length: 20}, () => ({acquired: false})));
    expect(held).toEqual({acquired: true, value: 'holder'});
  });
});

function holdInstallationTokenLock(installationId: number, value: string) {
  let releaseLock: (() => void) | undefined;
  let markReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  const result = withInstallationTokenLock(
    installationId,
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
