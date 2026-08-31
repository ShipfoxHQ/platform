const TRAILING_SLASHES_RE = /\/+$/;
const SCP_LIKE_RE = /^(?:[^@:/]+@)?[^:/]+:.+$/u;

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
    if (SCP_LIKE_RE.test(value)) {
      return value.replace(TRAILING_SLASHES_RE, '');
    }
    throw new Error('Checkout repository URL must be valid');
  }
}
