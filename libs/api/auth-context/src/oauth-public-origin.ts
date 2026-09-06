export class InvalidOAuthPublicOriginError extends Error {
  constructor() {
    super('OAuth public origin is invalid');
    this.name = 'InvalidOAuthPublicOriginError';
  }
}

export function isOAuthLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

export function hasOAuthControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 0x20 || codePoint === 0x7f;
  });
}

/** Normalizes an OAuth public origin and rejects unsafe URL shapes. */
export function normalizeOAuthPublicOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return rejectInvalidOAuthPublicOrigin();
  }

  if (
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && isOAuthLoopbackHostname(url.hostname))) ||
    value.trim() !== value ||
    hasOAuthControlCharacter(value) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.hostname.length === 0
  ) {
    return rejectInvalidOAuthPublicOrigin();
  }
  return url.origin;
}

function rejectInvalidOAuthPublicOrigin(): never {
  throw new InvalidOAuthPublicOriginError();
}
