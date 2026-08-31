const TRAILING_SLASHES_RE = /\/+$/;
const QUERY_FRAGMENT_RE = /[?#].*$/u;
const SCP_LIKE_RE = /^(?:(?<user>[^@:/]+)@)?(?<host>[^:/]+):(?<path>.+)$/u;

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
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      throw new Error('Checkout repository URL must not embed credentials');
    }
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(TRAILING_SLASHES_RE, '') || '/';
    return url.toString();
  } catch (error) {
    if (error instanceof Error && error.message.includes('must not embed credentials')) {
      throw error;
    }
    return normalizeScpLikeRepositoryUrl(value);
  }
}

function normalizeScpLikeRepositoryUrl(value: string): string {
  const scpLike = value.match(SCP_LIKE_RE);
  if (scpLike?.groups === undefined) {
    throw new Error('Checkout repository URL must be valid');
  }
  const {host, path, user: scpUser} = scpLike.groups;
  if (host === undefined || path === undefined) {
    throw new Error('Checkout repository URL must be valid');
  }
  const normalizedPath = path.replace(QUERY_FRAGMENT_RE, '').replace(TRAILING_SLASHES_RE, '');
  if (normalizedPath.length === 0) throw new Error('Checkout repository URL must be valid');
  const user = scpUser === undefined ? '' : `${scpUser.toLowerCase()}@`;
  return `${user}${host.toLowerCase()}:${normalizedPath}`;
}
