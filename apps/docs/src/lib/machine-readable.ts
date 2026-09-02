import type {LLMsOptions} from 'fumadocs-core/mdx-plugins';
import {canonicalDocsOrigin} from './canonical-docs-origin';
import {
  type CatalogProvider,
  catalogCapabilityLabels,
  catalogCategoryLabels,
} from './integration-catalog';
import {inlineCode, tableValue} from './markdown';

const INTERNAL_DOC_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  'shipfox.io',
  'www.shipfox.io',
  'shipfox-docs.vercel.app',
]);
const FENCE_OPEN_PATTERN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE_PATTERN = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const UNRESOLVED_MDX_COMPONENT_PATTERN = /<\/?[A-Z][A-Za-z0-9]*(?:\s[^<>]*)?\/?>(?:\s|$)/m;
const ROOT_RELATIVE_LINK_PATTERN = /\]\(\s*\//;
const ROOT_RELATIVE_ATTRIBUTE_PATTERN = /\b(?:href|src)=(['"])\//;
const PREVIEW_DOC_URL_PATTERN =
  /https?:\/\/(?:[^/\s]+\.vercel\.app|localhost(?::\d+)?|127\.0\.0\.1(?::\d+)?)(?:\/|$)/;
const NON_CANONICAL_SHIPFOX_URL_PATTERN =
  /https?:\/\/(?:www\.)?shipfox\.io\/(?!docs(?:[/?#\s)\]"'<>.,;:]|$))/;
const UNUSABLE_IMAGE_SOURCE_PATTERN = /__img\d+/;
const UNUSABLE_MDX_IMAGE_PATTERN =
  /<img\b(?=[^>]*\bsrc\s*=\s*(?:["']__img\d+["']|\{__img\d+\}))[^>]*\/?>/gi;
const UNUSABLE_MARKDOWN_IMAGE_PATTERN = /!\[([^\]]*)\]\(\s*<?__img\d+[^)]*\)?/gi;
const MARKDOWN_LINK_DESTINATION_PATTERN = /(\]\(\s*)(<[^>\n]+>|[^)\s]+)([^)\n]*\))/g;
const HTML_ATTRIBUTE_PATTERN = /\b(src|href)=(['"])([^'"]+)\2/g;
const STEP_TITLE_PATTERN = /^\*\*(.*)\*\*$/s;
const ALT_ATTRIBUTE_PATTERN = /\balt=(['"])(.*?)\1/i;

type FenceCharacter = '`' | '~';

interface FenceMarker {
  character: FenceCharacter;
  length: number;
}

export interface MachineReadableMarkdownOptions {
  integrationCatalog?: readonly CatalogProvider[];
  pageUrl?: string;
  requiredFacts?: readonly string[];
  sourcePath?: string;
}

export function canonicalDocsUrl(pageUrl: string): string {
  return canonicalizeDocumentationUrl(pageUrl);
}

export function canonicalizeDocumentationUrl(destination: string, pageUrl?: string): string {
  const value = destination.trim();
  if (!value || value.startsWith('//')) {
    return destination;
  }

  if (value.startsWith('#') || value.startsWith('?')) {
    return pageUrl ? `${canonicalDocsUrl(pageUrl)}${value}` : destination;
  }

  if (value.startsWith('/')) return canonicalPath(value);

  let parsed: URL;
  try {
    parsed = pageUrl ? new URL(value, canonicalDocsUrl(pageUrl)) : new URL(value);
  } catch {
    return destination;
  }

  if (!isInternalDocumentationHost(parsed.hostname)) return destination;
  if (!isCanonicalDocumentationPath(parsed.pathname)) return destination;
  return canonicalPath(`${parsed.pathname}${parsed.search}${parsed.hash}`);
}

export function serializeIntegrationCatalog(providers: readonly CatalogProvider[]): string {
  const sections = providers.map((provider) => {
    const events = provider.eventCount
      ? `${provider.eventCount} ([event catalog](/integrations/${provider.slug}/events))`
      : '0';
    const tools = provider.toolCount
      ? `${provider.toolCount} ([tool catalog](/integrations/${provider.slug}/tools))`
      : '0';

    return [
      `### ${provider.name}`,
      '',
      provider.summary,
      '',
      '| Field | Value |',
      '|---|---|',
      `| Slug | ${inlineCode(provider.slug)} |`,
      `| Icon | ${inlineCode(provider.icon)} |`,
      `| Capabilities | ${tableValue(provider.capabilities.map((value) => catalogCapabilityLabels[value]).join(', '))} |`,
      `| Categories | ${tableValue(provider.categories.map((value) => catalogCategoryLabels[value]).join(', '))} |`,
      `| Aliases | ${tableValue(provider.aliases.map(inlineCode).join(', '))} |`,
      `| Events | ${tableValue(events)} |`,
      `| Agent tools | ${tableValue(tools)} |`,
      `| Overview | ${tableValue(`[${provider.name}](${provider.overviewHref})`)} |`,
      `| Setup | ${tableValue(provider.setupHref ? `[Connect ${provider.name}](${provider.setupHref})` : 'Not available')} |`,
    ].join('\n');
  });

  return [
    '## Integration catalog',
    '',
    'Every integration listed here is available in the documentation and carries the capabilities, event, and agent-tool facts shown below.',
    '',
    sections.join('\n\n'),
  ].join('\n');
}

export function serializeMachineReadableMarkdown(
  markdown: string,
  options: MachineReadableMarkdownOptions = {},
): string {
  let serialized = replacePlaceholders(markdown, options.integrationCatalog);
  serialized = replaceUnusableImages(serialized);
  serialized = rewriteMachineReadableLinks(serialized, options.pageUrl);
  assertMachineReadableMarkdown(serialized, options);
  return serialized.trim();
}

export function rewriteMachineReadableLinks(markdown: string, pageUrl?: string): string {
  let fence: FenceMarker | undefined;

  return markdown
    .split('\n')
    .map((line) => {
      const marker = fenceMarker(line);
      if (!fence && marker) {
        fence = marker;
        return line;
      }
      if (fence && closesFence(line, fence)) {
        fence = undefined;
        return line;
      }
      return fence ? line : rewriteMachineReadableLine(line, pageUrl);
    })
    .join('\n');
}

export function assertMachineReadableMarkdown(
  markdown: string,
  {pageUrl, requiredFacts = [], sourcePath}: MachineReadableMarkdownOptions = {},
): void {
  const document = withoutFencedCode(markdown);
  const label = pageLabel(pageUrl, sourcePath);
  const page = label ? ` for ${label}` : '';

  if (markdown.includes('\0'))
    throw new Error(
      `Machine-readable Markdown${page} contains an unresolved component placeholder.`,
    );

  const unresolvedComponent = document.match(UNRESOLVED_MDX_COMPONENT_PATTERN)?.[0];
  if (unresolvedComponent) {
    throw new Error(
      `Machine-readable Markdown${page} contains an unresolved MDX component: ${unresolvedComponent}`,
    );
  }

  if (ROOT_RELATIVE_LINK_PATTERN.test(document) || ROOT_RELATIVE_ATTRIBUTE_PATTERN.test(document)) {
    throw new Error(`Machine-readable Markdown${page} contains a root-relative link or media URL.`);
  }

  assertCanonicalUrls(document, pageUrl, page);

  if (UNUSABLE_IMAGE_SOURCE_PATTERN.test(document)) {
    throw new Error(`Machine-readable Markdown${page} contains an unusable image source.`);
  }

  for (const fact of requiredFacts) {
    if (!markdown.includes(fact)) {
      throw new Error(`Machine-readable Markdown${page} is missing generated fact: ${fact}`);
    }
  }
}

type StringifyCallback = NonNullable<LLMsOptions['stringify']>;
type StringifyNode = Parameters<StringifyCallback>[0];
type StringifyState = Parameters<StringifyCallback>[2];
type StringifyInfo = Parameters<StringifyCallback>[3];
type FlowParent = Parameters<StringifyState['containerFlow']>[0];
type PhrasingParent = Parameters<StringifyState['containerPhrasing']>[0];

interface MdxAttribute {
  type: string;
  name: string;
  value: unknown;
}

interface MdxElementNode {
  type: 'mdxJsxFlowElement' | 'mdxJsxTextElement';
  name: string | null;
  attributes: MdxAttribute[];
  children: StringifyNode[];
}

export const stringifyMachineReadableComponent: StringifyCallback = (
  node,
  _parent,
  state,
  info,
) => {
  if (!isMdxElement(node)) return undefined;

  switch (node.name) {
    case 'Callout':
      return blockquote(
        childrenMarkdown(node, state, info),
        calloutLabel(attributeValue(node, 'title'), attributeValue(node, 'type')),
      );
    case 'Steps':
    case 'Cards':
    case 'Accordions':
    case 'Tabs':
    case 'Frame':
      return childrenMarkdown(node, state, info);
    case 'Card':
      return titledBlock(
        attributeValue(node, 'title'),
        attributeValue(node, 'href'),
        childrenMarkdown(node, state, info),
        '###',
      );
    case 'Accordion':
      return titledBlock(
        attributeValue(node, 'title'),
        undefined,
        childrenMarkdown(node, state, info),
        '###',
      );
    case 'Step':
      return stepMarkdown(node, state, info);
    case 'Tab':
      return titledBlock(
        attributeValue(node, 'title') ?? attributeValue(node, 'label'),
        undefined,
        childrenMarkdown(node, state, info),
        '####',
      );
    default:
      return undefined;
  }
};

function replacePlaceholders(markdown: string, providers?: readonly CatalogProvider[]): string {
  return markdown.replace(/\0([\s\S]*?)\0/g, (_match, value: string) => {
    let placeholder: unknown;
    try {
      placeholder = JSON.parse(value);
    } catch {
      throw new Error('Machine-readable Markdown contains an invalid component placeholder.');
    }

    if (!isPlaceholder(placeholder)) {
      throw new Error('Machine-readable Markdown contains an invalid component placeholder.');
    }

    if (placeholder.name === 'IntegrationCatalog') {
      if (!providers) {
        throw new Error('Integration catalog data is unavailable for machine-readable Markdown.');
      }
      return serializeIntegrationCatalog(providers);
    }

    throw new Error(
      `Machine-readable Markdown contains an unresolved component placeholder: ${placeholder.name}`,
    );
  });
}

function replaceUnusableImages(markdown: string): string {
  const withMdxImages = markdown.replace(UNUSABLE_MDX_IMAGE_PATTERN, (tag) =>
    imageDescription(tag),
  );

  return withMdxImages.replace(UNUSABLE_MARKDOWN_IMAGE_PATTERN, (_match, alt: string) => {
    return imageDescription(alt ? `alt="${alt}"` : '');
  });
}

function rewriteMachineReadableLine(line: string, pageUrl?: string): string {
  const withLinks = line.replace(
    MARKDOWN_LINK_DESTINATION_PATTERN,
    (_match, prefix: string, destination: string, suffix: string) => {
      const wrapped = destination.startsWith('<') && destination.endsWith('>');
      const value = wrapped ? destination.slice(1, -1) : destination;
      const rewritten = canonicalizeDocumentationUrl(value, pageUrl);
      return `${prefix}${wrapped ? `<${rewritten}>` : rewritten}${suffix}`;
    },
  );

  return withLinks.replace(
    HTML_ATTRIBUTE_PATTERN,
    (_match, name: string, quote: string, destination: string) =>
      `${name}=${quote}${canonicalizeDocumentationUrl(destination, pageUrl)}${quote}`,
  );
}

function canonicalPath(value: string): string {
  const url = new URL(value, `${canonicalDocsOrigin}/`);
  let pathname = url.pathname;
  if (pathname === '/docs') pathname = '/';
  else if (pathname.startsWith('/docs/')) pathname = pathname.slice('/docs'.length);

  return `${canonicalDocsOrigin}${pathname === '/' ? '' : pathname}${url.search}${url.hash}`;
}

function isInternalDocumentationHost(hostname: string): boolean {
  return INTERNAL_DOC_HOSTS.has(hostname);
}

function pageLabel(pageUrl?: string, sourcePath?: string): string {
  if (sourcePath && pageUrl) return `${sourcePath} (${pageUrl})`;
  return sourcePath || pageUrl || '';
}

function assertCanonicalUrls(document: string, pageUrl: string | undefined, page: string): void {
  const values = [pageUrl ?? '', document];
  if (values.some((value) => PREVIEW_DOC_URL_PATTERN.test(value))) {
    throw new Error(`Machine-readable Markdown${page} contains a preview or local docs URL.`);
  }
  if (values.some((value) => NON_CANONICAL_SHIPFOX_URL_PATTERN.test(value))) {
    throw new Error(`Machine-readable Markdown${page} contains a non-canonical Shipfox URL.`);
  }
}

function isCanonicalDocumentationPath(pathname: string): boolean {
  return pathname === '/docs' || pathname.startsWith('/docs/');
}

function withoutFencedCode(markdown: string): string {
  let fence: FenceMarker | undefined;
  return markdown
    .split('\n')
    .filter((line) => {
      const marker = fenceMarker(line);
      if (!fence && marker) {
        fence = marker;
        return false;
      }
      if (fence && closesFence(line, fence)) {
        fence = undefined;
        return false;
      }
      return !fence;
    })
    .join('\n');
}

function fenceMarker(line: string): FenceMarker | undefined {
  const marker = line.match(FENCE_OPEN_PATTERN)?.[1];
  if (!marker) return undefined;
  return {
    character: marker[0] as FenceCharacter,
    length: marker.length,
  };
}

function closesFence(line: string, fence: FenceMarker): boolean {
  const marker = fenceMarker(line);
  return Boolean(
    marker &&
      FENCE_CLOSE_PATTERN.test(line) &&
      marker.character === fence.character &&
      marker.length >= fence.length,
  );
}

function childrenMarkdown(
  node: MdxElementNode,
  state: StringifyState,
  info: StringifyInfo,
): string {
  return state.containerFlow({type: 'root', children: node.children} as FlowParent, info).trim();
}

function titledBlock(
  title: string | undefined,
  href: string | undefined,
  content: string,
  level: string,
): string {
  const cleanTitle = title?.trim().replace(/\s+/g, ' ');
  let heading: string | undefined;
  if (cleanTitle) {
    heading = href
      ? `${level} [${cleanTitle.replaceAll(']', '\\]')}](${href})`
      : `${level} ${cleanTitle}`;
  }

  return [heading, content].filter(Boolean).join('\n\n');
}

function stepMarkdown(node: MdxElementNode, state: StringifyState, info: StringifyInfo): string {
  const first = node.children[0];
  if (first?.type !== 'paragraph' || first.children.length !== 1) {
    return childrenMarkdown(node, state, info);
  }

  const onlyChild = first.children[0];
  if (onlyChild?.type !== 'strong') return childrenMarkdown(node, state, info);

  const title = state
    .containerPhrasing(first as PhrasingParent, info)
    .replace(STEP_TITLE_PATTERN, '$1')
    .trim();
  const content = state
    .containerFlow({type: 'root', children: node.children.slice(1)} as FlowParent, info)
    .trim();
  return [`### ${title}`, content].filter(Boolean).join('\n\n');
}

function blockquote(content: string, label?: string): string {
  const lines = content ? content.split('\n') : [];
  if (label) lines.unshift(`**${label}**`);
  if (lines.length === 0) return label ? `> **${label}**` : '';
  return lines.map((line) => (line ? `> ${line}` : '>')).join('\n');
}

function calloutLabel(title?: string, type?: string): string | undefined {
  const cleanTitle = title?.trim();
  const cleanType = type?.trim();
  if (cleanTitle && cleanType) return `${cleanTitle} (${cleanType})`;
  return cleanTitle || cleanType;
}

function attributeValue(node: MdxElementNode, name: string): string | undefined {
  const attribute = node.attributes.find(
    (item) => item.type === 'mdxJsxAttribute' && item.name === name,
  );
  return attribute && typeof attribute.value === 'string' ? attribute.value : undefined;
}

function imageDescription(tag: string): string {
  const alt = ALT_ATTRIBUTE_PATTERN.exec(tag)?.[2]?.trim();
  return alt ? `[Image: ${alt}]` : '[Image]';
}

function isMdxElement(node: StringifyNode): node is StringifyNode & MdxElementNode {
  return node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement';
}

function isPlaceholder(value: unknown): value is {name: string} {
  return (
    typeof value === 'object' && value !== null && 'name' in value && typeof value.name === 'string'
  );
}
