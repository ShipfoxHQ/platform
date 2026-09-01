export type SvgPolicyRejection = 'unsafe_svg' | 'external_resource';

const UNSAFE_SVG_TOKEN =
  /<\s*!\s*(?:doctype|entity)\b|<\s*(?:[\w.-]+:)?(?:script|foreignobject)\b/i;
const RESOURCE_ATTRIBUTE = /(?:^|[\s:])(?:href|src)\s*=\s*(["'])([\s\S]*?)\1/gi;
const CSS_URL = /\burl\s*\(\s*(["']?)([\s\S]*?)\1\s*\)/gi;

/**
 * Applies the cheap, deterministic SVG policy checks before bytes enter the renderer.
 * Resource references are rejected conservatively; only same-document fragments are allowed.
 */
export function inspectSvgPolicy(source: Uint8Array): SvgPolicyRejection | undefined {
  const text = new TextDecoder().decode(source);
  if (UNSAFE_SVG_TOKEN.test(text)) return 'unsafe_svg';

  RESOURCE_ATTRIBUTE.lastIndex = 0;
  for (const match of text.matchAll(RESOURCE_ATTRIBUTE)) {
    if (isExternalReference(match[2])) return 'external_resource';
  }

  CSS_URL.lastIndex = 0;
  for (const match of text.matchAll(CSS_URL)) {
    if (isExternalReference(match[2])) return 'external_resource';
  }

  return undefined;
}

function isExternalReference(value: string | undefined): boolean {
  const reference = value?.trim();
  return reference !== undefined && reference.length > 0 && !reference.startsWith('#');
}
