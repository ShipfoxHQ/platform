import {toCheckoutTokenDto} from './checkout-token.js';

type CheckoutSpec = {
  repositoryUrl: string;
  ref: string;
  credentials?: {username: string; token: string; expiresAt: Date};
  gitAuthor?: {name: string; email: string};
};

describe('toCheckoutTokenDto', () => {
  it('maps credentials to basic auth with an ISO expiry', () => {
    const spec: CheckoutSpec = {
      repositoryUrl: 'https://github.com/acme/repo.git',
      ref: 'main',
      gitAuthor: {
        name: 'shipfox-test[bot]',
        email: '1+shipfox-test[bot]@users.noreply.github.com',
      },
      credentials: {
        username: 'x-access-token',
        token: 'ghs-token',
        expiresAt: new Date('2026-06-10T12:00:00.000Z'),
      },
    };

    const dto = toCheckoutTokenDto(spec, {fetchDepth: 1, persist: true});

    expect(dto).toEqual({
      repository_url: 'https://github.com/acme/repo.git',
      ref: 'main',
      fetch_depth: 1,
      git_author: {
        name: 'shipfox-test[bot]',
        email: '1+shipfox-test[bot]@users.noreply.github.com',
      },
      auth: {
        kind: 'basic',
        username: 'x-access-token',
        token: 'ghs-token',
        expires_at: '2026-06-10T12:00:00.000Z',
        carry: 'header',
        host: 'github.com',
        persist: true,
      },
    });
  });

  it('maps persist false into credential auth', () => {
    const spec: CheckoutSpec = {
      repositoryUrl: 'https://github.com/acme/repo.git',
      ref: 'main',
      credentials: {
        username: 'x-access-token',
        token: 'ghs-token',
        expiresAt: new Date('2026-06-10T12:00:00.000Z'),
      },
    };

    const dto = toCheckoutTokenDto(spec, {fetchDepth: 0, persist: false});

    expect(dto).toMatchObject({fetch_depth: 0});
    expect(dto.auth).toMatchObject({carry: 'header', host: 'github.com', persist: false});
  });

  it('omits auth when the spec has no credentials', () => {
    const spec: CheckoutSpec = {repositoryUrl: 'https://example.com/acme/repo.git', ref: 'trunk'};

    const dto = toCheckoutTokenDto(spec, {fetchDepth: 1, persist: true});

    expect(dto).toEqual({
      repository_url: 'https://example.com/acme/repo.git',
      ref: 'trunk',
      fetch_depth: 1,
    });
    expect(dto.auth).toBeUndefined();
  });

  it('rejects a repository URL that embeds credentials', () => {
    const spec: CheckoutSpec = {
      repositoryUrl: 'https://x-access-token:ghs-token@github.com/acme/repo.git',
      ref: 'main',
    };

    expect(() => toCheckoutTokenDto(spec, {fetchDepth: 1, persist: true})).toThrow();
  });

  it('rejects an scp-like URL that embeds credentials', () => {
    const spec: CheckoutSpec = {
      repositoryUrl: 'user:secret@github.com:acme/repo.git',
      ref: 'main',
    };

    expect(() => toCheckoutTokenDto(spec, {fetchDepth: 1, persist: true})).toThrow();
  });

  it('accepts a credential-free scp-like URL', () => {
    const spec: CheckoutSpec = {repositoryUrl: 'git@github.com:acme/repo.git', ref: 'main'};

    const dto = toCheckoutTokenDto(spec, {fetchDepth: 1, persist: true});

    expect(dto).toEqual({
      repository_url: 'git@github.com:acme/repo.git',
      ref: 'main',
      fetch_depth: 1,
    });
  });

  it('maps the host from an scp-like credentialed URL', () => {
    const spec: CheckoutSpec = {
      repositoryUrl: 'git@github.com:acme/repo.git',
      ref: 'main',
      credentials: {
        username: 'x-access-token',
        token: 'ghs-token',
        expiresAt: new Date('2026-06-10T12:00:00.000Z'),
      },
    };

    const dto = toCheckoutTokenDto(spec, {fetchDepth: 1, persist: true});

    expect(dto.auth).toMatchObject({host: 'github.com'});
  });
});
