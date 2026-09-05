export type SvgPolicyRejection = 'unsafe_svg' | 'external_resource';

const UNSAFE_SVG_TOKEN =
  /<\s*!\s*(?:doctype|entity)\b|<\s*(?:[^\s:<>/]+:)?(?:script|foreignobject)\b/i;
const RESOURCE_ATTRIBUTE = /(?:^|[\s:])(?:href|src)\s*=\s*(["'])([\s\S]*?)\1/gi;
const CSS_URL_START = /\burl\s*\(/gi;

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

  CSS_URL_START.lastIndex = 0;
  while (true) {
    const match = CSS_URL_START.exec(text);
    if (match === null) break;
    const closeIndex = cssUrlEnd(text, CSS_URL_START.lastIndex);
    if (closeIndex < 0) return 'external_resource';
    if (isExternalReference(cssReference(text.slice(CSS_URL_START.lastIndex, closeIndex)))) {
      return 'external_resource';
    }
    CSS_URL_START.lastIndex = closeIndex + 1;
  }

  return undefined;
}

function cssUrlEnd(text: string, start: number): number {
  let quote: '"' | "'" | undefined;
  let nestedParentheses = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (quote !== undefined) {
      quote = nextCssQuote(char, quote);
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') {
      nestedParentheses += 1;
      continue;
    }
    if (char !== ')') continue;
    if (nestedParentheses === 0) return index;
    nestedParentheses -= 1;
  }
  return -1;
}

function nextCssQuote(char: string, quote: '"' | "'"): '"' | "'" | undefined {
  return char === quote ? undefined : quote;
}

function isExternalReference(value: string | undefined): boolean {
  const reference = value?.trim();
  return reference !== undefined && reference.length > 0 && !reference.startsWith('#');
}

function cssReference(value: string): string {
  const reference = value.trim();
  const first = reference[0];
  const last = reference.at(-1);
  if (
    reference.length >= 2 &&
    ((first === '"' && last === '"') || (first === "'" && last === "'"))
  ) {
    return reference.slice(1, -1).trim();
  }
  return reference;
}
