import {
  checkoutTokenParamsSchema,
  checkoutTokenQuerySchema,
  checkoutTokenResponseSchema,
} from './checkout-token.js';

describe('checkout token request schemas', () => {
  it('accepts a UUID step id', () => {
    const stepId = crypto.randomUUID();

    expect(checkoutTokenParamsSchema.parse({stepId})).toEqual({stepId});
  });

  it('rejects a non-UUID step id', () => {
    expect(() => checkoutTokenParamsSchema.parse({stepId: 'step-1'})).toThrow();
  });

  it('coerces a positive integer attempt', () => {
    expect(checkoutTokenQuerySchema.parse({attempt: '2'})).toEqual({attempt: 2});
  });

  it.each([0, -1, 'not-a-number'])('rejects invalid attempt %p', (attempt) => {
    expect(() => checkoutTokenQuerySchema.parse({attempt})).toThrow();
  });
});

const bearerResponse = {
  repository_url: 'https://github.com/acme/repo.git',
  ref: 'main',
  fetch_depth: 1,
  auth: {
    kind: 'bearer',
    token: 'gh-token',
    expires_at: '2026-06-10T12:00:00.000Z',
    carry: 'header',
    host: 'github.com',
    persist: true,
  },
};

const basicResponse = {
  repository_url: 'https://github.com/acme/repo.git',
  ref: 'main',
  fetch_depth: 1,
  auth: {
    kind: 'basic',
    username: 'x-access-token',
    token: 'gh-token',
    expires_at: '2026-06-10T12:00:00.000Z',
    carry: 'header',
    host: 'github.com',
    persist: false,
  },
};

describe('checkoutTokenResponseSchema', () => {
  it('accepts and round-trips a bearer auth response (no username)', () => {
    const result = checkoutTokenResponseSchema.parse(bearerResponse);

    expect(result).toEqual(bearerResponse);
  });

  it('accepts and round-trips a basic auth response with a username', () => {
    const result = checkoutTokenResponseSchema.parse(basicResponse);

    expect(result).toEqual(basicResponse);
  });

  it('accepts a Git author identity', () => {
    const input = {
      ...basicResponse,
      git_author: {
        name: 'shipfox-test[bot]',
        email: '1+shipfox-test[bot]@users.noreply.github.com',
      },
    };

    const result = checkoutTokenResponseSchema.parse(input);

    expect(result.git_author).toEqual(input.git_author);
  });

  it('accepts a credential-free response with no auth (debug provider)', () => {
    const input = {
      repository_url: 'https://github.com/acme/repo.git',
      ref: 'main',
      fetch_depth: 1,
    };

    const result = checkoutTokenResponseSchema.parse(input);

    expect(result).toEqual(input);
    expect(result.auth).toBeUndefined();
  });

  it('rejects basic auth missing a username', () => {
    const {username: _username, ...basicAuthWithoutUsername} = basicResponse.auth;
    const input = {...basicResponse, auth: basicAuthWithoutUsername};

    const parse = () => checkoutTokenResponseSchema.parse(input);

    expect(parse).toThrow();
  });

  it('rejects an unknown auth kind', () => {
    const input = {...bearerResponse, auth: {...bearerResponse.auth, kind: 'oauth'}};

    const parse = () => checkoutTokenResponseSchema.parse(input);

    expect(parse).toThrow();
  });

  it('rejects a malformed (non-ISO) expires_at', () => {
    const input = {...bearerResponse, auth: {...bearerResponse.auth, expires_at: 'soon'}};

    const parse = () => checkoutTokenResponseSchema.parse(input);

    expect(parse).toThrow();
  });

  it('accepts the toISOString() Z wire format for expires_at', () => {
    const input = {
      ...bearerResponse,
      auth: {...bearerResponse.auth, expires_at: '2026-06-10T12:00:00.000Z'},
    };

    const result = checkoutTokenResponseSchema.parse(input);

    expect(result.auth?.expires_at).toBe('2026-06-10T12:00:00.000Z');
  });

  it('accepts an offset (non-Z) expires_at', () => {
    const input = {
      ...bearerResponse,
      auth: {...bearerResponse.auth, expires_at: '2026-06-10T12:00:00+02:00'},
    };

    const result = checkoutTokenResponseSchema.parse(input);

    expect(result.auth?.expires_at).toBe('2026-06-10T12:00:00+02:00');
  });

  it('rejects an empty token', () => {
    const input = {...bearerResponse, auth: {...bearerResponse.auth, token: ''}};

    const parse = () => checkoutTokenResponseSchema.parse(input);

    expect(parse).toThrow();
  });

  it('accepts userinfo carry mode', () => {
    const input = {...bearerResponse, auth: {...bearerResponse.auth, carry: 'userinfo'}};

    const result = checkoutTokenResponseSchema.parse(input);

    expect(result.auth?.carry).toBe('userinfo');
  });

  it('rejects an unsupported carry mode', () => {
    const input = {...bearerResponse, auth: {...bearerResponse.auth, carry: 'ssh-agent'}};

    const parse = () => checkoutTokenResponseSchema.parse(input);

    expect(parse).toThrow();
  });

  it('rejects auth missing host', () => {
    const {host: _host, ...auth} = bearerResponse.auth;
    const input = {...bearerResponse, auth};

    const parse = () => checkoutTokenResponseSchema.parse(input);

    expect(parse).toThrow();
  });

  it('rejects auth missing persist', () => {
    const {persist: _persist, ...auth} = bearerResponse.auth;
    const input = {...bearerResponse, auth};

    const parse = () => checkoutTokenResponseSchema.parse(input);

    expect(parse).toThrow();
  });

  it('rejects an empty repository_url', () => {
    const input = {...bearerResponse, repository_url: ''};

    const parse = () => checkoutTokenResponseSchema.parse(input);

    expect(parse).toThrow();
  });

  it('accepts zero for a full-history fetch', () => {
    const result = checkoutTokenResponseSchema.parse({...bearerResponse, fetch_depth: 0});

    expect(result.fetch_depth).toBe(0);
  });

  it('rejects a negative fetch depth', () => {
    const parse = () => checkoutTokenResponseSchema.parse({...bearerResponse, fetch_depth: -1});

    expect(parse).toThrow();
  });
});
