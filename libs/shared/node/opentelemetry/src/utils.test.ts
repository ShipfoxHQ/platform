import type {Span} from '@opentelemetry/api';
import {fastifyRequestHook, normalizeRoutePath} from './utils.js';

describe('normalizeRoutePath', () => {
  describe('UUIDs', () => {
    it('replaces a UUID segment with :id', () => {
      const result = normalizeRoutePath(
        '/public/cache/github/028b2a9a-800e-485e-b33a-9af4e238508b/chunk',
      );

      expect(result).toBe('/public/cache/github/:id/chunk');
    });

    it('handles uppercase UUIDs', () => {
      const result = normalizeRoutePath('/items/028B2A9A-800E-485E-B33A-9AF4E238508B');

      expect(result).toBe('/items/:id');
    });

    it('replaces multiple UUID segments in a single path', () => {
      const result = normalizeRoutePath(
        '/orgs/028b2a9a-800e-485e-b33a-9af4e238508b/users/1aef5481-837c-4b82-8633-691ef9016173',
      );

      expect(result).toBe('/orgs/:id/users/:id');
    });
  });

  describe('numeric IDs', () => {
    it('replaces a pure numeric segment with :id', () => {
      const result = normalizeRoutePath('/users/123');

      expect(result).toBe('/users/:id');
    });

    it('replaces multiple numeric segments', () => {
      const result = normalizeRoutePath('/orgs/42/items/99');

      expect(result).toBe('/orgs/:id/items/:id');
    });
  });

  describe('paths that must not be normalised', () => {
    it('leaves slug-like segments unchanged', () => {
      const result = normalizeRoutePath('/public/billing/user-defined-usage-rule');

      expect(result).toBe('/public/billing/user-defined-usage-rule');
    });

    it('leaves short alphanumeric segments unchanged', () => {
      const result = normalizeRoutePath('/public/cache/github');

      expect(result).toBe('/public/cache/github');
    });

    it('leaves root path unchanged', () => {
      const result = normalizeRoutePath('/');

      expect(result).toBe('/');
    });

    it('leaves named route parameters unchanged', () => {
      const result = normalizeRoutePath('/public/cache/:id/chunk');

      expect(result).toBe('/public/cache/:id/chunk');
    });
  });

  it('strips a query string before normalising', () => {
    const raw = '/public/cache/github/1aef5481-837c-4b82-8633-691ef9016173/chunk?partNumber=10';
    const path = raw.split('?')[0] ?? raw;

    const result = normalizeRoutePath(path);

    expect(result).toBe('/public/cache/github/:id/chunk');
  });
});

describe('fastifyRequestHook', () => {
  const makeRequest = (url: string, routeUrl?: string) =>
    ({
      url,
      routeOptions: {url: routeUrl},
    }) as Parameters<typeof fastifyRequestHook>[1];

  it('sets http.route and url.path from route template', () => {
    const setAttribute = vi.fn();
    const span = {setAttribute} as unknown as Span;

    fastifyRequestHook(span, makeRequest('/public/cache/github', '/public/cache/github'));

    expect(setAttribute).toHaveBeenCalledWith('http.route', '/public/cache/github');
    expect(setAttribute).toHaveBeenCalledWith('url.path', '/public/cache/github');
  });

  it('normalises a UUID in http.route but preserves it in url.path', () => {
    const setAttribute = vi.fn();
    const span = {setAttribute} as unknown as Span;
    const uuid = '028b2a9a-800e-485e-b33a-9af4e238508b';

    fastifyRequestHook(span, makeRequest(`/public/cache/github/${uuid}/chunk`, undefined));

    expect(setAttribute).toHaveBeenCalledWith('http.route', '/public/cache/github/:id/chunk');
    expect(setAttribute).toHaveBeenCalledWith('url.path', `/public/cache/github/${uuid}/chunk`);
  });

  it('strips query string from both route and path', () => {
    const setAttribute = vi.fn();
    const span = {setAttribute} as unknown as Span;

    fastifyRequestHook(
      span,
      makeRequest(
        '/public/billing/user-defined-usage-rule?limit=1000&sortBy=name',
        '/public/billing/user-defined-usage-rule?limit=1000&sortBy=name',
      ),
    );

    expect(setAttribute).toHaveBeenCalledWith(
      'http.route',
      '/public/billing/user-defined-usage-rule',
    );
    expect(setAttribute).toHaveBeenCalledWith(
      'url.path',
      '/public/billing/user-defined-usage-rule',
    );
  });

  it('normalises a numeric ID in http.route but preserves it in url.path', () => {
    const setAttribute = vi.fn();
    const span = {setAttribute} as unknown as Span;

    fastifyRequestHook(span, makeRequest('/orders/42/items', undefined));

    expect(setAttribute).toHaveBeenCalledWith('http.route', '/orders/:id/items');
    expect(setAttribute).toHaveBeenCalledWith('url.path', '/orders/42/items');
  });
});
