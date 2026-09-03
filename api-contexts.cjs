const path = require('node:path');

const architecturePackages = {
  implementations: {
    agent: ['libs/api/agent'],
    'agent-access': ['libs/api/agent-access'],
    annotations: ['libs/api/annotations'],
    auth: ['libs/api/auth'],
    definitions: ['libs/api/definitions'],
    integrations: [
      'libs/api/integration/core',
      'libs/api/integration/gitea',
      'libs/api/integration/github',
      'libs/api/integration/jira',
      'libs/api/integration/linear',
      'libs/api/integration/sentry',
      'libs/api/integration/slack',
      'libs/api/integration/webhook',
    ],
    logs: ['libs/api/logs'],
    projects: ['libs/api/projects'],
    runners: ['libs/api/runners'],
    secrets: ['libs/api/secrets'],
    triggers: ['libs/api/triggers'],
    // Usage is a bounded context under docs/adr/0015-usage-context-and-application-seams.md.
    // Classify it here as `usage: ['libs/api/usage']` when the package lands; the
    // inventory check rejects a classified path that does not exist yet.
    workflows: ['libs/api/workflows'],
    workspaces: ['libs/api/workspaces'],
  },
  dto: {
    agent: ['libs/api/agent-dto'],
    'agent-access': ['libs/api/agent-access-dto'],
    annotations: ['libs/api/annotations-dto'],
    auth: ['libs/api/auth-dto'],
    common: ['libs/api/common-dto'],
    definitions: ['libs/api/definitions-dto'],
    integrations: [
      'libs/api/integration/core-dto',
      'libs/api/integration/gitea-dto',
      'libs/api/integration/github-dto',
      'libs/api/integration/jira-dto',
      'libs/api/integration/linear-dto',
      'libs/api/integration/sentry-dto',
      'libs/api/integration/slack-dto',
      'libs/api/integration/webhook-dto',
    ],
    logs: ['libs/api/logs-dto'],
    projects: ['libs/api/projects-dto'],
    runners: ['libs/api/runners-dto'],
    secrets: ['libs/api/secrets-dto'],
    triggers: ['libs/api/triggers-dto'],
    // Usage DTO package under ADR 0015: `usage: ['libs/api/usage-dto']` when it lands.
    workflows: ['libs/api/workflows-dto'],
    workspaces: ['libs/api/workspaces-dto'],
  },
  'shared-semantic': {
    common: [
      'libs/shared/common/redact',
      'libs/shared/common/regex',
      'libs/shared/common/runner-labels',
    ],
    expression: ['libs/shared/expression'],
    workflow: ['libs/shared/workflow/document'],
  },
  'shared-infrastructure': {
    api: ['libs/api/auth-context', 'libs/api/dispatcher', 'libs/api/email-challenges'],
    common: ['libs/shared/common/config', 'libs/shared/common/inter-module'],
    node: [
      'libs/shared/node/auth-root-key',
      'libs/shared/node/drizzle',
      'libs/shared/node/egress-guard',
      'libs/shared/node/email',
      'libs/shared/node/envelope-encryption',
      'libs/shared/node/error-monitoring',
      'libs/shared/node/fastify',
      'libs/shared/node/jwt',
      'libs/shared/node/log',
      'libs/shared/node/mailer',
      'libs/shared/node/module',
      'libs/shared/node/opentelemetry',
      'libs/shared/node/object-storage',
      'libs/shared/node/outbox',
      'libs/shared/node/postgres',
      'libs/shared/node/rate-limit',
      'libs/shared/node/resilient-loop',
      'libs/shared/node/temporal',
      'libs/shared/node/tokens',
    ],
  },
  spi: {integrations: ['libs/api/integration/spi']},
  'composition-root': {api: ['libs/api/server']},
};

const apiArchitectureEdgePolicy = {
  implementations: {
    implementations: {
      decision: 'same-context',
      rule: 'api-no-foreign-implementation-imports',
      violation: 'Foreign implementation import',
    },
    dto: {decision: 'allow'},
    'shared-semantic': {decision: 'allow'},
    'shared-infrastructure': {decision: 'allow'},
    spi: {
      decision: 'same-context',
      rule: 'api-no-foreign-same-context-spi-imports',
      violation: 'Foreign same-context SPI import',
    },
    'composition-root': {decision: 'allow'},
  },
  dto: {
    implementations: {
      decision: 'never',
      rule: 'api-no-dto-implementation-imports',
      violation: 'DTO implementation import',
    },
    // Local DTO-to-DTO /inter-module imports are owned by the Biome plugin. This
    // decision remains allow because the verifier only evaluates manifest edges.
    dto: {decision: 'allow'},
    'shared-semantic': {decision: 'allow'},
    'shared-infrastructure': {decision: 'allow'},
    spi: {
      decision: 'never',
      rule: 'api-no-dto-spi-imports',
      violation: 'DTO SPI import',
    },
    'composition-root': {decision: 'allow'},
  },
  'shared-semantic': {
    implementations: {
      decision: 'never',
      rule: 'api-no-shared-semantic-implementation-imports',
      violation: 'Shared semantic implementation import',
    },
    dto: {decision: 'allow'},
    'shared-semantic': {decision: 'allow'},
    'shared-infrastructure': {decision: 'allow'},
    spi: {
      decision: 'never',
      rule: 'api-no-shared-semantic-spi-imports',
      violation: 'Shared semantic SPI import',
    },
    'composition-root': {decision: 'allow'},
  },
  'shared-infrastructure': {
    implementations: {decision: 'allow'},
    dto: {decision: 'allow'},
    'shared-semantic': {decision: 'allow'},
    'shared-infrastructure': {decision: 'allow'},
    spi: {decision: 'allow'},
    'composition-root': {decision: 'allow'},
  },
  spi: {
    implementations: {
      decision: 'same-context',
      rule: 'api-no-foreign-spi-implementation-imports',
      violation: 'Foreign SPI implementation import',
    },
    dto: {decision: 'allow'},
    'shared-semantic': {decision: 'allow'},
    'shared-infrastructure': {decision: 'allow'},
    spi: {
      decision: 'same-context',
      rule: 'api-no-foreign-spi-imports',
      violation: 'Foreign SPI import',
    },
    'composition-root': {decision: 'allow'},
  },
  'composition-root': {
    implementations: {decision: 'allow'},
    dto: {decision: 'allow'},
    'shared-semantic': {decision: 'allow'},
    'shared-infrastructure': {decision: 'allow'},
    spi: {decision: 'allow'},
    'composition-root': {decision: 'allow'},
  },
};

const validEdgeDecisions = new Set(['allow', 'same-context', 'never']);

function validateApiArchitectureEdgePolicy(
  packages = architecturePackages,
  edgePolicy = apiArchitectureEdgePolicy,
) {
  const classifications = Object.keys(packages);
  const errors = [];

  for (const classification of classifications) {
    const row = edgePolicy[classification];
    if (!row) {
      errors.push(`Missing API architecture edge policy row: ${classification}`);
      continue;
    }
    for (const targetClassification of classifications) {
      const edge = row[targetClassification];
      if (!edge) {
        errors.push(
          `Missing API architecture edge policy decision: ${classification} -> ${targetClassification}`,
        );
        continue;
      }
      if (!validEdgeDecisions.has(edge.decision)) {
        errors.push(
          `Invalid API architecture edge policy decision: ${classification} -> ${targetClassification}`,
        );
      }
      if (edge.decision !== 'allow' && (!edge.rule || !edge.violation)) {
        errors.push(
          `API architecture edge policy violation metadata is incomplete: ${classification} -> ${targetClassification}`,
        );
      }
    }
    for (const targetClassification of Object.keys(row)) {
      if (!classifications.includes(targetClassification)) {
        errors.push(
          `API architecture edge policy references unknown classification: ${classification} -> ${targetClassification}`,
        );
      }
    }
  }

  for (const classification of Object.keys(edgePolicy)) {
    if (!classifications.includes(classification)) {
      errors.push(`API architecture edge policy has unknown row: ${classification}`);
    }
  }

  return errors.sort();
}

const edgePolicyErrors = validateApiArchitectureEdgePolicy();
if (edgePolicyErrors.length > 0) {
  throw new Error(edgePolicyErrors.join('\n'));
}

function architecturePackageEntries(packages) {
  return Object.entries(packages).flatMap(([classification, contexts]) =>
    Object.entries(contexts).flatMap(([context, packagePaths]) =>
      packagePaths.map((packagePath) => ({classification, context, packagePath})),
    ),
  );
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function packageEntryForDirectory(currentDirectory, workspaceRoot, packages) {
  return architecturePackageEntries(packages).find(({packagePath}) => {
    const relativePath = path.relative(path.join(workspaceRoot, packagePath), currentDirectory);
    return (
      relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
    );
  });
}

function createApiArchitectureRules({
  currentDirectory = process.cwd(),
  workspaceRoot = __dirname,
  packages = architecturePackages,
  edgePolicy = apiArchitectureEdgePolicy,
  sourcePath = '^(?!\\.\\./)(?!node_modules/)(?!dist/)(?!coverage/).*\\.(?:[cm]?[jt]sx?)$',
}) {
  const policyErrors = validateApiArchitectureEdgePolicy(packages, edgePolicy);
  if (policyErrors.length > 0) throw new Error(policyErrors.join('\n'));

  const importer = packageEntryForDirectory(currentDirectory, workspaceRoot, packages);
  if (!importer) return [];

  const targetEntries = architecturePackageEntries(packages);
  const rules = [];
  for (const targetClassification of Object.keys(packages)) {
    const edge = edgePolicy[importer.classification][targetClassification];
    if (edge.decision === 'allow') continue;

    const targets = targetEntries.filter(
      (target) =>
        target.classification === targetClassification &&
        (edge.decision === 'never' || target.context !== importer.context),
    );
    if (targets.length === 0) continue;

    rules.push({
      name: edge.rule,
      comment: `${edge.violation}; this source boundary is controlled by api-contexts.cjs.`,
      severity: 'error',
      from: {path: sourcePath},
      to: {
        path: targets.map(
          ({packagePath}) =>
            `^${escapeRegExp(toPosixPath(path.relative(currentDirectory, path.join(workspaceRoot, packagePath))))}/`,
        ),
      },
    });
  }
  return rules;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const apiContextExemptPaths = {
  'shared-infrastructure': architecturePackages['shared-infrastructure'].api,
  'composition-root': architecturePackages['composition-root'].api,
};

module.exports = {
  apiArchitectureEdgePolicy,
  apiContextExemptPaths,
  architecturePackages,
  createApiArchitectureRules,
  validateApiArchitectureEdgePolicy,
};
