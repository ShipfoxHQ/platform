import {CheckoutRepositoryUrlInvalidError} from '../errors.js';

const TRAILING_SLASHES_RE = /\/+$/;
const TERMINAL_GIT_SUFFIX_RE = /\.git$/u;
const QUERY_FRAGMENT_RE = /[?#].*$/u;
const SCP_LIKE_RE = /^(?:(?<user>[^@:/]+)@)?(?<host>[^:/]+):(?<path>.+)$/u;
const DEFAULT_PORTS = new Map([
  ['http:', '80'],
  ['https:', '443'],
  ['ftp:', '21'],
  ['ws:', '80'],
  ['wss:', '443'],
  ['ssh:', '22'],
  ['git:', '9418'],
]);

export interface CheckoutRenewalSubject {
  repositoryUrl: string;
  connectionId: string;
  externalRepositoryId: string;
  permissions: {contents: 'read' | 'write'};
  stepId: string;
  attempt: number;
}

/**
 * Canonicalizes the provider URL before it becomes the authority used for a later delivery.
 * Query parameters and fragments are not repository identity and must not make two subjects differ.
 */
export function normalizeRepositoryUrl(repositoryUrl: string): string {
  const value = repositoryUrl.trim();
  if (hasScpEmbeddedCredentials(value)) {
    throw new CheckoutRepositoryUrlInvalidError('credentials');
  }
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      throw new CheckoutRepositoryUrlInvalidError('credentials');
    }
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    if (url.port === DEFAULT_PORTS.get(url.protocol)) url.port = '';
    url.search = '';
    url.hash = '';
    url.pathname = normalizeRepositoryPath(url.pathname);
    if (url.pathname === '/') throw new CheckoutRepositoryUrlInvalidError('invalid');
    return url.toString();
  } catch (error) {
    if (error instanceof CheckoutRepositoryUrlInvalidError) throw error;
    return normalizeScpLikeRepositoryUrl(value);
  }
}

function normalizeScpLikeRepositoryUrl(value: string): string {
  const scpLike = value.match(SCP_LIKE_RE);
  if (scpLike?.groups === undefined) {
    throw new CheckoutRepositoryUrlInvalidError('invalid');
  }
  const {host, path, user: scpUser} = scpLike.groups;
  if (host === undefined || path === undefined) {
    throw new CheckoutRepositoryUrlInvalidError('invalid');
  }
  const normalizedPath = normalizeRepositoryPath(`/${path.replace(QUERY_FRAGMENT_RE, '')}`);
  if (normalizedPath === '/') throw new CheckoutRepositoryUrlInvalidError('invalid');
  const user = scpUser === undefined ? '' : `${scpUser.toLowerCase()}@`;
  return `${user}${host.toLowerCase()}:${normalizedPath.slice(1)}`;
}

function hasScpEmbeddedCredentials(value: string): boolean {
  const firstAt = value.indexOf('@');
  const firstColon = value.indexOf(':');
  const firstSlash = value.indexOf('/');
  return firstColon !== -1 && firstAt > firstColon && (firstSlash === -1 || firstAt < firstSlash);
}

function normalizeRepositoryPath(pathname: string): string {
  const withoutTrailingSlash = pathname.replace(TRAILING_SLASHES_RE, '') || '/';
  if (withoutTrailingSlash === '/') return withoutTrailingSlash;
  const withoutGitSuffix = withoutTrailingSlash.replace(TERMINAL_GIT_SUFFIX_RE, '');
  return withoutGitSuffix || '/';
}
