// @vitest-environment jsdom
import type {LoginResponseDto, UserDto} from '@shipfox/api-auth-dto';
import {configureApiClient, resetApiClient} from '@shipfox/client-api';
import {QueryClient} from '@tanstack/react-query';
import {cleanup, render, waitFor} from '@testing-library/react';
import {createStore} from 'jotai';
import type {AuthenticatedSession, UserIdentity} from '#core/session.js';
import {
  type AdoptedSessionRenewal,
  type AdoptedSessionState,
  type AdoptSessionOptions,
  authStateAtom,
  getAdoptedSessionRenewDelayMs,
  useAdoptedSession,
} from './auth.js';
import {ShellProviderStack} from './provider-stack.js';

const ADMIN_USER: UserDto = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'admin@example.com',
  name: null,
  email_verified_at: null,
  status: 'active',
  created_at: '2026-08-25T08:00:00.000Z',
  updated_at: '2026-08-25T08:00:00.000Z',
};

const TARGET_USER: UserDto = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'target@example.com',
  name: null,
  email_verified_at: null,
  status: 'active',
  created_at: '2026-08-25T08:00:00.000Z',
  updated_at: '2026-08-25T08:00:00.000Z',
};

const ADMIN_SESSION_DTO: LoginResponseDto = {
  token: 'admin-access-token',
  user: ADMIN_USER,
  admin_role: 'admin-owner',
};

const TARGET_IDENTITY: UserIdentity = {id: TARGET_USER.id, email: TARGET_USER.email};

const ADOPTED_SESSION: AuthenticatedSession = {
  accessToken: 'adopted-token',
  user: TARGET_IDENTITY,
  impersonatorId: ADMIN_USER.id,
};

const SERVER_TIME = '2026-08-25T08:00:00.000Z';
const EXPIRES_AT = '2026-08-25T08:45:00.000Z';
const TRAILING_EQUALS_RE = /=+$/u;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

function jsonResponsePromise(body: unknown, init?: ResponseInit): Promise<Response> {
  return Promise.resolve(jsonResponse(body, init));
}

function jwtWithExp(expSeconds: number): string {
  const payload = btoa(JSON.stringify({exp: expSeconds}))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(TRAILING_EQUALS_RE, '');
  return `header.${payload}.signature`;
}

function refreshCallCount(fetchImpl: ReturnType<typeof vi.fn>): number {
  return fetchImpl.mock.calls.filter(([input]) => {
    const url = input instanceof Request ? input.url : String(input);
    return url.endsWith('/auth/refresh');
  }).length;
}

interface AdoptedSessionApi {
  adoptSession: (session: AuthenticatedSession, options: AdoptSessionOptions) => Promise<boolean>;
  renewAdoptedSession: () => Promise<AdoptedSessionRenewal | null>;
  releaseAdoptedSession: () => Promise<void>;
  adoptedSession: AdoptedSessionState | null;
}

function AuthHarness({apiRef}: {apiRef: {current: AdoptedSessionApi | null}}) {
  const {adoptSession, renewAdoptedSession, releaseAdoptedSession, adoptedSession} =
    useAdoptedSession();
  apiRef.current = {adoptSession, renewAdoptedSession, releaseAdoptedSession, adoptedSession};
  return null;
}

function renderAuthHarness(adminToken: string = ADMIN_SESSION_DTO.token) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const store = createStore();
  const apiRef: {current: AdoptedSessionApi | null} = {current: null};
  let refreshCalls = 0;
  const fetchImpl = vi.fn((input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      // Only the mount refresh carries the caller-provided token; later
      // refreshes restore the plain cookie session token.
      return jsonResponsePromise({
        ...ADMIN_SESSION_DTO,
        token: refreshCalls === 1 ? adminToken : ADMIN_SESSION_DTO.token,
      });
    }
    if (url.endsWith('/workspaces')) return jsonResponsePromise({memberships: []});
    return jsonResponsePromise({message: 'Not found', code: 'not-found'}, {status: 404});
  });
  resetApiClient();
  configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
  render(
    <ShellProviderStack
      features={[]}
      queryClient={queryClient}
      store={store}
      auth={{effects: true}}
    >
      <AuthHarness apiRef={apiRef} />
    </ShellProviderStack>,
  );
  return {apiRef, fetchImpl, queryClient, store};
}

function harnessApi(apiRef: {current: AdoptedSessionApi | null}): AdoptedSessionApi {
  const api = apiRef.current;
  if (api === null) throw new Error('The auth harness was not mounted.');
  return api;
}

async function waitForCookieSession(store: ReturnType<typeof createStore>, token: string) {
  await waitFor(() => expect(store.get(authStateAtom).token).toBe(token));
}

describe('getAdoptedSessionRenewDelayMs', () => {
  test('derives the renewal delay from the issuer timestamps only', () => {
    expect(getAdoptedSessionRenewDelayMs(EXPIRES_AT, SERVER_TIME)).toBe(40 * 60_000);
  });

  test('returns a negative delay once the renewal point passed', () => {
    expect(getAdoptedSessionRenewDelayMs('2026-08-25T08:03:00.000Z', SERVER_TIME)).toBeLessThan(0);
  });
});

describe('adopted-session runtime seam', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetApiClient();
  });

  test('adopts an externally minted session and release restores the cookie principal', async () => {
    const {apiRef, fetchImpl, queryClient, store} = renderAuthHarness();
    await waitForCookieSession(store, ADMIN_SESSION_DTO.token);

    queryClient.setQueryData(['private', 'data'], {value: 1});
    const renew = vi.fn(() => Promise.resolve(null));

    await expect(
      harnessApi(apiRef).adoptSession(ADOPTED_SESSION, {
        expiresAt: EXPIRES_AT,
        serverTime: SERVER_TIME,
        renew,
      }),
    ).resolves.toBe(true);

    expect(store.get(authStateAtom).token).toBe(ADOPTED_SESSION.accessToken);
    expect(store.get(authStateAtom).user?.id).toBe(TARGET_USER.id);
    // The principal change cleared the previous user's cached data.
    expect(queryClient.getQueryData(['private', 'data'])).toBeUndefined();

    const refreshCallsBeforeRelease = refreshCallCount(fetchImpl);
    await harnessApi(apiRef).releaseAdoptedSession();

    await waitForCookieSession(store, ADMIN_SESSION_DTO.token);
    expect(refreshCallCount(fetchImpl)).toBe(refreshCallsBeforeRelease + 1);
    await waitFor(() => expect(apiRef.current?.adoptedSession).toBeNull());
  });

  test('Stop during an in-flight Extend leaves the administrator session restored', async () => {
    const {apiRef, store} = renderAuthHarness();
    await waitForCookieSession(store, ADMIN_SESSION_DTO.token);

    let resolveRenew: (result: AdoptedSessionRenewal | null) => void = () => undefined;
    const renew = vi.fn(
      () =>
        new Promise<AdoptedSessionRenewal | null>((resolve) => {
          resolveRenew = resolve;
        }),
    );
    const api = harnessApi(apiRef);
    await api.adoptSession(ADOPTED_SESSION, {
      expiresAt: EXPIRES_AT,
      serverTime: SERVER_TIME,
      renew,
    });

    const renewPromise = api.renewAdoptedSession();
    await api.releaseAdoptedSession();
    await waitForCookieSession(store, ADMIN_SESSION_DTO.token);

    // The Extend response resolves after Stop: it must be discarded, not adopted.
    resolveRenew({
      session: {...ADOPTED_SESSION, accessToken: 'late-renewal-token'},
      expiresAt: '2026-08-25T08:30:00.000Z',
      serverTime: SERVER_TIME,
    });

    await expect(renewPromise).resolves.toBeNull();
    expect(store.get(authStateAtom).token).toBe(ADMIN_SESSION_DTO.token);
    await waitFor(() => expect(apiRef.current?.adoptedSession).toBeNull());
  });

  test('a late renewal response after Stop is discarded', async () => {
    const {apiRef, store} = renderAuthHarness();
    await waitForCookieSession(store, ADMIN_SESSION_DTO.token);

    let resolveRenew: (result: AdoptedSessionRenewal | null) => void = () => undefined;
    const renew = vi.fn(
      () =>
        new Promise<AdoptedSessionRenewal | null>((resolve) => {
          resolveRenew = resolve;
        }),
    );
    const api = harnessApi(apiRef);
    await api.adoptSession(ADOPTED_SESSION, {
      expiresAt: EXPIRES_AT,
      serverTime: SERVER_TIME,
      renew,
    });

    const renewPromise = api.renewAdoptedSession();
    await api.releaseAdoptedSession();
    await waitForCookieSession(store, ADMIN_SESSION_DTO.token);
    expect(apiRef.current?.adoptedSession).toBeNull();

    // The response lands after the release fully completed and must not
    // re-enter the session the operator just ended.
    resolveRenew({
      session: {...ADOPTED_SESSION, accessToken: 'late-renewal-token'},
      expiresAt: '2026-08-25T08:30:00.000Z',
      serverTime: SERVER_TIME,
    });

    await expect(renewPromise).resolves.toBeNull();
    expect(store.get(authStateAtom).token).toBe(ADMIN_SESSION_DTO.token);
    await waitFor(() => expect(apiRef.current?.adoptedSession).toBeNull());
  });

  test('a null renewal result falls back to the ordinary cookie refresh', async () => {
    const {apiRef, fetchImpl, store} = renderAuthHarness();
    await waitForCookieSession(store, ADMIN_SESSION_DTO.token);

    const api = harnessApi(apiRef);
    const renew = vi.fn(() => Promise.resolve(null));
    await api.adoptSession(ADOPTED_SESSION, {
      expiresAt: EXPIRES_AT,
      serverTime: SERVER_TIME,
      renew,
    });

    const refreshCallsBeforeRenewal = refreshCallCount(fetchImpl);
    await expect(api.renewAdoptedSession()).resolves.toBeNull();

    await waitForCookieSession(store, ADMIN_SESSION_DTO.token);
    expect(refreshCallCount(fetchImpl)).toBe(refreshCallsBeforeRenewal + 1);
    await waitFor(() => expect(apiRef.current?.adoptedSession).toBeNull());
  });

  test('a throwing renewal degrades like a refused one', async () => {
    const {apiRef, store} = renderAuthHarness();
    await waitForCookieSession(store, ADMIN_SESSION_DTO.token);

    const api = harnessApi(apiRef);
    const renew = vi.fn(() => Promise.reject(new Error('renewal failed')));
    await api.adoptSession(ADOPTED_SESSION, {
      expiresAt: EXPIRES_AT,
      serverTime: SERVER_TIME,
      renew,
    });

    await expect(api.renewAdoptedSession()).resolves.toBeNull();
    await waitForCookieSession(store, ADMIN_SESSION_DTO.token);
    await waitFor(() => expect(apiRef.current?.adoptedSession).toBeNull());
  });

  test('suspends the cookie refresh and renews against the server anchor near expiry', async () => {
    // The admin token reaches its proactive-refresh window 1 to 2 seconds
    // after mount, so the refresh timer would fire during the adoption if the
    // cookie refresh were not suspended.
    const adminToken = jwtWithExp(Math.ceil((Date.now() + 301_000) / 1000));
    const {apiRef, fetchImpl, store} = renderAuthHarness(adminToken);
    await waitForCookieSession(store, adminToken);
    expect(refreshCallCount(fetchImpl)).toBe(1);

    const serverTime = new Date().toISOString();
    // The issuer-anchored window minus the early margin leaves 250ms.
    const firstExpiresAt = new Date(Date.now() + 5 * 60_000 + 250).toISOString();
    const secondExpiresAt = new Date(Date.now() + 8 * 60_000).toISOString();
    const renewal: AdoptedSessionRenewal = {
      session: {...ADOPTED_SESSION, accessToken: 'renewed-token'},
      expiresAt: secondExpiresAt,
      serverTime,
    };
    const renew = vi.fn(() => Promise.resolve(renewal));

    const api = harnessApi(apiRef);
    await api.adoptSession(ADOPTED_SESSION, {expiresAt: firstExpiresAt, serverTime, renew});

    await waitFor(() => expect(renew).toHaveBeenCalledTimes(1));
    expect(store.get(authStateAtom).token).toBe('renewed-token');
    await waitFor(() => expect(apiRef.current?.adoptedSession?.expiresAt).toBe(secondExpiresAt));

    // Give the would-be cookie refresh time to fire: it must not.
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    expect(refreshCallCount(fetchImpl)).toBe(1);

    await api.releaseAdoptedSession();
    await waitForCookieSession(store, ADMIN_SESSION_DTO.token);
    expect(refreshCallCount(fetchImpl)).toBe(2);
  });

  test('keeps the token with the later expires_at when renewal responses race', async () => {
    const {apiRef, store} = renderAuthHarness();
    await waitForCookieSession(store, ADMIN_SESSION_DTO.token);

    const resolvers: Array<(result: AdoptedSessionRenewal | null) => void> = [];
    const renew = vi.fn(
      () =>
        new Promise<AdoptedSessionRenewal | null>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const api = harnessApi(apiRef);
    await api.adoptSession(ADOPTED_SESSION, {
      expiresAt: EXPIRES_AT,
      serverTime: SERVER_TIME,
      renew,
    });

    const laterExpiresAt = '2026-08-25T09:15:00.000Z';
    const earlierExpiresAt = '2026-08-25T09:00:00.000Z';
    const firstRenewal = api.renewAdoptedSession();
    const secondRenewal = api.renewAdoptedSession();
    const [resolveFirst, resolveSecond] = resolvers;
    if (resolveFirst === undefined || resolveSecond === undefined) {
      throw new Error('Both renewal requests must have started.');
    }

    resolveFirst({
      session: {...ADOPTED_SESSION, accessToken: 'later-token'},
      expiresAt: laterExpiresAt,
      serverTime: SERVER_TIME,
    });
    await firstRenewal;
    resolveSecond({
      session: {...ADOPTED_SESSION, accessToken: 'earlier-token'},
      expiresAt: earlierExpiresAt,
      serverTime: SERVER_TIME,
    });
    await secondRenewal;

    expect(store.get(authStateAtom).token).toBe('later-token');
    await waitFor(() => expect(apiRef.current?.adoptedSession?.expiresAt).toBe(laterExpiresAt));
  });
});
