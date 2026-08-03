type CheckoutSpec = {
  repositoryUrl: string;
  ref: string;
  credentials?: {username: string; token: string; expiresAt: Date} | undefined;
  gitAuthor?: {name: string; email: string} | undefined;
};

import type {CheckoutTokenResponseDto} from '@shipfox/api-workflows-dto';

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
      ? {
          auth: {
            kind: 'basic' as const,
            username: spec.credentials.username,
            token: spec.credentials.token,
            expires_at: spec.credentials.expiresAt.toISOString(),
            carry: 'header' as const,
            host: checkoutHost(spec.repositoryUrl),
            persist: options.persist,
          },
        }
      : {}),
  };
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
