const REDIRECT_ORIGIN = 'https://shipfox-redirect.invalid';
const LOGIN_PATH = '/auth/login';
const INVITATION_ACCEPT_PATH = '/invitations/accept';
const DEFAULT_LOGOUT_REDIRECT = LOGIN_PATH;
const TRAILING_SLASHES = /\/+$/;
const MAX_PATH_DECODE_ITERATIONS = 10;

export interface ResolvedRedirectPath {
  pathname: string;
  redirect: string;
  target: URL;
}

// Repeated decoding can reveal `.`/`..` segments or a `//host` prefix that were
// hidden behind extra encoding layers (e.g. `%25252e%25252e` -> `..`). Those only
// get collapsed and re-checked against the origin by feeding the fully-decoded,
// percent-free string back through the URL parser; without this, a multiply
// encoded `/safe/../auth/login` or `/safe/../invitations/accept?token=...`
// evades the pathname checks below even though this loop "sees" the real path.
function decodePathToFixedPoint(pathname: string): string | undefined {
  let current = pathname;

  for (let iteration = 0; iteration < MAX_PATH_DECODE_ITERATIONS; iteration += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return undefined;
    }
    if (decoded === current) return current;
    current = decoded;
  }

  return undefined;
}

export function resolveRedirectPath(value: unknown): ResolvedRedirectPath | undefined {
  if (typeof value !== 'string' || !value.startsWith('/')) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return undefined;
  }
  let target: URL;
  try {
    target = new URL(decoded, REDIRECT_ORIGIN);
  } catch {
    return undefined;
  }
  if (target.origin !== REDIRECT_ORIGIN) return undefined;
  const decodedPathname = decodePathToFixedPoint(target.pathname);
  if (decodedPathname === undefined) return undefined;
  let canonical: URL;
  try {
    canonical = new URL(decodedPathname, REDIRECT_ORIGIN);
  } catch {
    return undefined;
  }
  if (canonical.origin !== REDIRECT_ORIGIN) return undefined;
  return {pathname: canonical.pathname, redirect: formatRedirectPath(target), target};
}

function formatRedirectPath(target: URL): string {
  return `${target.pathname}${target.search}${target.hash}`;
}

export function isAuthPath(pathname: string): boolean {
  return pathname === '/auth' || pathname.startsWith('/auth/');
}

// Resolves and canonicalizes an internal path before returning it, so browser URL
// parsing cannot turn a seemingly safe path into an external or auth route.
export function sanitizeRedirectPath(value: unknown): string | undefined {
  const resolved = resolveRedirectPath(value);
  if (!resolved || isAuthPath(resolved.pathname)) return undefined;
  return resolved.redirect;
}

function containsInvitationToken(target: URL, pathname: string): boolean {
  const normalizedPathname = pathname.replace(TRAILING_SLASHES, '') || '/';
  return normalizedPathname === INVITATION_ACCEPT_PATH && target.searchParams.has('token');
}

/**
 * Returns the destination used by the shared logout route.
 *
 * Login is the only auth destination allowed, and invitation tokens never
 * survive this boundary. Invalid values fail closed to login.
 */
export function sanitizeLogoutRedirectPath(value: unknown): string {
  const resolved = resolveRedirectPath(value);
  if (!resolved) return DEFAULT_LOGOUT_REDIRECT;
  if (
    isAuthPath(resolved.pathname) ||
    containsInvitationToken(resolved.target, resolved.pathname)
  ) {
    return DEFAULT_LOGOUT_REDIRECT;
  }
  return resolved.redirect;
}
