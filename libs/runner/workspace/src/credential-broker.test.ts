import {
  CredentialBroker,
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
    await expect(broker.lookup(repository)).resolves.toEqual({
      username: 'runner',
      token: 'token-a',
    });
    expect(renew).toHaveBeenCalledTimes(1);
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
