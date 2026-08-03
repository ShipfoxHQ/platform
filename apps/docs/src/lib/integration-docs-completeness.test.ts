import assert from 'node:assert/strict';
import test from 'node:test';
import {type CatalogCategory, catalogCategoryLabels} from '@/lib/integration-catalog';
import {
  collectIntegrationDocIssues,
  type IntegrationDocsCompletenessInput,
} from '@/lib/integration-docs-completeness';
import {registeredIntegrationProviders} from '@/lib/registered-integration-providers';

const githubToolsIssuePattern = /Integration provider "github": add tools\.mdx/;
const linearAvailabilityIssuePattern =
  /Integration provider "linear": set catalog availability to "available"/;
const sentryCapabilitiesIssuePattern =
  /Integration provider "sentry": remove the stale "agent_tools" capability/;
const cronSectionIssuePattern = /Built-in source "cron": add a "## cron" section/;

const validInput: IntegrationDocsCompletenessInput = {
  providers: registeredIntegrationProviders,
  generatedCatalog: {
    github: {
      availability: 'available',
      capabilities: ['source_control', 'events', 'agent_tools'],
      eventCount: 1,
      toolCount: 1,
    },
    sentry: {availability: 'available', capabilities: ['events'], eventCount: 1, toolCount: 0},
    webhooks: {availability: 'available', capabilities: ['events'], eventCount: 1, toolCount: 0},
    linear: {availability: 'available', capabilities: ['agent_tools'], eventCount: 0, toolCount: 1},
    slack: {availability: 'available', capabilities: ['agent_tools'], eventCount: 0, toolCount: 1},
  },
  integrationDirectories: {
    github: directory(
      'github',
      ['index', 'setup', 'events', 'tools'],
      ['index', 'setup', 'events', 'tools'],
      {
        availability: 'available',
        capabilities: ['source_control', 'events', 'agent_tools'],
        categories: ['source-control'],
        aliases: ['git'],
      },
    ),
    sentry: directory('sentry', ['index', 'setup', 'events'], ['index', 'setup', 'events'], {
      availability: 'available',
      capabilities: ['events'],
      categories: ['observability'],
      aliases: ['errors'],
    }),
    webhooks: directory('webhooks', ['index', 'setup', 'events'], ['index', 'setup', 'events'], {
      availability: 'available',
      capabilities: ['events'],
      categories: ['custom'],
      aliases: ['hooks'],
    }),
    linear: directory('linear', ['index', 'setup', 'tools'], ['index', 'setup', 'tools'], {
      availability: 'available',
      capabilities: ['agent_tools'],
      categories: ['issue-tracking'],
      aliases: ['issues'],
    }),
    slack: directory('slack', ['index', 'setup', 'tools'], ['index', 'setup', 'tools'], {
      availability: 'available',
      capabilities: ['agent_tools'],
      categories: ['messaging'],
      aliases: ['chat'],
    }),
  },
  categoryLabels: catalogCategoryLabels,
  triggerSources: '## Sources at a glance\n| Cron | `cron` | `tick` |\n\n## cron',
};

test('accepts complete integration documentation', () => {
  assert.deepEqual(collectIntegrationDocIssues(validInput), []);
});

test('reports provider-named fixes for missing and stale documentation', () => {
  const github = validInput.integrationDirectories.github;
  const linear = validInput.integrationDirectories.linear;
  const sentry = validInput.integrationDirectories.sentry;
  const linearOverview = catalogOverview(linear);
  const sentryOverview = catalogOverview(sentry);
  const input: IntegrationDocsCompletenessInput = {
    ...validInput,
    integrationDirectories: {
      ...validInput.integrationDirectories,
      github: {
        ...github,
        pages: ['index', 'setup', 'events'],
        pageBodies: {...github.pageBodies, tools: ''},
      },
      linear: {
        ...linear,
        overview: {
          ...linearOverview,
          catalog: {...linearOverview.catalog, availability: 'preview'},
        },
      },
      sentry: {
        ...sentry,
        overview: {
          ...sentryOverview,
          catalog: {...sentryOverview.catalog, capabilities: ['events', 'agent_tools']},
        },
      },
    },
    triggerSources: '## Sources at a glance\n| Cron | `cron` | `tick` |',
  };

  const issues = collectIntegrationDocIssues(input);

  assert.match(issues.join('\n'), githubToolsIssuePattern);
  assert.match(issues.join('\n'), linearAvailabilityIssuePattern);
  assert.match(issues.join('\n'), sentryCapabilitiesIssuePattern);
  assert.match(issues.join('\n'), cronSectionIssuePattern);
});

test('uses the built-in source identifier for the source table row', () => {
  const input: IntegrationDocsCompletenessInput = {
    ...validInput,
    triggerSources: '## Sources at a glance\n| Schedule | `cron` | `tick` |\n\n## cron',
  };

  assert.deepEqual(collectIntegrationDocIssues(input), []);
});

test('reports only the built-in-source diagnostic for its integration directory', () => {
  const input: IntegrationDocsCompletenessInput = {
    ...validInput,
    integrationDirectories: {
      ...validInput.integrationDirectories,
      cron: directory('cron', ['index'], ['index'], {
        availability: 'available',
        capabilities: [],
        categories: ['custom'],
        aliases: ['schedule'],
      }),
    },
  };

  const issues = collectIntegrationDocIssues(input);

  assert.deepEqual(
    issues.filter((issue) => issue.includes('integrations/cron')),
    [
      'Built-in source "cron": remove integrations/cron; it is documented at /reference/trigger-sources.',
    ],
  );
});

function catalogOverview(directory: (typeof validInput.integrationDirectories)[string]) {
  if (!directory.overview?.catalog) throw new Error('Fixture must include catalog frontmatter.');
  return {
    body: directory.overview.body,
    catalog: directory.overview.catalog,
    status: directory.overview.status,
  };
}

function directory(
  slug: string,
  pages: string[],
  metaPages: string[],
  catalog: {
    availability: string;
    capabilities: string[];
    categories: CatalogCategory[];
    aliases: string[];
  },
  status?: string,
) {
  const categoryProse = catalog.categories
    .map((category) => catalogCategoryLabels[category])
    .join(' ');
  const aliasProse = catalog.aliases.join(' ');
  return {
    pages,
    metaPages,
    pageBodies: {
      index: `${categoryProse} ${aliasProse}`,
      setup: 'Set up the integration.',
      events: `generated/integrations/${slug}/events.mdx`,
      tools: `generated/integrations/${slug}/tools.mdx`,
    },
    overview: {catalog, status, body: `${categoryProse} ${aliasProse}`},
  };
}
