export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LOWERCASE_ALPHA_SLUG_RE = /^[a-z][a-z0-9_-]*$/;
export const ALNUM_SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/i;
export const LOWERCASE_SHA256_HEX_RE = /^[0-9a-f]{64}$/;
/**
 * Display names appear in UI, logs, and emails, so hidden control and
 * bidi/zero-width format characters must be rejected before they can spoof or
 * corrupt output.
 */
export const DISPLAY_NAME_DISALLOWED_CHARACTER_RE = /[\p{Cc}\p{Cf}]/u;

export interface ShipfoxTokenPrefixRegexes {
  unqualified: RegExp;
  qualified: RegExp;
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function isLowercaseAlphaSlug(value: string): boolean {
  return LOWERCASE_ALPHA_SLUG_RE.test(value);
}

export function isAlnumSlug(value: string): boolean {
  return ALNUM_SLUG_RE.test(value);
}

export function isLowercaseSha256Hex(value: string): boolean {
  return LOWERCASE_SHA256_HEX_RE.test(value);
}

export function hasDisplayNameDisallowedCharacter(value: string): boolean {
  return DISPLAY_NAME_DISALLOWED_CHARACTER_RE.test(value);
}

export function isSafeRefInput(value: string): boolean {
  return [...value].every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return !(code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029);
  });
}

export function createShipfoxTokenPrefixRegexes(
  tokenTypeParts: ReadonlyArray<string>,
): ShipfoxTokenPrefixRegexes {
  const tokenTypeAlternation = tokenTypeParts.map(escapeRegExpLiteral).join('|');
  if (!tokenTypeAlternation) {
    throw new Error('At least one Shipfox token type part is required');
  }

  return {
    unqualified: new RegExp(`^sf_(${tokenTypeAlternation})_`, 'u'),
    qualified: new RegExp(`^sf_([a-z0-9-]+)_(${tokenTypeAlternation})_`, 'u'),
  };
}

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&');
}
