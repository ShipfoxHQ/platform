import {withGithubCheckoutTokenLock} from './checkout-token-lock.js';

describe('withGithubCheckoutTokenLock', () => {
  it('allows one holder per exact scope digest and does not block another scope', async () => {
    const first = holdLock('a'.repeat(64), 'winner');

    await first.ready;
    const contender = await withGithubCheckoutTokenLock('a'.repeat(64), async () => 'contender');
    const different = await withGithubCheckoutTokenLock('b'.repeat(64), async () => 'different');
    first.release();
    const winner = await first.result;

    expect(contender).toEqual({acquired: false});
    expect(different).toEqual({acquired: true, value: 'different'});
    expect(winner).toEqual({acquired: true, value: 'winner'});
  });

  it('rejects a non-versioned digest', () => {
    expect(() => withGithubCheckoutTokenLock('not-a-digest', async () => 'value')).toThrow(
      'scope digest',
    );
  });
});

function holdLock(digest: string, value: string) {
  let releaseLock: (() => void) | undefined;
  let markReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  const result = withGithubCheckoutTokenLock(
    digest,
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
