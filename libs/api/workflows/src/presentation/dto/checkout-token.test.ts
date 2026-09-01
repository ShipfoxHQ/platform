import {toCheckoutTokenDto, toCheckoutTokenRenewalDto} from './checkout-token.js';

type CheckoutSpec = {
  repositoryUrl: string;
  ref: string;
  credentials?: {
    username: string;
    token: string;
    expiresAt: Date;
    generation?: string;
    renewal?: {mode: 'refresh-at'; refreshAt: Date} | {mode: 'on-rejection'};
  };
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

  it('maps credential generation and renewal lifecycle into auth', () => {
    const dto = toCheckoutTokenDto(
      {
        repositoryUrl: 'https://github.com/acme/repo.git',
        ref: 'main',
        credentials: {
          username: 'x-access-token',
          token: 'ghs-token',
          expiresAt: new Date('2026-06-10T12:00:00.000Z'),
          generation: 'generation-2',
          renewal: {
            mode: 'refresh-at',
            refreshAt: new Date('2026-06-10T11:55:00.000Z'),
          },
        },
      },
      {fetchDepth: 1, persist: true},
    );

    expect(dto.auth).toMatchObject({
      generation: 'generation-2',
      renewal: {mode: 'refresh-at', refresh_at: '2026-06-10T11:55:00.000Z'},
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

describe('toCheckoutTokenRenewalDto', () => {
  it('maps credential-only responses into the legacy checkout envelope', () => {
    const dto = toCheckoutTokenRenewalDto('https://github.com/acme/repo', {
      username: 'x-access-token',
      token: 'ghs-renewed-token',
      expiresAt: '2099-06-10T12:00:00.000Z',
      generation: 'generation-2',
      renewal: {mode: 'on-rejection'},
    });

    expect(dto).toEqual({
      repository_url: 'https://github.com/acme/repo',
      ref: 'HEAD',
      fetch_depth: 1,
      auth: {
        kind: 'basic',
        username: 'x-access-token',
        token: 'ghs-renewed-token',
        expires_at: '2099-06-10T12:00:00.000Z',
        carry: 'header',
        host: 'github.com',
        persist: true,
        generation: 'generation-2',
        renewal: {mode: 'on-rejection'},
      },
    });
  });

  it('omits optional credential metadata when the provider does not return it', () => {
    const dto = toCheckoutTokenRenewalDto('https://github.com/acme/repo', {
      username: 'x-access-token',
      token: 'ghs-renewed-token',
      expiresAt: '2099-06-10T12:00:00.000Z',
    });

    expect(dto.auth).toEqual({
      kind: 'basic',
      username: 'x-access-token',
      token: 'ghs-renewed-token',
      expires_at: '2099-06-10T12:00:00.000Z',
      carry: 'header',
      host: 'github.com',
      persist: true,
    });
  });

  it('maps refresh-at renewal when the provider returns a refresh deadline', () => {
    const dto = toCheckoutTokenRenewalDto('https://github.com/acme/repo', {
      username: 'x-access-token',
      token: 'ghs-renewed-token',
      expiresAt: '2099-06-10T12:00:00.000Z',
      renewal: {mode: 'refresh-at', refreshAt: '2099-06-10T11:55:00.000Z'},
    });

    expect(dto.auth?.renewal).toEqual({
      mode: 'refresh-at',
      refresh_at: '2099-06-10T11:55:00.000Z',
    });
  });
});
