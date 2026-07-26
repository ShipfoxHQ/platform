import {
  AUTH_LEASED_JOB,
  AUTH_RUNNER_SESSION,
  setLeasedJobContext,
  setRunnerSessionContext,
} from '@shipfox/api-auth-context';
import {
  JOB_LEASE_TOKEN_AUDIENCE,
  type JobLeaseTokenClaims,
  RUNNER_SESSION_TOKEN_AUDIENCE,
  type RunnerSessionTokenClaims,
} from '@shipfox/api-auth-dto';
import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import {type AuthMethod, ClientError, extractBearerToken} from '@shipfox/node-fastify';

const leaseClaims = new Map<string, JobLeaseTokenClaims>();
const sessionClaims = new Map<string, RunnerSessionTokenClaims>();

function opaqueToken(): string {
  return `test-auth-${crypto.randomUUID()}`;
}

export function mintLeaseToken(claims: Omit<JobLeaseTokenClaims, 'aud' | 'iat' | 'exp'>): string {
  const token = opaqueToken();
  leaseClaims.set(token, {
    ...claims,
    aud: JOB_LEASE_TOKEN_AUDIENCE,
    iat: 0,
    exp: Number.MAX_SAFE_INTEGER,
  });
  return token;
}

export function mintRunnerSessionToken(
  claims: Omit<RunnerSessionTokenClaims, 'aud' | 'iat' | 'exp'>,
): string {
  const token = opaqueToken();
  sessionClaims.set(token, {
    ...claims,
    aud: RUNNER_SESSION_TOKEN_AUDIENCE,
    iat: 0,
    exp: Number.MAX_SAFE_INTEGER,
  });
  return token;
}

export function getLeaseTokenClaims(token: string): JobLeaseTokenClaims | undefined {
  return leaseClaims.get(token);
}

export function getRunnerSessionTokenClaims(token: string): RunnerSessionTokenClaims | undefined {
  return sessionClaims.get(token);
}

function requireClaims<T>(claims: Map<string, T>, authorization: string | undefined): T {
  const token = extractBearerToken(authorization);
  const context = token ? claims.get(token) : undefined;
  if (!context) throw new ClientError('Authentication required', 'unauthorized', {status: 401});
  return context;
}

export const fakeLeaseTokenAuthMethod: AuthMethod = {
  name: AUTH_LEASED_JOB,
  authenticate: (request) => {
    setLeasedJobContext(request, requireClaims(leaseClaims, request.headers.authorization));
    return Promise.resolve();
  },
};

export const fakeRunnerSessionAuthMethod: AuthMethod = {
  name: AUTH_RUNNER_SESSION,
  authenticate: (request) => {
    setRunnerSessionContext(request, requireClaims(sessionClaims, request.headers.authorization));
    return Promise.resolve();
  },
};

export const runnersTestAuthClient: AuthInterModuleClient = {
  mintRunnerSessionToken(claims) {
    return Promise.resolve({token: mintRunnerSessionToken(claims)});
  },
  mintJobLeaseToken(claims) {
    return Promise.resolve({token: mintLeaseToken(claims)});
  },
  getCurrentAdminRole() {
    return Promise.resolve({role: null});
  },
  requireAdminRole(_input) {
    return Promise.reject(
      new Error('Administrator role checks are not configured in runner tests'),
    );
  },
};
