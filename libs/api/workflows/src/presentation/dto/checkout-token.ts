type CheckoutSpec = {
  repositoryUrl: string;
  ref: string;
  credentials?:
    | {
        username: string;
        token: string;
        expiresAt: Date;
        generation?: string | undefined;
        renewal?: {mode: 'refresh-at'; refreshAt: Date} | {mode: 'on-rejection'} | undefined;
      }
    | undefined;
  gitAuthor?: {name: string; email: string} | undefined;
};

import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {CheckoutTokenAuthDto, CheckoutTokenResponseDto} from '@shipfox/api-workflows-dto';

const SCP_LIKE_HOST_RE = /^(?:[^@:/]+@)?([^:/]+):/;

// Defense in depth: createCheckoutSpec's contract is that `repositoryUrl` never
// embeds credentials (they live in `credentials` so redaction can mask them). A
// provider bug that put a token in the URL would bypass redaction and leak it
// into `git remote -v` and logs, so reject it before it reaches the runner.
function assertNoEmbeddedCredentials(repositoryUrl: string): void {
  // Run the scp-style check unconditionally: a genuine scp form
  // (git@host:org/repo.git) fails URL parsing, but a `user:secret@host:path`
  // string parses with a bogus `user:` scheme and *empty* URL userinfo, so the
  // url.username check below would miss its embedded password.
  assertNoScpCredentials(repositoryUrl);

  let url: URL;
  try {
    url = new URL(repositoryUrl);
  } catch {
    return;
  }
  if (url.username || url.password) {
    throw new Error('Checkout repository URL must not embed credentials');
  }
}

// scp-like userinfo is everything before the first `@`, and that `@` precedes
// the first `/`. A bare `git@host:path` user is fine; a `user:secret@host:path`
// password embeds a credential, so reject any colon in the userinfo segment.
function assertNoScpCredentials(repositoryUrl: string): void {
  const atIndex = repositoryUrl.indexOf('@');
  const slashIndex = repositoryUrl.indexOf('/');
  if (atIndex === -1 || (slashIndex !== -1 && atIndex > slashIndex)) {
    return;
  }
  if (repositoryUrl.slice(0, atIndex).includes(':')) {
    throw new Error('Checkout repository URL must not embed credentials');
  }
}

export function toCheckoutTokenDto(
  spec: CheckoutSpec,
  options: {fetchDepth: number; persist: boolean},
): CheckoutTokenResponseDto {
  assertNoEmbeddedCredentials(spec.repositoryUrl);

  // Every provider that returns credentials uses a username (GitHub:
  // 'x-access-token'), so the response is always basic auth; a credential-free
  // spec (debug) omits auth entirely.
  return {
    repository_url: spec.repositoryUrl,
    ref: spec.ref,
    fetch_depth: options.fetchDepth,
    ...(spec.gitAuthor
      ? {git_author: {name: spec.gitAuthor.name, email: spec.gitAuthor.email}}
      : {}),
    ...(spec.credentials
      ? {auth: toCheckoutTokenAuthDto(spec.repositoryUrl, spec.credentials, options.persist)}
      : {}),
  };
}

type CheckoutCredentialResponse = Awaited<
  ReturnType<IntegrationsModuleClient['createCheckoutCredentials']>
>;

/**
 * Keeps the legacy checkout response envelope for a renewal. Renewal callers
 * consume the auth fields, while older protocol clients still require ref and
 * fetch_depth to be present when they parse the shared response shape. Those
 * three envelope fields are compatibility placeholders for renewals; callers
 * must consume auth and must not use them to start another checkout.
 */
export function toCheckoutTokenRenewalDto(
  repositoryUrl: string,
  credentials: CheckoutCredentialResponse,
): CheckoutTokenResponseDto {
  return toCheckoutTokenDto(
    {
      repositoryUrl,
      ref: 'HEAD',
      credentials: {
        username: credentials.username,
        token: credentials.token,
        expiresAt: new Date(credentials.expiresAt),
        ...(credentials.generation === undefined ? {} : {generation: credentials.generation}),
        ...(credentials.renewal === undefined
          ? {}
          : {
              renewal:
                credentials.renewal.mode === 'refresh-at'
                  ? {
                      mode: 'refresh-at' as const,
                      refreshAt: new Date(credentials.renewal.refreshAt),
                    }
                  : {mode: 'on-rejection' as const},
            }),
      },
    },
    {fetchDepth: 1, persist: true},
  );
}

type CheckoutCredentials = NonNullable<CheckoutSpec['credentials']>;

function toCheckoutTokenAuthDto(
  repositoryUrl: string,
  credentials: CheckoutCredentials,
  persist: boolean,
): CheckoutTokenAuthDto {
  const auth: CheckoutTokenAuthDto = {
    kind: 'basic',
    username: credentials.username,
    token: credentials.token,
    expires_at: credentials.expiresAt.toISOString(),
    carry: 'header',
    host: checkoutHost(repositoryUrl),
    persist,
  };

  if (credentials.generation !== undefined) auth.generation = credentials.generation;
  if (credentials.renewal !== undefined) {
    auth.renewal = toCheckoutTokenRenewalLifecycleDto(credentials.renewal);
  }

  return auth;
}

function toCheckoutTokenRenewalLifecycleDto(renewal: CheckoutCredentials['renewal']) {
  if (renewal === undefined) return undefined;
  if (renewal.mode === 'refresh-at') {
    return {mode: 'refresh-at' as const, refresh_at: renewal.refreshAt.toISOString()};
  }
  return {mode: 'on-rejection' as const};
}

function checkoutHost(repositoryUrl: string): string {
  try {
    const host = new URL(repositoryUrl).host;
    if (host) return host;
  } catch {
    // Fall through to scp-like parsing.
  }

  const scpLike = SCP_LIKE_HOST_RE.exec(repositoryUrl);
  if (scpLike?.[1]) return scpLike[1];

  throw new Error('Checkout repository URL must include a host');
}
