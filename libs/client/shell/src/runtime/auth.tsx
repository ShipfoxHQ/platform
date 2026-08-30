import {ApiError, configureApiClient} from '@shipfox/client-api';
import {type QueryClient, useQueryClient} from '@tanstack/react-query';
import {atom, useAtomValue, useSetAtom, useStore} from 'jotai';
import type {PropsWithChildren} from 'react';
import {useCallback, useEffect, useMemo} from 'react';
import type {AuthenticatedSession, UserIdentity, WorkspaceSummary} from '#core/session.js';
import {
  authRefreshQueryKey,
  authRefreshQueryOptions,
  userWorkspacesQueryOptions,
} from '#hooks/api/session-auth.js';
import {lastWorkspaceIdAtom} from './last-workspace.js';

const REFRESH_EARLY_MS = 5 * 60 * 1000;
const REFRESH_RETRY_DELAY_MS = 60_000;
// Consecutive renewal responses that do not advance the adopted window (a
// malformed response, or an expiry no later than the one already held) end
// the adoption instead of driving an unbounded zero-delay renew loop. A
// valid response that merely lost a race to a longer expiry is not one.
const ADOPTED_RENEWAL_STALL_LIMIT = 3;
const BASE64_URL_REPLACEMENTS = {dash: /-/g, underscore: /_/g} as const;
const refreshPromises = new WeakMap<QueryClient, Promise<AuthenticatedSession>>();

/**
 * A renewal response for an adopted session. `expiresAt` and `serverTime` are
 * both issuer timestamps; their difference is the server-side remaining
 * lifetime, which is the renewal scheduling anchor.
 */
export interface AdoptedSessionRenewal {
  session: AuthenticatedSession;
  expiresAt: string;
  serverTime: string;
}

export type AdoptedSessionRenewalSupplier = () => Promise<AdoptedSessionRenewal | null>;

/**
 * Options for the adopted-session renewal. A `null` renewal result ends the
 * adoption and falls back to the ordinary cookie refresh.
 */
export interface AdoptSessionOptions {
  expiresAt: string;
  serverTime: string;
  renew: AdoptedSessionRenewalSupplier;
}

/** The adopted session as exposed to composing consumers. */
export interface AdoptedSessionState {
  session: AuthenticatedSession;
  expiresAt: string;
  serverTime: string;
}

interface AdoptedSessionRuntimeState extends AdoptedSessionState {
  generation: number;
  receivedAtMs: number;
  renew: AdoptedSessionRenewalSupplier;
  /**
   * Consecutive malformed or non-advancing renewal responses (responses that
   * merely lost a race to a longer expiry excluded). Capped at
   * {@link ADOPTED_RENEWAL_STALL_LIMIT} before the adoption falls back to the
   * ordinary cookie refresh.
   */
  stalledRenewals: number;
}

type RenewalCandidate = {
  expiryMs: number;
  currentExpiryMs: number;
  valid: boolean;
  advancesWindow: boolean;
};

function renewalCandidate(
  result: AdoptedSessionRenewal,
  current: AdoptedSessionRuntimeState,
  reservedExpiryMs: number,
): RenewalCandidate {
  const expiryMs = Date.parse(result.expiresAt);
  const serverTimeMs = Date.parse(result.serverTime);
  const currentExpiryMs = Date.parse(current.expiresAt);
  const valid =
    Number.isFinite(expiryMs) && Number.isFinite(serverTimeMs) && expiryMs > serverTimeMs;
  return {
    expiryMs,
    currentExpiryMs,
    valid,
    advancesWindow: valid && expiryMs > Math.max(currentExpiryMs, reservedExpiryMs),
  };
}

async function requestAdoptedRenewal(
  adopted: AdoptedSessionRuntimeState,
): Promise<AdoptedSessionRenewal | null> {
  try {
    return await adopted.renew();
  } catch {
    return null;
  }
}

const adoptedSessionAtom = atom<AdoptedSessionRuntimeState | null>(null);
const adoptionGenerationAtom = atom(0);
/**
 * Expiry reserved by a renewal whose adoption transition is still running.
 * Overlapping renewals compare against it so a shorter response cannot slip
 * past the later-`expires_at` check while the longer one is entering.
 *
 * It lives in its own atom instead of inside {@link adoptedSessionAtom} so a
 * reservation write does not re-run `AuthRuntime`'s renewal effect: an effect
 * re-run while the first transition is still pending would reset the
 * in-flight guard and schedule another renewal from the old expiry, letting
 * an already-due adoption invoke the supplier a second time.
 */
const adoptedRenewalReservationAtom = atom(0);

function invalidateRefresh(queryClient: QueryClient): void {
  refreshPromises.delete(queryClient);
}

export type AuthStatus = 'loading' | 'authenticated' | 'guest';

export type Workspace = WorkspaceSummary;

export interface AuthState {
  status: AuthStatus;
  token?: string;
  user?: UserIdentity;
  workspaces?: Workspace[];
}

export interface AuthStateValue extends AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  workspaces: Workspace[];
  hasWorkspace: boolean;
}

export const initialAuthState: AuthState = {status: 'loading'};
export const authStateAtom = atom<AuthState>(initialAuthState);
const authTransitionEpochAtom = atom(0);

export function toAuthenticatedState(
  session: AuthenticatedSession,
  workspaces: WorkspaceSummary[] = [],
): AuthState {
  return {
    status: 'authenticated',
    token: session.accessToken,
    user: session.user,
    workspaces,
  };
}

export function useAuthState(): AuthStateValue {
  const state = useAtomValue(authStateAtom);
  return useMemo(
    () => ({
      ...state,
      workspaces: state.workspaces ?? [],
      isLoading: state.status === 'loading',
      isAuthenticated: state.status === 'authenticated',
      hasWorkspace: (state.workspaces ?? []).length > 0,
    }),
    [state],
  );
}

export {
  authRefreshQueryKey,
  authRefreshQueryOptions,
  listUserWorkspaces,
  userWorkspacesQueryKey,
  userWorkspacesQueryOptions,
} from '#hooks/api/session-auth.js';

function decodeBase64Url(value: string): string {
  const base64 = value
    .replace(BASE64_URL_REPLACEMENTS.dash, '+')
    .replace(BASE64_URL_REPLACEMENTS.underscore, '/');
  return atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
}

function readJwtExp(token: string): number | undefined {
  const [, payload] = token.split('.');
  if (!payload) return undefined;
  try {
    const parsed = JSON.parse(decodeBase64Url(payload)) as {exp?: unknown};
    return typeof parsed.exp === 'number' && Number.isFinite(parsed.exp) ? parsed.exp : undefined;
  } catch {
    return undefined;
  }
}

export function getAuthRefreshDelayMs(token: string, nowMs = Date.now()): number | undefined {
  const exp = readJwtExp(token);
  return exp === undefined ? undefined : exp * 1000 - nowMs - REFRESH_EARLY_MS;
}

/**
 * Delay until the adopted session's renewal point, derived from the issuer
 * timestamps only. Both values come from the server, so a skewed browser
 * clock cannot shorten or lengthen the window. Negative when the renewal
 * point already passed; callers clamp.
 */
export function getAdoptedSessionRenewDelayMs(expiresAt: string, serverTime: string): number {
  return Date.parse(expiresAt) - Date.parse(serverTime) - REFRESH_EARLY_MS;
}

export function useAuthTransition() {
  const queryClient = useQueryClient();
  const store = useStore();
  const setState = useSetAtom(authStateAtom);
  const setLastWorkspaceId = useSetAtom(lastWorkspaceIdAtom);

  const beginAuthTransition = useCallback(() => {
    const transitionEpoch = store.get(authTransitionEpochAtom) + 1;
    store.set(authTransitionEpochAtom, transitionEpoch);
    return transitionEpoch;
  }, [store]);

  const clearPrivateState = useCallback(
    async (epoch: number): Promise<boolean> => {
      await queryClient.cancelQueries();
      // A superseded transition must not clear the cache: the clear would
      // destroy an in-flight query owned by the transition that superseded it
      // (for example the cookie fallback started by a release during a mint).
      if (store.get(authTransitionEpochAtom) !== epoch) return false;
      queryClient.clear();
      return true;
    },
    [queryClient, store],
  );

  const enterGuest = useCallback(
    async (transitionEpoch?: number) => {
      const isExternalTransition = transitionEpoch === undefined;
      const epoch = transitionEpoch ?? beginAuthTransition();
      if (isExternalTransition) invalidateRefresh(queryClient);
      if (store.get(authTransitionEpochAtom) !== epoch) return false;

      if (!(await clearPrivateState(epoch))) return false;
      setLastWorkspaceId(undefined);
      setState({status: 'guest'});
      return true;
    },
    [beginAuthTransition, clearPrivateState, queryClient, setLastWorkspaceId, setState, store],
  );

  const enterAuthenticated = useCallback(
    async (session: AuthenticatedSession, transitionEpoch?: number) => {
      const isExternalTransition = transitionEpoch === undefined;
      const epoch = transitionEpoch ?? beginAuthTransition();
      if (isExternalTransition) invalidateRefresh(queryClient);
      if (store.get(authTransitionEpochAtom) !== epoch) return false;

      const previousState = store.get(authStateAtom);
      const principalChanged =
        previousState.status !== 'authenticated' || previousState.user?.id !== session.user.id;

      if (principalChanged) {
        if (!(await clearPrivateState(epoch))) return false;
        setLastWorkspaceId(undefined);
      }

      queryClient.setQueryData(authRefreshQueryKey, session);
      let workspaces: WorkspaceSummary[] = [];
      try {
        const hydratedWorkspaces = await queryClient.fetchQuery(
          userWorkspacesQueryOptions(session.accessToken),
        );
        workspaces = hydratedWorkspaces.memberships;
      } catch {
        // The authenticated session remains usable while workspace hydration retries on the next route load.
      }
      if (store.get(authTransitionEpochAtom) !== epoch) return false;

      setState(toAuthenticatedState(session, workspaces));
      return true;
    },
    [beginAuthTransition, clearPrivateState, queryClient, setLastWorkspaceId, setState, store],
  );

  return {beginAuthTransition, enterAuthenticated, enterGuest};
}

export function useRefreshAuth() {
  const queryClient = useQueryClient();
  const store = useStore();
  const {beginAuthTransition, enterAuthenticated, enterGuest} = useAuthTransition();

  return useCallback(() => {
    const existingRefresh = refreshPromises.get(queryClient);
    if (existingRefresh) return existingRefresh;

    if (store.get(adoptedSessionAtom) !== null) {
      // The ordinary refresh restores the cookie principal; running it while
      // an adoption is live would desync the adopted token from its metadata
      // and make product requests carry the administrator credential. ADR
      // 0014: the adopted bearer token is the only request credential.
      return Promise.reject(
        new ApiError({
          message: 'The adopted session must end before the ordinary cookie refresh.',
          code: 'unauthorized',
          status: 401,
        }),
      );
    }

    const transitionEpoch = beginAuthTransition();
    const refresh = (async () => {
      try {
        const result = await queryClient.fetchQuery(authRefreshQueryOptions());
        const accepted = await enterAuthenticated(result, transitionEpoch);
        if (!accepted) {
          throw new ApiError({
            message: 'Authentication refresh was superseded.',
            code: 'unauthorized',
            status: 401,
          });
        }
        return result;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await enterGuest(transitionEpoch);
        }
        throw error;
      }
    })();
    refreshPromises.set(queryClient, refresh);
    void refresh.then(
      () => {
        if (refreshPromises.get(queryClient) === refresh) refreshPromises.delete(queryClient);
      },
      () => {
        if (refreshPromises.get(queryClient) === refresh) refreshPromises.delete(queryClient);
      },
    );
    return refresh;
  }, [beginAuthTransition, enterAuthenticated, enterGuest, queryClient, store]);
}

/**
 * The adopted-session runtime seam. An adopted session is an externally minted
 * access-token-only session entered through the ordinary authenticated path;
 * it suspends the cookie-based proactive refresh and runs until its issuer
 * expiry, then asks the renewal supplier or falls back to the cookie.
 *
 * Release is terminal for the tab: it increments an adoption generation before
 * ending the adoption, and a mint or renewal response is adopted only when its
 * generation still matches the current one. Tabs share no adopted token and no
 * release state.
 *
 * The renew timer asks the supplier near the issuer expiry without operator
 * action. ADR 0014 renewal is a deliberate administrator action, so callers
 * gate the supplier on the operator's Extend signal (returning `null`
 * otherwise) to keep every extension deliberate and audited.
 */
export function useAdoptedSession() {
  const store = useStore();
  const queryClient = useQueryClient();
  const {beginAuthTransition, enterAuthenticated, enterGuest} = useAuthTransition();
  const refreshAuth = useRefreshAuth();
  const adoptedSession = useAtomValue(adoptedSessionAtom);

  const endAdoption = useCallback(async () => {
    store.set(adoptionGenerationAtom, store.get(adoptionGenerationAtom) + 1);
    store.set(adoptedRenewalReservationAtom, 0);
    store.set(adoptedSessionAtom, null);
    try {
      await refreshAuth();
    } catch (error) {
      // A superseded restore is not a failure: a newer transition (for
      // example a fresh adoption) already owns the session, and forcing
      // guest would log out that newer session.
      if (error instanceof ApiError && error.message === 'Authentication refresh was superseded.') {
        return;
      }
      // The cookie restore failed (transient network error, or a cookie that
      // died while the adoption suspended the refresh). The adopted token must
      // never remain the ambient request credential after Stop, so fall back
      // to guest instead of leaving the tab under the adopted principal.
      if (store.get(authStateAtom).status !== 'guest') await enterGuest();
    }
  }, [enterGuest, refreshAuth, store]);

  const adoptSession = useCallback(
    async (session: AuthenticatedSession, options: AdoptSessionOptions): Promise<boolean> => {
      // Each adoption starts a new generation: a renewal still in flight from
      // a previous adoption, or a release racing the mint, must not land over
      // the new adoption.
      const generation = store.get(adoptionGenerationAtom) + 1;
      store.set(adoptionGenerationAtom, generation);
      // A fresh adoption must not inherit an expiry reserved by a renewal of
      // the previous adoption whose transition is still in flight.
      store.set(adoptedRenewalReservationAtom, 0);
      const transitionEpoch = beginAuthTransition();
      // The transition supersedes any cookie refresh still in flight; leaving
      // it in the map would make the release fallback reuse a promise that
      // rejects as superseded instead of restoring the cookie session.
      invalidateRefresh(queryClient);
      // The token's server-side lifetime started when it was received; a slow
      // workspace hydration must not push the renewal point past expiresAt.
      // The monotonic clock keeps the elapsed measurement immune to wall-clock
      // steps (NTP correction, VM suspend/resume).
      const receivedAtMs = performance.now();
      const accepted = await enterAuthenticated(session, transitionEpoch);
      if (!accepted || store.get(adoptionGenerationAtom) !== generation) return false;
      store.set(adoptedSessionAtom, {
        generation,
        receivedAtMs,
        session,
        expiresAt: options.expiresAt,
        serverTime: options.serverTime,
        renew: options.renew,
        stalledRenewals: 0,
      });
      return true;
    },
    [beginAuthTransition, enterAuthenticated, queryClient, store],
  );

  const handleNonAdvancingRenewal = useCallback(
    async (
      candidate: RenewalCandidate,
      current: AdoptedSessionRuntimeState,
      adopted: AdoptedSessionRuntimeState,
    ): Promise<void> => {
      const lostRace =
        candidate.valid &&
        (candidate.expiryMs > candidate.currentExpiryMs ||
          candidate.currentExpiryMs > Date.parse(adopted.expiresAt));
      if (candidate.valid && lostRace) return;

      const stalled = {...current, stalledRenewals: current.stalledRenewals + 1};
      store.set(adoptedSessionAtom, stalled);
      if (stalled.stalledRenewals >= ADOPTED_RENEWAL_STALL_LIMIT) await endAdoption();
    },
    [endAdoption, store],
  );

  const adoptRenewalResult = useCallback(
    async ({
      result,
      candidateExpiryMs,
      generation,
      adopted,
    }: {
      result: AdoptedSessionRenewal;
      candidateExpiryMs: number;
      generation: number;
      adopted: AdoptedSessionRuntimeState;
    }): Promise<AdoptedSessionRenewal | null> => {
      const receivedAtMs = performance.now();
      const transitionEpoch = beginAuthTransition();
      invalidateRefresh(queryClient);
      const accepted = await enterAuthenticated(result.session, transitionEpoch);
      if (!accepted || store.get(adoptionGenerationAtom) !== generation) {
        if (store.get(adoptedRenewalReservationAtom) === candidateExpiryMs) {
          store.set(adoptedRenewalReservationAtom, 0);
        }
        return null;
      }
      store.set(adoptedRenewalReservationAtom, 0);
      store.set(adoptedSessionAtom, {
        generation,
        receivedAtMs,
        session: result.session,
        expiresAt: result.expiresAt,
        serverTime: result.serverTime,
        renew: adopted.renew,
        stalledRenewals: 0,
      });
      return result;
    },
    [beginAuthTransition, enterAuthenticated, queryClient, store],
  );

  const renewAdoptedSession = useCallback(async (): Promise<AdoptedSessionRenewal | null> => {
    const adopted = store.get(adoptedSessionAtom);
    if (adopted === null) return null;
    const generation = store.get(adoptionGenerationAtom);

    const result = await requestAdoptedRenewal(adopted);

    // The generation is captured when the request started; a response that
    // resolves after a release is discarded.
    if (store.get(adoptionGenerationAtom) !== generation) return null;
    if (result === null) {
      await endAdoption();
      return null;
    }

    const current = store.get(adoptedSessionAtom);
    if (current === null) return null;
    const candidate = renewalCandidate(result, current, store.get(adoptedRenewalReservationAtom));
    if (!candidate.advancesWindow) {
      await handleNonAdvancingRenewal(candidate, current, adopted);
      return null;
    }
    if (candidate.expiryMs > store.get(adoptedRenewalReservationAtom)) {
      // Reserve the candidate expiry before the asynchronous transition so an
      // overlapping shorter response cannot overwrite the longer token. The
      // reservation lives outside adoptedSessionAtom so this write does not
      // re-run the renew effect while the transition is still pending.
      store.set(adoptedRenewalReservationAtom, candidate.expiryMs);
    }
    return await adoptRenewalResult({
      result,
      candidateExpiryMs: candidate.expiryMs,
      generation,
      adopted,
    });
  }, [adoptRenewalResult, endAdoption, handleNonAdvancingRenewal, store]);

  const releaseAdoptedSession = useCallback(async () => {
    // Always advance the generation and fall back to the cookie: a release
    // while a mint is still entering must still invalidate that mint, or the
    // mint would re-enter the session after Stop.
    await endAdoption();
  }, [endAdoption]);

  return {adoptSession, renewAdoptedSession, releaseAdoptedSession, adoptedSession};
}

export interface AuthRuntimeProps extends PropsWithChildren {
  effects?: boolean;
}

export function AuthRuntime({children, effects = true}: AuthRuntimeProps) {
  const store = useStore();
  const authState = useAtomValue(authStateAtom);
  const refreshAuth = useRefreshAuth();
  const {adoptedSession, renewAdoptedSession, releaseAdoptedSession} = useAdoptedSession();

  useEffect(() => {
    if (!effects) return;
    configureApiClient({
      getAccessToken: () => store.get(authStateAtom).token,
      refreshAccessToken: async () => {
        if (store.get(adoptedSessionAtom) !== null) {
          // A 401 under an adopted token ends the adoption: the cookie
          // refresh restores the cookie's principal, and the renew timer must
          // not resurrect the adopted session afterwards. The falsy result
          // stops the failed request from being re-sent under the restored
          // administrator's principal (ADR 0014: the adopted bearer token is
          // the only request credential).
          await releaseAdoptedSession();
          return undefined;
        }
        return (await refreshAuth()).accessToken;
      },
    });
  }, [effects, refreshAuth, releaseAdoptedSession, store]);

  useEffect(() => {
    if (!effects) return;
    refreshAuth().catch(() => undefined);
  }, [effects, refreshAuth]);

  useEffect(() => {
    if (
      !effects ||
      authState.status !== 'authenticated' ||
      !authState.token ||
      adoptedSession !== null
    ) {
      return;
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let refreshing = false;
    const clearRefreshTimer = () => {
      if (timeout !== undefined) clearTimeout(timeout);
      timeout = undefined;
    };
    const scheduleRefresh = (delayMs: number) => {
      clearRefreshTimer();
      timeout = setTimeout(runRefresh, Math.max(0, delayMs));
    };
    const retryIfStillDue = () => {
      const current = store.get(authStateAtom);
      if (current.status !== 'authenticated' || !current.token) return;
      if (store.get(adoptedSessionAtom) !== null) return;
      const delay = getAuthRefreshDelayMs(current.token);
      if (delay !== undefined && delay <= 0) scheduleRefresh(REFRESH_RETRY_DELAY_MS);
    };
    function runRefresh() {
      if (disposed || refreshing || store.get(adoptedSessionAtom) !== null) return;
      refreshing = true;
      clearRefreshTimer();
      refreshAuth()
        .catch(() => undefined)
        .finally(() => {
          refreshing = false;
          if (!disposed) retryIfStillDue();
        });
    }
    const refreshIfDue = () => {
      const current = store.get(authStateAtom);
      if (current.status !== 'authenticated' || !current.token) return;
      if (store.get(adoptedSessionAtom) !== null) return;
      const delay = getAuthRefreshDelayMs(current.token);
      if (delay !== undefined && delay <= 0) runRefresh();
    };
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') refreshIfDue();
    };
    const delay = getAuthRefreshDelayMs(authState.token);
    if (delay !== undefined) scheduleRefresh(delay);
    window.addEventListener('focus', refreshIfDue);
    window.addEventListener('online', refreshIfDue);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      disposed = true;
      clearRefreshTimer();
      window.removeEventListener('focus', refreshIfDue);
      window.removeEventListener('online', refreshIfDue);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [adoptedSession, authState.status, authState.token, effects, refreshAuth, store]);

  useEffect(() => {
    if (!effects || adoptedSession === null) return;

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let renewing = false;
    let nextFireAtMs = 0;
    const clearRenewTimer = () => {
      if (timeout !== undefined) clearTimeout(timeout);
      timeout = undefined;
    };
    const scheduleRenew = () => {
      clearRenewTimer();
      const current = store.get(adoptedSessionAtom);
      if (current === null) return;
      // The fire point comes from the issuer timestamps; elapsed time is
      // measured on the monotonic clock so a wall-clock step (NTP correction,
      // VM suspend/resume) cannot shift the renewal point.
      const earlyFireAtMs =
        current.receivedAtMs + getAdoptedSessionRenewDelayMs(current.expiresAt, current.serverTime);
      // A missed early point (tab suspended, timer throttled) must renew now
      // instead of waiting for the hard expiry.
      nextFireAtMs = Math.max(earlyFireAtMs, performance.now());
      timeout = setTimeout(runRenew, Math.max(0, nextFireAtMs - performance.now()));
    };
    const runRenew = () => {
      if (disposed || renewing) return;
      renewing = true;
      clearRenewTimer();
      renewAdoptedSession()
        .catch(() => undefined)
        .finally(() => {
          renewing = false;
          // Re-arm when the adoption survived (for example a racing response
          // with an earlier expiry was discarded); the effect re-runs and
          // re-arms when a renewal is adopted instead.
          if (!disposed) scheduleRenew();
        });
    };
    const renewIfDue = () => {
      if (performance.now() >= nextFireAtMs) runRenew();
    };
    const renewIfVisible = () => {
      if (document.visibilityState === 'visible') renewIfDue();
    };
    scheduleRenew();
    window.addEventListener('focus', renewIfDue);
    window.addEventListener('online', renewIfDue);
    document.addEventListener('visibilitychange', renewIfVisible);
    return () => {
      disposed = true;
      clearRenewTimer();
      window.removeEventListener('focus', renewIfDue);
      window.removeEventListener('online', renewIfDue);
      document.removeEventListener('visibilitychange', renewIfVisible);
    };
  }, [adoptedSession, effects, renewAdoptedSession, store]);

  return children;
}
