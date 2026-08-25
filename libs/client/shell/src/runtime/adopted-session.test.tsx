// @vitest-environment jsdom
import type {LoginResponseDto, UserDto} from '@shipfox/api-auth-dto';
import {
  checkedApiRequest,
  configureApiClient,
  emptyResponseSchema,
  resetApiClient,
} from '@shipfox/client-api';
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
  useRefreshAuth,
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
  refreshAuth: () => Promise<AuthenticatedSession>;
}

function AuthHarness({apiRef}: {apiRef: {current: AdoptedSessionApi | null}}) {
  const {adoptSession, renewAdoptedSession, releaseAdoptedSession, adoptedSession} =
    useAdoptedSession();
  const refreshAuth = useRefreshAuth();
  apiRef.current = {
    adoptSession,
    renewAdoptedSession,
    releaseAdoptedSession,
    adoptedSession,
    refreshAuth,
  };
  return null;
}

function renderAuthHarness(
  adminToken: string = ADMIN_SESSION_DTO.token,
  options: {
    holdSecondRefresh?: boolean;
    failRefreshFromCall?: number;
    unauthorizedPaths?: string[];
  } = {},
) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const store = createStore();
  const apiRef: {current: AdoptedSessionApi | null} = {current: null};
  let refreshCalls = 0;
  let releaseSecondRefresh: (() => void) | undefined;
  const fetchImpl = vi.fn((input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      if (
        options.failRefreshFromCall !== undefined &&
        refreshCalls >= options.failRefreshFromCall
      ) {
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      // Only the mount refresh carries the caller-provided token; later
      // refreshes restore the plain cookie session token.
      if (options.holdSecondRefresh && refreshCalls === 2) {
        return new Promise<Response>((resolve) => {
          releaseSecondRefresh = () => resolve(jsonResponse(ADMIN_SESSION_DTO));
        });
      }
      return jsonResponsePromise({
        ...ADMIN_SESSION_DTO,
        token: refreshCalls === 1 ? adminToken : ADMIN_SESSION_DTO.token,
      });
    }
    if (options.unauthorizedPaths?.some((path) => url.endsWith(path))) {
      return jsonResponsePromise({message: 'Unauthorized', code: 'unauthorized'}, {status: 401});
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
  return {
    apiRef,
    fetchImpl,
    queryClient,
    store,
    releaseSecondRefresh: () => releaseSecondRefresh?.(),
  };
}

function harnessApi(apiRef: {current: AdoptedSessionApi | null}): AdoptedSessionApi {
  const api = apiRef.current;
  if (api === null) throw new Error('The auth harness was not mounted.');
  return api;
}

async function waitForCookieSession(store: ReturnType<typeof createStore>, token: string) {
  await waitFor(() => expect(store.get(authStateAtom).token).toBe(token));
}

function useFakeTimersWithWaitFor(): void {
  vi.useFakeTimers();
  // @testing-library waitFor only auto-advances fake timers when a `jest`
  // global exists; vitest provides none, so alias it for the test.
  vi.stubGlobal('jest', vi);
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

  test('Stop during an in-flight mint leaves the administrator session restored', async () => {
    const {apiRef, store} = renderAuthHarness();
    await waitForCookieSession(store, ADMIN_SESSION_DTO.token);

    const api = harnessApi(apiRef);
    const renew = vi.fn(() => Promise.resolve(null));
    // Release runs while the mint is still entering (its workspace hydration
    // has not completed), so the generation must advance regardless and the
    // mint must be discarded when it resolves.
    const adoptPromise = api.adoptSession(ADOPTED_SESSION, {
      expiresAt: EXPIRES_AT,
      serverTime: SERVER_TIME,
      renew,
    });
    await api.releaseAdoptedSession();
    await waitForCookieSession(store, ADMIN_SESSION_DTO.token);

    await expect(adoptPromise).resolves.toBe(false);
    expect(store.get(authStateAtom).token).toBe(ADMIN_SESSION_DTO.token);
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
    useFakeTimersWithWaitFor();
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
    await vi.advanceTimersByTimeAsync(2_100);
    expect(refreshCallCount(fetchImpl)).toBe(1);

    await api.releaseAdoptedSession();
    await waitForCookieSession(store, ADMIN_SESSION_DTO.token);
    expect(refreshCallCount(fetchImpl)).toBe(2);
  });

  test('renews immediately when the early renewal point already passed at adoption', async () => {
    useFakeTimersWithWaitFor();
    const {apiRef, store} = renderAuthHarness();
    await waitForCookieSession(store, ADMIN_SESSION_DTO.token);

    const serverTime = new Date().toISOString();
    // Less than the 5-minute early margin remains, so the renewal point is
    // already in the past when the adoption starts; renewal must run now
    // instead of waiting for the hard expiry.
    const expiresAt = new Date(Date.now() + 3 * 60_000).toISOString();
    const renewal: AdoptedSessionRenewal = {
      session: {...ADOPTED_SESSION, accessToken: 'renewed-token'},
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      serverTime,
    };
    const renew = vi.fn(() => Promise.resolve(renewal));

    const api = harnessApi(apiRef);
    await api.adoptSession(ADOPTED_SESSION, {expiresAt, serverTime, renew});

    await waitFor(() => expect(renew).toHaveBeenCalledTimes(1));
    expect(store.get(authStateAtom).token).toBe('renewed-token');
    await waitFor(() => expect(apiRef.current?.adoptedSession?.expiresAt).toBe(renewal.expiresAt));
  });

  test('release restores the cookie session when an ordinary refresh is still in flight', async () => {
    useFakeTimersWithWaitFor();
    // The admin token reaches its proactive-refresh window 1 to 2 seconds
    // after mount, so the refresh timer fires before the adoption and stays
    // in flight; the adoption supersedes it and must not let release reuse
    // the superseded promise.
    const adminToken = jwtWithExp(Math.ceil((Date.now() + 301_000) / 1000));
    const {apiRef, fetchImpl, store, releaseSecondRefresh} = renderAuthHarness(adminToken, {
      holdSecondRefresh: true,
    });
    await waitForCookieSession(store, adminToken);
    expect(refreshCallCount(fetchImpl)).toBe(1);

    await vi.advanceTimersByTimeAsync(2_100);
    expect(refreshCallCount(fetchImpl)).toBe(2);

    const api = harnessApi(apiRef);
    const renew = vi.fn(() => Promise.resolve(null));
    await api.adoptSession(ADOPTED_SESSION, {
      expiresAt: EXPIRES_AT,
      serverTime: SERVER_TIME,
      renew,
    });

    const releasePromise = api.releaseAdoptedSession();
    // The stale refresh settles after release: it was superseded and must not
    // replace the cookie fallback that release already started.
    releaseSecondRefresh();
    await expect(releasePromise).resolves.toBeUndefined();

    await waitForCookieSession(store, ADMIN_SESSION_DTO.token);
    expect(refreshCallCount(fetchImpl)).toBe(3);
    await waitFor(() => expect(apiRef.current?.adoptedSession).toBeNull());
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
    resolveSecond({
      session: {...ADOPTED_SESSION, accessToken: 'earlier-token'},
      expiresAt: earlierExpiresAt,
      serverTime: SERVER_TIME,
    });
    // Both responses resolve while the adoption transitions are still running:
    // the earlier one must be discarded, never adopted over the later one.
    await Promise.all([firstRenewal, secondRenewal]);

    expect(store.get(authStateAtom).token).toBe('later-token');
    await waitFor(() => expect(apiRef.current?.adoptedSession?.expiresAt).toBe(laterExpiresAt));
  });

  test('a 401 under an adopted token ends the adoption without replaying the request as the administrator', async () => {
    const {apiRef, fetchImpl, store} = renderAuthHarness(ADMIN_SESSION_DTO.token, {
      unauthorizedPaths: ['/widgets'],
    });
    await waitForCookieSession(store, ADMIN_SESSION_DTO.token);

    const api = harnessApi(apiRef);
    const renew = vi.fn(() => Promise.resolve(null));
    await api.adoptSession(ADOPTED_SESSION, {
      expiresAt: EXPIRES_AT,
      serverTime: SERVER_TIME,
      renew,
    });

    // A product request made under the adopted token is refused with a 401.
    await expect(checkedApiRequest(emptyResponseSchema, '/widgets')).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
    });

    // The adoption ended and the cookie principal was restored...
    await waitForCookieSession(store, ADMIN_SESSION_DTO.token);
    await waitFor(() => expect(apiRef.current?.adoptedSession).toBeNull());
    // ...the failed request was not re-executed under the administrator...
    const widgetCalls = fetchImpl.mock.calls.filter(([input]) => {
      const url = input instanceof Request ? input.url : String(input);
      return url.endsWith('/widgets');
    });
    expect(widgetCalls).toHaveLength(1);
    // ...and the renew supplier is never asked afterwards.
    expect(renew).not.toHaveBeenCalled();
  });

  test('a failed cookie restore at release leaves no adopted credential behind', async () => {
    const {apiRef, store} = renderAuthHarness(ADMIN_SESSION_DTO.token, {
      failRefreshFromCall: 2,
    });
    await waitForCookieSession(store, ADMIN_SESSION_DTO.token);

    const api = harnessApi(apiRef);
    const renew = vi.fn(() => Promise.resolve(null));
    await api.adoptSession(ADOPTED_SESSION, {
      expiresAt: EXPIRES_AT,
      serverTime: SERVER_TIME,
      renew,
    });

    await expect(api.releaseAdoptedSession()).resolves.toBeUndefined();

    // The cookie restore failed, so the release fell back to guest: the
    // adopted token is no longer the ambient request credential.
    expect(store.get(authStateAtom).status).toBe('guest');
    expect(store.get(authStateAtom).token).toBeUndefined();
    await waitFor(() => expect(apiRef.current?.adoptedSession).toBeNull());
  });

  test('re-adoption invalidates a renewal still in flight from the previous adoption', async () => {
    const {apiRef, store} = renderAuthHarness();
    await waitForCookieSession(store, ADMIN_SESSION_DTO.token);

    let resolveRenew: (result: AdoptedSessionRenewal | null) => void = () => undefined;
    const firstRenew = vi.fn(
      () =>
        new Promise<AdoptedSessionRenewal | null>((resolve) => {
          resolveRenew = resolve;
        }),
    );
    const api = harnessApi(apiRef);
    await api.adoptSession(ADOPTED_SESSION, {
      expiresAt: EXPIRES_AT,
      serverTime: SERVER_TIME,
      renew: firstRenew,
    });

    const inFlightRenewal = api.renewAdoptedSession();

    const secondSession: AuthenticatedSession = {
      ...ADOPTED_SESSION,
      accessToken: 'second-adopted-token',
    };
    await api.adoptSession(secondSession, {
      expiresAt: EXPIRES_AT,
      serverTime: SERVER_TIME,
      renew: vi.fn(() => Promise.resolve(null)),
    });

    // The stale renewal lands after the re-adoption and must be discarded:
    // it must not overwrite the new adoption with the previous target's token.
    resolveRenew({
      session: {...ADOPTED_SESSION, accessToken: 'stale-token'},
      expiresAt: '2026-08-25T09:30:00.000Z',
      serverTime: SERVER_TIME,
    });
    await expect(inFlightRenewal).resolves.toBeNull();

    expect(store.get(authStateAtom).token).toBe('second-adopted-token');
    await waitFor(() =>
      expect(apiRef.current?.adoptedSession?.session.accessToken).toBe('second-adopted-token'),
    );
  });

  test('repeated discarded renewals fall back to the ordinary cookie refresh', async () => {
    useFakeTimersWithWaitFor();
    const {apiRef, store} = renderAuthHarness();
    await waitForCookieSession(store, ADMIN_SESSION_DTO.token);

    // Every renewal returns a valid but earlier expiry: it is discarded, and
    // without the stall cap the timer would re-fire immediately forever.
    const renewal: AdoptedSessionRenewal = {
      session: {...ADOPTED_SESSION, accessToken: 'shorter-token'},
      expiresAt: '2026-08-25T08:30:00.000Z',
      serverTime: SERVER_TIME,
    };
    const renew = vi.fn(() => Promise.resolve(renewal));
    const api = harnessApi(apiRef);
    await api.adoptSession(ADOPTED_SESSION, {
      expiresAt: EXPIRES_AT,
      serverTime: SERVER_TIME,
      renew,
    });

    await waitFor(() => expect(apiRef.current?.adoptedSession).not.toBeNull());
    // The fire point sits 40 minutes out on the fake clock; drive the renew
    // timer through three zero-delay re-arms and the cookie fallback.
    await vi.advanceTimersByTimeAsync(40 * 60_000 + 1_000);
    await waitFor(() => expect(apiRef.current?.adoptedSession).toBeNull());
    expect(renew).toHaveBeenCalledTimes(3);
    expect(store.get(authStateAtom).token).toBe(ADMIN_SESSION_DTO.token);
  });

  test('a malformed renewal response is never adopted and degrades to the cookie refresh', async () => {
    useFakeTimersWithWaitFor();
    const {apiRef, store} = renderAuthHarness();
    await waitForCookieSession(store, ADMIN_SESSION_DTO.token);

    const renewal: AdoptedSessionRenewal = {
      session: {...ADOPTED_SESSION, accessToken: 'malformed-token'},
      expiresAt: 'not-a-date',
      serverTime: SERVER_TIME,
    };
    const renew = vi.fn(() => Promise.resolve(renewal));
    const api = harnessApi(apiRef);
    await api.adoptSession(ADOPTED_SESSION, {
      expiresAt: EXPIRES_AT,
      serverTime: SERVER_TIME,
      renew,
    });

    await waitFor(() => expect(apiRef.current?.adoptedSession).not.toBeNull());
    // The fire point sits 40 minutes out on the fake clock; drive the renew
    // timer through three zero-delay re-arms and the cookie fallback.
    await vi.advanceTimersByTimeAsync(40 * 60_000 + 1_000);
    await waitFor(() => expect(apiRef.current?.adoptedSession).toBeNull());
    expect(renew).toHaveBeenCalledTimes(3);
    expect(store.get(authStateAtom).token).toBe(ADMIN_SESSION_DTO.token);
    expect(store.get(authStateAtom).user?.id).toBe(ADMIN_USER.id);
  });

  test('adoptSession resolves false when a competing transition supersedes the mint', async () => {
    const {apiRef, store} = renderAuthHarness();
    await waitForCookieSession(store, ADMIN_SESSION_DTO.token);

    const api = harnessApi(apiRef);
    const adoptPromise = api.adoptSession(ADOPTED_SESSION, {
      expiresAt: EXPIRES_AT,
      serverTime: SERVER_TIME,
      renew: vi.fn(() => Promise.resolve(null)),
    });
    // The ordinary refresh starts a competing transition while the mint is
    // still entering, so the mint must be refused without setting the atom.
    const refreshPromise = api.refreshAuth();
    await expect(adoptPromise).resolves.toBe(false);
    await expect(refreshPromise).resolves.toBeDefined();
    expect(apiRef.current?.adoptedSession).toBeNull();
    expect(store.get(authStateAtom).token).toBe(ADMIN_SESSION_DTO.token);
  });

  test('renews immediately when the issuer expiry already passed at adoption', async () => {
    useFakeTimersWithWaitFor();
    const {apiRef, store} = renderAuthHarness();
    await waitForCookieSession(store, ADMIN_SESSION_DTO.token);

    // The session expired before it was adopted, so the renewal point is long
    // past: renewal must run now instead of waiting for the hard expiry.
    const serverTime = new Date(Date.now() - 10 * 60_000).toISOString();
    const expiresAt = new Date(Date.now() - 5 * 60_000).toISOString();
    const renewal: AdoptedSessionRenewal = {
      session: {...ADOPTED_SESSION, accessToken: 'renewed-token'},
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      serverTime,
    };
    const renew = vi.fn(() => Promise.resolve(renewal));
    const api = harnessApi(apiRef);
    await api.adoptSession(ADOPTED_SESSION, {expiresAt, serverTime, renew});

    await waitFor(() => expect(renew).toHaveBeenCalledTimes(1));
    expect(store.get(authStateAtom).token).toBe('renewed-token');
    await waitFor(() => expect(apiRef.current?.adoptedSession?.expiresAt).toBe(renewal.expiresAt));
  });
});
