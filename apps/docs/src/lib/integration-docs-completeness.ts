import type {
  CatalogAvailability,
  CatalogCapability,
  CatalogCategory,
} from '@/lib/integration-catalog';
import type {RegisteredIntegrationProvider} from '@/lib/registered-integration-providers';

export interface GeneratedIntegrationCatalogEntry {
  availability: CatalogAvailability;
  capabilities: readonly CatalogCapability[];
  eventCount: number;
  toolCount: number;
}

interface IntegrationCatalogFrontmatter {
  availability?: unknown;
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
    status?: unknown;
    body: string;
  };
}

export interface IntegrationDocsCompletenessInput {
  providers: readonly RegisteredIntegrationProvider[];
  generatedCatalog: Readonly<Record<string, GeneratedIntegrationCatalogEntry>>;
  integrationDirectories: Readonly<Record<string, IntegrationDocsDirectory>>;
  categoryLabels: Readonly<Record<CatalogCategory, string>>;
  triggerSources?: string;
}

const canonicalPages = ['index', 'setup', 'events', 'tools'];
const hardcodedCountPattern = /\b\d+\s+(?:events?|tools?)\b/iu;

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
    if (catalog.availability !== provider.availability)
      issues.push(`${prefix}: set catalog availability to "${provider.availability}".`);

    const expectedSoonStatus = provider.availability === 'coming-soon';
    if ((overview.status === 'soon') !== expectedSoonStatus)
      issues.push(
        `${prefix}: ${expectedSoonStatus ? 'set status to "soon"' : 'remove status "soon"'} so it matches availability.`,
      );

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

    const overviewProse = overview.body.toLocaleLowerCase();
    for (const category of strings(catalog.categories)) {
      const label = input.categoryLabels[category as CatalogCategory];
      if (label && !overviewProse.includes(label.toLocaleLowerCase()))
        issues.push(`${prefix}: mention category label "${label}" in overview prose for search.`);
    }
  }

  if (overview) {
    for (const alias of strings(overview.catalog?.aliases)) {
      if (!overview.body.toLocaleLowerCase().includes(alias.toLocaleLowerCase()))
        issues.push(`${prefix}: mention alias "${alias}" in overview prose for search.`);
    }
  }

  collectReferencePageIssues(directory, provider, generated, 'events', issues);
  collectReferencePageIssues(directory, provider, generated, 'tools', issues);

  if (provider.availability === 'coming-soon') {
    if (provider.capabilities.length > 0)
      issues.push(
        `${prefix}: coming-soon providers must not declare capabilities in the manifest.`,
      );
    for (const page of canonicalPages.slice(1)) {
      if (directory.pages.includes(page))
        issues.push(
          `${prefix}: remove ${page}.mdx because coming-soon providers have no shipped reference pages.`,
        );
    }
  } else if (!directory.pages.includes('setup')) {
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

  const source = input.triggerSources;
  if (!source) {
    issues.push(`${prefix}: add ${provider.docRoute}.mdx with its trigger source reference.`);
    return;
  }
  if (!new RegExp(`^##\\s+${escapeRegExp(provider.anchor)}\\s*$`, 'imu').test(source))
    issues.push(`${prefix}: add a "## ${provider.anchor}" section to ${provider.docRoute}.mdx.`);
  const sourceTableRow = source
    .split('\n')
    .find((line) => line.startsWith('|') && line.includes(`\`${provider.slug}\``));
  if (!sourceTableRow)
    issues.push(
      `${prefix}: add its \`${provider.slug}\` row to the "Sources at a glance" table in ${provider.docRoute}.mdx.`,
    );
  for (const event of provider.events) {
    if (!source.includes(`\`${event}\``))
      issues.push(`${prefix}: mention event "${event}" in ${provider.docRoute}.mdx.`);
  }
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
