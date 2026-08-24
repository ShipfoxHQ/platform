import type {CatalogCapability} from '@/lib/integration-catalog';
import type {RegisteredIntegrationProvider} from '@/lib/registered-integration-providers';

export interface GeneratedIntegrationCatalogEntry {
  capabilities: readonly CatalogCapability[];
  eventCount: number;
  toolCount: number;
}

interface IntegrationCatalogFrontmatter {
  capabilities?: unknown;
  categories?: unknown;
  aliases?: unknown;
}

export interface IntegrationDocsDirectory {
  pages: readonly string[];
  metaPages?: readonly string[];
  pageBodies: Readonly<Record<string, string>>;
  overview?: {
    catalog?: IntegrationCatalogFrontmatter;
    body: string;
  };
}

export interface IntegrationDocsCompletenessInput {
  providers: readonly RegisteredIntegrationProvider[];
  generatedCatalog: Readonly<Record<string, GeneratedIntegrationCatalogEntry>>;
  integrationDirectories: Readonly<Record<string, IntegrationDocsDirectory>>;
  builtInSourceDocs?: Readonly<Record<string, string>>;
}

const canonicalPages = ['index', 'setup', 'events', 'tools'];
const hardcodedCountPattern = /\b\d+\s+(?:events?|tools?)\b/iu;
const lineBreakPattern = /\r?\n/u;
const yamlCommentPattern = /\s+#/u;

export function collectIntegrationDocIssues(input: IntegrationDocsCompletenessInput): string[] {
  const issues: string[] = [];
  const manifestCatalogSlugs = new Set<string>();
  const builtInSourceSlugs = new Set(
    input.providers
      .filter((provider) => provider.kind === 'built-in-source')
      .map((provider) => provider.slug),
  );

  for (const provider of input.providers) {
    if (provider.kind === 'catalog') {
      manifestCatalogSlugs.add(provider.slug);
      collectCatalogProviderIssues(input, provider, issues);
    } else {
      collectBuiltInSourceIssues(input, provider, issues);
    }
  }

  for (const slug of Object.keys(input.generatedCatalog)) {
    if (!manifestCatalogSlugs.has(slug))
      issues.push(
        `Integration provider "${slug}": add it to the registered provider manifest or remove its generated catalog entry.`,
      );
  }

  for (const slug of Object.keys(input.integrationDirectories)) {
    if (!manifestCatalogSlugs.has(slug) && !builtInSourceSlugs.has(slug))
      issues.push(
        `Integration provider "${slug}": add it to the registered provider manifest or remove its documentation directory.`,
      );
  }

  return issues;
}

function collectCatalogProviderIssues(
  input: IntegrationDocsCompletenessInput,
  provider: Extract<RegisteredIntegrationProvider, {kind: 'catalog'}>,
  issues: string[],
): void {
  const prefix = `Integration provider "${provider.slug}"`;
  const generated = input.generatedCatalog[provider.slug];
  const directory = input.integrationDirectories[provider.slug];

  if (!generated)
    issues.push(`${prefix}: add its entry to content/generated/integrations/catalog.json.`);
  if (!directory) {
    issues.push(`${prefix}: create integrations/${provider.slug}/ with an index.mdx overview.`);
    return;
  }

  const overview = directory.overview;
  if (!overview?.catalog) {
    issues.push(
      `${prefix}: add a catalog frontmatter block to integrations/${provider.slug}/index.mdx.`,
    );
  } else {
    const catalog = overview.catalog;
    const actualCapabilities = strings(catalog.capabilities);
    for (const capability of provider.capabilities) {
      if (!actualCapabilities.includes(capability))
        issues.push(`${prefix}: add the "${capability}" capability to catalog frontmatter.`);
    }
    for (const capability of actualCapabilities) {
      if (!provider.capabilities.includes(capability as CatalogCapability))
        issues.push(
          `${prefix}: remove the stale "${capability}" capability from catalog frontmatter.`,
        );
    }
  }

  collectReferencePageIssues(directory, provider, generated, 'events', issues);
  collectReferencePageIssues(directory, provider, generated, 'tools', issues);

  if (!directory.pages.includes('setup')) {
    issues.push(`${prefix}: add setup.mdx for the connectable provider.`);
  }

  const unexpectedPages = directory.pages.filter((page) => !canonicalPages.includes(page));
  for (const page of unexpectedPages)
    issues.push(`${prefix}: remove or register unsupported page ${page}.mdx.`);

  const expectedMetaPages = canonicalPages.filter((page) => directory.pages.includes(page));
  if (!sameStrings(directory.metaPages, expectedMetaPages))
    issues.push(
      `${prefix}: set meta.json pages to [${expectedMetaPages.join(', ')}] so it matches the existing pages in canonical order.`,
    );

  for (const page of ['index', 'setup']) {
    const body = directory.pageBodies[page];
    if (body && hardcodedCountPattern.test(body))
      issues.push(
        `${prefix}: derive event and tool counts from generated reference instead of hardcoding them in ${page}.mdx.`,
      );
  }
}

function collectReferencePageIssues(
  directory: IntegrationDocsDirectory,
  provider: Extract<RegisteredIntegrationProvider, {kind: 'catalog'}>,
  generated: GeneratedIntegrationCatalogEntry | undefined,
  page: 'events' | 'tools',
  issues: string[],
): void {
  const capability: CatalogCapability = page === 'events' ? 'events' : 'agent_tools';
  if (!provider.capabilities.includes(capability)) return;

  const prefix = `Integration provider "${provider.slug}"`;
  const count = page === 'events' ? generated?.eventCount : generated?.toolCount;
  if (!count)
    issues.push(
      `${prefix}: ${capability} requires a generated catalog with a nonzero ${page} count.`,
    );
  if (!directory.pages.includes(page)) {
    issues.push(`${prefix}: add ${page}.mdx for its ${capability} capability.`);
    return;
  }
  if (!directory.metaPages?.includes(page))
    issues.push(`${prefix}: list ${page} in integrations/${provider.slug}/meta.json.`);

  const generatedPath = `generated/integrations/${provider.slug}/${page}.mdx`;
  if (!directory.pageBodies[page]?.includes(generatedPath))
    issues.push(`${prefix}: import the generated ${page} fragment from ${generatedPath}.`);
}

function collectBuiltInSourceIssues(
  input: IntegrationDocsCompletenessInput,
  provider: Extract<RegisteredIntegrationProvider, {kind: 'built-in-source'}>,
  issues: string[],
): void {
  const prefix = `Built-in source "${provider.slug}"`;
  if (input.integrationDirectories[provider.slug])
    issues.push(
      `${prefix}: remove integrations/${provider.slug}; it is documented at ${provider.docRoute}.`,
    );

  const source = input.builtInSourceDocs?.[provider.slug];
  if (!source) {
    issues.push(`${prefix}: document it at ${provider.docRoute}.`);
    return;
  }
  if (!hasSourceExample(source, provider.slug))
    issues.push(`${prefix}: show \`source: ${provider.slug}\` in ${provider.docRoute}.`);
  for (const event of provider.events) {
    if (!source.includes(`\`${event}\``))
      issues.push(`${prefix}: mention event "${event}" in ${provider.docRoute}.mdx.`);
  }
}

function hasSourceExample(source: string, providerSlug: string): boolean {
  return source.split(lineBreakPattern).some((line) => {
    const value = line.trim();
    if (!value.startsWith('source:')) return false;

    const [sourceValue] = value.slice('source:'.length).trim().split(yamlCommentPattern);
    return sourceValue === providerSlug;
  });
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function sameStrings(actual: readonly string[] | undefined, expected: readonly string[]): boolean {
  return (
    !!actual &&
    actual.length === expected.length &&
    actual.every((item, index) => item === expected[index])
  );
}
