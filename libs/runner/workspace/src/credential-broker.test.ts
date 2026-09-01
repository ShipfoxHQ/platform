import {
  CredentialBroker,
  MAX_CREDENTIAL_FAILURE_EVENTS,
  normalizeRepositoryUrl,
  TransientCredentialRenewalError,
} from '#credential-broker.js';

const repository = 'https://Gitea.example:443/Org/Repo.git/';
const baseCredential = {
  username: 'runner',
  token: 'token-a',
  expiresAt: 10_000,
  renewal: {mode: 'refresh-at' as const, refreshAt: 5_000},
  generation: 'generation-a',
};

describe('repository URL normalization', () => {
  it('normalizes host, default port, slash, and git suffix without changing path case', () => {
    expect(normalizeRepositoryUrl(repository)).toBe('https://gitea.example/Org/Repo/');
  });

  it.each([
    'http://example.test/org/repo',
    'https://user@example.test/org/repo',
    'https://example.test/org/repo?token=secret',
  ])('rejects unsafe or incomplete URLs: %s', (url) => {
    expect(() => normalizeRepositoryUrl(url)).toThrow();
  });

  it('rejects a refresh deadline at or after expiry', () => {
    const renew = vi.fn();
    const broker = new CredentialBroker({renew});
    expect(() =>
      broker.register({
        repositoryUrl: repository,
        subject: 'checkout',
        credential: {...baseCredential, renewal: {mode: 'refresh-at', refreshAt: 10_000}},
      }),
    ).toThrow();
  });
});

describe('credential broker', () => {
  let now: number;

  beforeEach(() => {
    now = 1_000;
  });

  it('fails closed for malformed lookup URLs without invoking renewal', async () => {
    const renew = vi.fn();
    const broker = new CredentialBroker({renew, now: () => now});
    broker.register({repositoryUrl: repository, subject: 'checkout', credential: baseCredential});

    await expect(broker.lookup('https://example.test/repo?token=secret')).resolves.toBeUndefined();
    await expect(
      broker.lookup(`https://example.test/${'x'.repeat(2_048)}`),
    ).resolves.toBeUndefined();
    expect(renew).not.toHaveBeenCalled();
  });

  it('does not renew before refresh-at, and replaces the generation at the boundary', async () => {
    const renew = vi.fn(async () => ({
      ...baseCredential,
      token: 'token-b',
      generation: 'generation-b',
      expiresAt: 20_000,
      renewal: {mode: 'refresh-at' as const, refreshAt: 15_000},
    }));
    const broker = new CredentialBroker({renew, now: () => now});
    broker.register({
      repositoryUrl: repository,
      subject: 'step-1/attempt-1',
      credential: baseCredential,
    });

    await expect(broker.lookup('https://gitea.example/Org/Repo')).resolves.toEqual({
      username: 'runner',
      token: 'token-a',
    });
    expect(renew).not.toHaveBeenCalled();

    now = 5_000;
    await expect(broker.lookup(repository)).resolves.toEqual({
      username: 'runner',
      token: 'token-b',
    });
    expect(renew).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent renewal and keeps repositories independent', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    const renew = vi.fn(async ({repositoryUrl}: {repositoryUrl: string}) => {
      await pending;
      return {
        ...baseCredential,
        token: repositoryUrl.includes('one') ? 'one-b' : 'two-b',
        generation: 'fresh',
      };
    });
    const broker = new CredentialBroker({renew, now: () => 5_000});
    broker.register({
      repositoryUrl: 'https://example.test/one',
      subject: 'same',
      credential: baseCredential,
    });
    broker.register({
      repositoryUrl: 'https://example.test/two',
      subject: 'same',
      credential: baseCredential,
    });

    const first = broker.lookup('https://example.test/one');
    const second = broker.lookup('https://example.test/one');
    const other = broker.lookup('https://example.test/two');
    await Promise.resolve();
    expect(renew).toHaveBeenCalledTimes(2);
    release();
    await expect(Promise.all([first, second, other])).resolves.toEqual([
      {username: 'runner', token: 'one-b'},
      {username: 'runner', token: 'one-b'},
      {username: 'runner', token: 'two-b'},
    ]);
  });

  it('attaches a capture to a renewal flight that started before the step', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => (resolveStarted = resolve));
    const renew = vi.fn(async () => {
      resolveStarted();
      await pending;
      throw new Error('renewal failed');
    });
    const broker = new CredentialBroker({renew, now: () => now});
    broker.register({
      repositoryUrl: repository,
      subject: 'checkout-step:2',
      credential: {...baseCredential, renewal: {mode: 'on-rejection' as const}},
    });

    const firstRejection = broker.reject(repository);
    await started;
    const capturedRejection = broker.captureFailureEvents(() => broker.reject(repository));
    release();

    await expect(firstRejection).resolves.toEqual({rejectedGeneration: 'generation-a'});
    await expect(capturedRejection).resolves.toMatchObject({
      events: [
        {
          cursor: 1,
          repositoryUrl: 'https://gitea.example/Org/Repo/',
          subject: 'checkout-step:2',
          kind: 'failed',
        },
      ],
    });
  });

  it('accepts an unchanged opaque credential when its generation is fresh', async () => {
    const renew = vi.fn().mockResolvedValue({
      ...baseCredential,
      generation: 'generation-b',
    });
    const broker = new CredentialBroker({renew, now: () => now});
    broker.register({
      repositoryUrl: repository,
      subject: 'checkout',
      credential: {...baseCredential, renewal: {mode: 'on-rejection' as const}},
    });

    await expect(broker.reject(repository)).resolves.toEqual({rejectedGeneration: 'generation-a'});
    await expect(broker.lookup(repository)).resolves.toEqual({
      username: 'runner',
      token: 'token-a',
    });

    expect(renew).toHaveBeenCalledWith({
      repositoryUrl: 'https://gitea.example/Org/Repo/',
      subject: 'checkout',
      rejectedGeneration: 'generation-a',
    });
  });

  it('renews for a generation rejected during an in-flight replacement publication', async () => {
    let releasePublication!: () => void;
    const publicationPending = new Promise<void>((resolve) => (releasePublication = resolve));
    let renewalPublished!: () => void;
    const replacementPublished = new Promise<void>((resolve) => (renewalPublished = resolve));
    const renew = vi
      .fn()
      .mockResolvedValueOnce({
        ...baseCredential,
        token: 'token-b',
        generation: 'generation-b',
        renewal: {mode: 'on-rejection' as const},
      })
      .mockResolvedValueOnce({
        ...baseCredential,
        token: 'token-c',
        generation: 'generation-c',
        renewal: {mode: 'on-rejection' as const},
      });
    const broker = new CredentialBroker({
      renew,
      now: () => now,
      rejectionCooldownMs: 0,
      publishSecrets: async ([token]) => {
        if (token === 'token-b') {
          renewalPublished();
          await publicationPending;
        }
      },
    });
    broker.register({
      repositoryUrl: repository,
      subject: 'checkout',
      credential: {...baseCredential, renewal: {mode: 'on-rejection' as const}},
    });

    const firstRejection = broker.reject(repository);
    await replacementPublished;
    const secondRejection = broker.reject(repository);
    releasePublication();

    await expect(Promise.all([firstRejection, secondRejection])).resolves.toEqual([
      {rejectedGeneration: 'generation-a'},
      {rejectedGeneration: 'generation-b'},
    ]);
    await expect(broker.lookup(repository)).resolves.toEqual({
      username: 'runner',
      token: 'token-c',
    });
    expect(renew).toHaveBeenNthCalledWith(1, {
      repositoryUrl: 'https://gitea.example/Org/Repo/',
      subject: 'checkout',
      rejectedGeneration: 'generation-a',
    });
    expect(renew).toHaveBeenNthCalledWith(2, {
      repositoryUrl: 'https://gitea.example/Org/Repo/',
      subject: 'checkout',
      rejectedGeneration: 'generation-b',
    });
  });

  it('republishes unaffected credentials after clearing rejected secrets', async () => {
    const published: string[][] = [];
    const broker = new CredentialBroker({
      now: () => now,
      renew: vi.fn().mockResolvedValue({
        ...baseCredential,
        token: 'token-one-b',
        generation: 'generation-one-b',
      }),
      publishSecrets: (secrets) => {
        published.push([...secrets]);
      },
      clearSecrets: vi.fn(),
    });
    broker.register({
      repositoryUrl: 'https://example.test/one',
      subject: 'one',
      credential: {...baseCredential, renewal: {mode: 'on-rejection' as const}},
    });
    broker.register({
      repositoryUrl: 'https://example.test/two',
      subject: 'two',
      credential: {...baseCredential, token: 'token-two'},
    });

    await broker.reject('https://example.test/one');

    expect(published.map(([token]) => token)).toEqual([
      'token-a',
      'token-two',
      'token-two',
      'token-one-b',
    ]);
  });

  it('replaces all active published secrets atomically when configured', async () => {
    const replacements: string[][] = [];
    const broker = new CredentialBroker({
      now: () => now,
      renew: vi.fn().mockResolvedValue({
        ...baseCredential,
        token: 'token-one-b',
        generation: 'generation-one-b',
      }),
      replaceSecrets: (secrets) => {
        replacements.push([...secrets]);
      },
    });
    broker.register({
      repositoryUrl: 'https://example.test/one',
      subject: 'one',
      credential: {...baseCredential, renewal: {mode: 'on-rejection' as const}},
    });
    broker.register({
      repositoryUrl: 'https://example.test/two',
      subject: 'two',
      credential: {...baseCredential, token: 'token-two'},
    });

    await broker.reject('https://example.test/one');

    expect(replacements).toEqual([
      ['token-two', Buffer.from('runner:token-two').toString('base64')],
      [
        'token-one-b',
        Buffer.from('runner:token-one-b').toString('base64'),
        'token-two',
        Buffer.from('runner:token-two').toString('base64'),
      ],
    ]);
  });

  it('renews on rejection, rejects echoed generations, and publishes fresh secrets', async () => {
    const published: string[][] = [];
    const renew = vi
      .fn()
      .mockResolvedValueOnce({...baseCredential})
      .mockResolvedValueOnce({...baseCredential, token: 'token-c', generation: 'generation-c'});
    const broker = new CredentialBroker({
      renew,
      now: () => now,
      publishSecrets: (secrets) => {
        published.push([...secrets]);
      },
    });
    broker.register({
      repositoryUrl: repository,
      subject: 'checkout',
      credential: {...baseCredential, renewal: {mode: 'on-rejection' as const}},
    });

    await broker.reject(repository);
    await expect(broker.lookup(repository)).resolves.toBeUndefined();
    expect(renew).toHaveBeenCalledWith({
      repositoryUrl: 'https://gitea.example/Org/Repo/',
      subject: 'checkout',
      rejectedGeneration: 'generation-a',
    });

    await broker.reject(repository);
    await expect(broker.lookup(repository)).resolves.toEqual({
      username: 'runner',
      token: 'token-c',
    });
    expect(published.at(-1)).toEqual(['token-c', Buffer.from('runner:token-c').toString('base64')]);
  });

  it('renews a refresh-at credential after rejection on a later lookup', async () => {
    const renew = vi.fn().mockResolvedValue({
      ...baseCredential,
      token: 'token-b',
      generation: 'generation-b',
    });
    const broker = new CredentialBroker({renew, now: () => now});
    broker.register({repositoryUrl: repository, subject: 'checkout', credential: baseCredential});

    await expect(broker.reject(repository)).resolves.toEqual({rejectedGeneration: 'generation-a'});
    await expect(broker.lookup(repository)).resolves.toEqual({
      username: 'runner',
      token: 'token-b',
    });
    expect(renew).toHaveBeenCalledWith({
      repositoryUrl: 'https://gitea.example/Org/Repo/',
      subject: 'checkout',
      rejectedGeneration: 'generation-a',
    });
  });

  it('serves an on-rejection credential after its advisory expiry', async () => {
    const renew = vi.fn();
    const broker = new CredentialBroker({renew, now: () => now});
    broker.register({
      repositoryUrl: repository,
      subject: 'checkout',
      credential: {...baseCredential, renewal: {mode: 'on-rejection' as const}},
    });
    now = 20_000;

    await expect(broker.lookup(repository)).resolves.toEqual({
      username: 'runner',
      token: 'token-a',
    });
    expect(renew).not.toHaveBeenCalled();
  });

  it('keeps a renewed credential usable when publishing fails', async () => {
    const renew = vi.fn().mockResolvedValue({
      ...baseCredential,
      token: 'token-b',
      generation: 'generation-b',
    });
    const broker = new CredentialBroker({
      renew,
      now: () => 5_000,
      publishSecrets: () => Promise.reject(new Error('registry unavailable')),
    });
    broker.register({repositoryUrl: repository, subject: 'checkout', credential: baseCredential});

    await expect(broker.lookup(repository)).resolves.toEqual({
      username: 'runner',
      token: 'token-b',
    });
  });

  it('times out a renewal and applies backoff', async () => {
    const renew = vi.fn(() => new Promise<never>(() => undefined));
    const broker = new CredentialBroker({
      renew,
      now: () => 5_000,
      renewalTimeoutMs: 1,
      backoffMs: 500,
    });
    broker.register({repositoryUrl: repository, subject: 'checkout', credential: baseCredential});

    await expect(broker.lookup(repository)).resolves.toEqual({
      username: 'runner',
      token: 'token-a',
    });
    await expect(broker.lookup(repository)).resolves.toEqual({
      username: 'runner',
      token: 'token-a',
    });
    expect(renew).toHaveBeenCalledTimes(1);
  });

  it('serves a valid old credential through a transient refresh failure, then backs off', async () => {
    const renew = vi.fn().mockRejectedValue(new TransientCredentialRenewalError());
    const broker = new CredentialBroker({renew, now: () => now, backoffMs: 500});
    now = 5_000;
    broker.register({repositoryUrl: repository, subject: 'checkout', credential: baseCredential});

    await expect(broker.lookup(repository)).resolves.toEqual({
      username: 'runner',
      token: 'token-a',
    });
    expect(renew).toHaveBeenCalledTimes(1);
    expect(broker.getFailureEventCursor()).toBe(0);
    await expect(broker.lookup(repository)).resolves.toEqual({
      username: 'runner',
      token: 'token-a',
    });
    expect(renew).toHaveBeenCalledTimes(1);
  });

  it('backs off permanent renewal failures instead of retrying every lookup', async () => {
    const renew = vi.fn().mockRejectedValue(new Error('invalid renewal response'));
    const broker = new CredentialBroker({renew, now: () => now, backoffMs: 500});
    now = 5_000;
    broker.register({repositoryUrl: repository, subject: 'checkout', credential: baseCredential});

    await expect(broker.lookup(repository)).resolves.toBeUndefined();
    await expect(broker.lookup(repository)).resolves.toBeUndefined();
    expect(renew).toHaveBeenCalledTimes(1);

    now = 5_500;
    await expect(broker.lookup(repository)).resolves.toBeUndefined();
    expect(renew).toHaveBeenCalledTimes(2);
  });

  it('records a failure when a rejection renewal returns the same generation', async () => {
    const renew = vi.fn().mockResolvedValue({...baseCredential});
    const broker = new CredentialBroker({renew, now: () => now});
    broker.register({
      repositoryUrl: repository,
      subject: 'checkout-step:2',
      credential: {...baseCredential, renewal: {mode: 'on-rejection' as const}},
    });

    await broker.reject(repository);

    expect(broker.getFailureEventsSince(0)).toEqual([
      {
        cursor: 1,
        repositoryUrl: 'https://gitea.example/Org/Repo/',
        subject: 'checkout-step:2',
        kind: 'failed',
      },
    ]);
  });

  it('does not record a failure for a spontaneous refresh renewal', async () => {
    const renew = vi.fn().mockRejectedValue(new Error('background renewal failed'));
    const broker = new CredentialBroker({renew, now: () => 5_000});
    broker.register({
      repositoryUrl: repository,
      subject: 'checkout-step:2',
      credential: baseCredential,
    });

    await expect(broker.lookup(repository)).resolves.toBeUndefined();

    expect(broker.getFailureEventCursor()).toBe(0);
  });

  it('records a rejection-triggered transient failure even while the old credential is usable', async () => {
    const renew = vi.fn().mockRejectedValue(new TransientCredentialRenewalError());
    const broker = new CredentialBroker({
      renew,
      now: () => now,
      classifyFailure: () => 'unavailable',
    });
    broker.register({
      repositoryUrl: repository,
      subject: 'checkout-step:2',
      credential: {...baseCredential, renewal: {mode: 'on-rejection' as const}},
    });

    await broker.reject(repository);

    expect(broker.getFailureEventsSince(0)[0]).toMatchObject({
      repositoryUrl: 'https://gitea.example/Org/Repo/',
      subject: 'checkout-step:2',
      kind: 'unavailable',
    });
  });

  it('records a classified fatal renewal event without retaining provider details', async () => {
    const renew = vi.fn().mockRejectedValue(new Error('provider token must not be retained'));
    const broker = new CredentialBroker({
      renew,
      now: () => 5_000,
      classifyFailure: () => 'auth',
    });
    broker.register({
      repositoryUrl: repository,
      subject: 'checkout-step:2',
      credential: {...baseCredential, renewal: {mode: 'on-rejection' as const}},
    });

    await broker.reject(repository);

    expect(broker.getFailureEventCursor()).toBe(1);
    expect(broker.getFailureEventsSince(0)).toEqual([
      {
        cursor: 1,
        repositoryUrl: 'https://gitea.example/Org/Repo/',
        subject: 'checkout-step:2',
        kind: 'auth',
      },
    ]);
    expect(broker.getFailureEventsSince(1)).toEqual([]);
    expect(JSON.stringify(broker.getFailureEventsSince(0))).not.toContain('provider token');
  });

  it('bounds the failure event history while keeping cursors monotonic', async () => {
    const renew = vi.fn().mockRejectedValue(new Error('renewal failed'));
    const broker = new CredentialBroker({
      renew,
      now: () => 1_000,
      backoffMs: 0,
      rejectionCooldownMs: 0,
    });
    broker.register({
      repositoryUrl: repository,
      subject: 'checkout-step:2',
      credential: {...baseCredential, renewal: {mode: 'on-rejection' as const}},
    });

    const captured = await broker.captureFailureEvents(async () => {
      for (let index = 0; index < MAX_CREDENTIAL_FAILURE_EVENTS + 1; index += 1) {
        await broker.reject(repository);
      }
    });

    expect(broker.getFailureEventCursor()).toBe(MAX_CREDENTIAL_FAILURE_EVENTS + 1);
    expect(broker.getFailureEventsSince(0)).toHaveLength(MAX_CREDENTIAL_FAILURE_EVENTS);
    expect(broker.getFailureEventsSince(0)[0]?.cursor).toBe(2);
    expect(captured.events).toHaveLength(MAX_CREDENTIAL_FAILURE_EVENTS);
    expect(captured.events[0]?.cursor).toBe(1);
    expect(broker.getFailureEventsSince(MAX_CREDENTIAL_FAILURE_EVENTS)).toEqual([
      {
        cursor: MAX_CREDENTIAL_FAILURE_EVENTS + 1,
        repositoryUrl: 'https://gitea.example/Org/Repo/',
        subject: 'checkout-step:2',
        kind: 'failed',
      },
    ]);
  });

  it('debounces repeated rejection-triggered renewals after a successful mint', async () => {
    const renew = vi.fn(async () => ({
      ...baseCredential,
      token: `token-${renew.mock.calls.length + 1}`,
      generation: `generation-${renew.mock.calls.length + 1}`,
      renewal: {mode: 'on-rejection' as const},
    }));
    const broker = new CredentialBroker({
      renew,
      now: () => now,
      rejectionCooldownMs: 500,
    });
    broker.register({
      repositoryUrl: repository,
      subject: 'checkout',
      credential: {...baseCredential, renewal: {mode: 'on-rejection' as const}},
    });

    await broker.reject(repository);
    await broker.reject(repository);
    expect(renew).toHaveBeenCalledTimes(1);

    now = 1_500;
    await broker.reject(repository);
    expect(renew).toHaveBeenCalledTimes(2);
  });

  it('fails closed after shutdown and clears published secrets', async () => {
    const renew = vi.fn();
    const clearSecrets = vi.fn();
    const broker = new CredentialBroker({renew, now: () => now, clearSecrets});
    broker.register({repositoryUrl: repository, subject: 'checkout', credential: baseCredential});
    broker.shutdown();

    await expect(broker.lookup(repository)).resolves.toBeUndefined();
    expect(() =>
      broker.register({repositoryUrl: repository, subject: 'x', credential: baseCredential}),
    ).toThrow();
    expect(renew).not.toHaveBeenCalled();
    expect(clearSecrets).toHaveBeenCalledTimes(1);

    broker.shutdown();
    expect(clearSecrets).toHaveBeenCalledTimes(1);
  });
});
