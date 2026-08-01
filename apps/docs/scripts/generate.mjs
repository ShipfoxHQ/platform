#!/usr/bin/env node
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {listHarnessDescriptors, MODEL_PROVIDER_CATALOG_SEED} from '@shipfox/api-agent-dto';
import {
  githubAgentToolCatalog,
  githubAgentToolSelectionCatalog,
} from '@shipfox/api-integration-github/agent-tools';
import {githubEventCatalog} from '@shipfox/api-integration-github-dto';
import {sentryEventCatalog} from '@shipfox/api-integration-sentry-dto';
import {webhookEventCatalog} from '@shipfox/api-integration-webhook-dto';
import {buildWorkflowJsonSchema, thinkingLevelsForHarness} from '@shipfox/workflow-document';
import {registeredIntegrationProviders} from '@/lib/registered-integration-providers';
import {slugForHeading} from './lib/slug.mjs';

const docsRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const markdownLinkPattern = /^\[([^\]]+)\]\(([^)]*)\)$/;
const dtoCatalogBySlug = {
  github: {
    eventCatalog: githubEventCatalog,
    toolCatalog: githubAgentToolCatalog,
    toolSelectionCatalog: githubAgentToolSelectionCatalog,
  },
  sentry: {
    eventCatalog: sentryEventCatalog,
  },
  webhooks: {
    eventCatalog: webhookEventCatalog,
  },
};
const integrationCatalogProviders = registeredIntegrationProviders
  .filter((provider) => provider.kind === 'catalog')
  .map((provider) => ({...provider, ...dtoCatalogBySlug[provider.slug]}));
const regions = [
  ['content/generated/reference/model-providers.mdx', renderModelProvidersTable],
  ...integrationCatalogProviders.flatMap((provider) => [
    ...(provider.eventCatalog
      ? [
          [
            `content/generated/integrations/${provider.slug}/events.mdx`,
            () => renderEventCatalog(provider.eventCatalog),
          ],
        ]
      : []),
    ...(provider.toolCatalog
      ? [
          [
            `content/generated/integrations/${provider.slug}/tools.mdx`,
            () => renderToolCatalog(provider.toolCatalog, provider.toolSelectionCatalog),
          ],
        ]
      : []),
  ]),
  ['content/generated/integrations/catalog.json', renderIntegrationCatalogData],
  ['content/generated/reference/workflow-schema.mdx', renderWorkflowSchemaReference],
];

function renderIntegrationCatalogData() {
  return JSON.stringify(
    Object.fromEntries(
      integrationCatalogProviders.map((provider) => [
        provider.slug,
        {
          availability: provider.availability,
          capabilities: provider.capabilities,
          eventCount: provider.eventCatalog?.events.length ?? 0,
          toolCount: provider.toolCatalog?.length ?? 0,
        },
      ]),
    ),
    null,
    2,
  );
}

function renderModelProvidersTable() {
  const supported = MODEL_PROVIDER_CATALOG_SEED.filter((p) => p.support_status === 'supported');
  const harnesses = listHarnessDescriptors();
  return [
    '| Provider | `provider` ID | Default model | Compatible harnesses |',
    '|---|---|---|---|',
    ...supported.map((provider) => {
      const compatible = harnesses
        .filter((harness) => harness.supportedProviderIds.includes(provider.id))
        .map((harness) => `\`${harness.id}\``)
        .join(', ');
      return `| ${provider.label} | \`${provider.id}\` | \`${provider.default_model}\` | ${compatible} |`;
    }),
  ].join('\n');
}

function renderEventCatalog(catalog) {
  const lines = [];
  if (catalog.passthrough) {
    lines.push(
      `Shipfox forwards additional raw ${catalog.provider} webhook events. See [the complete ${catalog.provider} event reference](${catalog.upstreamEventsDocUrl}) for the upstream catalog.`,
      '',
    );
  }
  for (const event of catalog.events) {
    lines.push(
      `### \`${event.name}\``,
      '',
      event.summary,
      '',
      `**Emitted when:** ${event.emittedWhen}`,
      '',
      `**Payload:** ${event.payloadKind === 'raw-provider' ? 'Raw provider payload.' : 'Shipfox-normalized payload.'}`,
      ...(event.payloadDocUrl
        ? ['', `[Provider payload documentation](${event.payloadDocUrl})`]
        : []),
      '',
    );
  }
  return lines.join('\n').trimEnd();
}

function renderToolCatalog(catalog, selectionCatalog) {
  const lines = [];
  for (const category of [...new Set(catalog.map((tool) => tool.category))]) {
    lines.push(`### ${category.replaceAll('_', ' ')}`, '');
    for (const tool of catalog.filter((candidate) => candidate.category === category)) {
      lines.push(
        `#### \`${tool.id}\``,
        '',
        tool.description,
        '',
        `**Sensitivity:** ${tool.sensitivity}.`,
        '',
        `**Sensitive:** ${tool.sensitive ? 'Yes.' : 'No.'}`,
        '',
        `**Required permissions:** ${formatScope(tool.requiredScope)}`,
        '',
        `**Selector tokens:** ${formatSelectors(tool.id, selectionCatalog)}`,
        '',
        '##### Input',
        '',
        ...renderFields(tool.inputSchema),
      );
      for (const method of tool.methods ?? []) {
        lines.push(
          '',
          `##### \`${tool.id}.${method.id}\``,
          '',
          method.description,
          '',
          `**Sensitivity:** ${method.sensitivity}.`,
          '',
          `**Sensitive:** ${method.sensitive ? 'Yes.' : 'No.'}`,
          '',
          `**Required permissions:** ${formatScope(method.requiredScope)}`,
          '',
          methodRequirements(tool.inputSchema, method.id),
        );
      }
      if (tool.outputSchema) lines.push('', '##### Output', '', ...renderFields(tool.outputSchema));
      lines.push('');
    }
  }
  return lines.join('\n').trimEnd();
}

function renderFields(schema) {
  const properties = object(schema.properties);
  const required = new Set(strings(schema.required));
  const conditional = new Set(
    [...objects(schema.oneOf), ...objects(schema.anyOf)].flatMap((option) =>
      strings(option.required),
    ),
  );
  const rows = Object.entries(properties).map(([name, value]) => {
    const property = object(value);
    const requirement = required.has(name)
      ? 'Required'
      : conditional.has(name)
        ? 'Conditional'
        : 'Optional';
    const type =
      strings(property.enum).length > 0
        ? `${property.type}: ${strings(property.enum)
            .map((item) => `\`${item}\``)
            .join(', ')}`
        : (property.type ?? 'value');
    return `| \`${name}\` | ${type} | ${requirement} | ${property.description ?? ''} |`;
  });
  if (rows.length === 0) return ['This schema accepts an object with provider-defined fields.'];
  const alternatives = objects(schema.anyOf)
    .map((option) => strings(option.required))
    .filter((requiredFields) => requiredFields.length > 0);
  return [
    '| Field | Type | Required | Description |',
    '|---|---|---|---|',
    ...rows,
    ...(alternatives.length > 0
      ? [
          '',
          `At least one of these input combinations is required: ${alternatives.map((fields) => fields.map((field) => `\`${field}\``).join(' and ')).join('; ')}.`,
        ]
      : []),
  ];
}

function methodRequirements(schema, methodId) {
  const option = objects(schema.oneOf).find(
    (candidate) => object(object(candidate.properties).method).const === methodId,
  );
  const required = option ? strings(option.required) : [];
  return required.length > 0
    ? `**Required input for this method:** ${required.map((field) => `\`${field}\``).join(', ')}.`
    : 'This method has no additional required input.';
}

function formatScope(scope) {
  return Array.isArray(scope) && scope.length > 0
    ? scope.map((entry) => `\`${object(entry).permission}:${object(entry).access}\``).join(', ')
    : 'None.';
}

function formatSelectors(toolId, selectionCatalog) {
  return selectionCatalog.selectors
    .filter((selector) => selector.token === toolId || selector.token.startsWith(`${toolId}.`))
    .map((selector) => {
      const target = selector.token.endsWith('.*') ? toolId : selector.token;
      return `[\`${selector.token}\`](#${slugForHeading(target)})`;
    })
    .join(', ');
}

function object(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

function objectSchemaFor(value) {
  const schema = object(value);
  if (schema.type === 'object' || schema.properties) return schema;
  return (
    objects(schema.anyOf).find((option) => option.type === 'object' || option.properties) ?? {}
  );
}

function strings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function objects(value) {
  return Array.isArray(value) ? value.map(object) : [];
}

function renderWorkflowSchemaReference() {
  const schema = buildWorkflowJsonSchema();
  const root = object(schema.properties);
  const jobs = object(object(root.jobs).additionalProperties);
  const steps = object(object(object(jobs.properties).steps).items);
  const listening = object(object(jobs.properties).listening);
  const integrations = object(steps.properties).integrations;
  const integration = object(integrations.items);
  const gate = object(steps.properties).gate;
  const jobCheckout = objectSchemaFor(object(jobs.properties).checkout);
  const checkout = objectSchemaFor(object(steps.properties).checkout);
  const checkoutPermissions = object(checkout.properties).permissions;
  const gateFailure = object(gate.properties).on_failure;
  const triggers = object(root.triggers);
  const trigger = object(triggers.additionalProperties);
  const batch = object(listening.properties).batch;

  return [
    "import {TypeTable} from 'fumadocs-ui/components/type-table';",
    '',
    component('TopLevelFields', root, {
      required: ['name', 'jobs'],
      nested: {
        env: '#environment-variables',
        triggers: '#trigger-fields',
        jobs: '#job-fields',
      },
      types: {
        env: namedType('Environment'),
        triggers: recordType('Trigger'),
        jobs: recordType('Job'),
      },
    }),
    component('TriggerFields', object(trigger.properties), {required: ['source', 'event']}),
    component('JobFields', object(jobs.properties), {
      required: ['steps'],
      nested: {
        checkout: '#job-checkout-fields',
        listening: '#listening-fields',
      },
      types: {
        outputs: recordType('string'),
        checkout: namedType('JobCheckout'),
        listening: namedType('Listening'),
        env: namedType('Environment'),
        steps: codeType('Step[]'),
      },
    }),
    component('JobCheckoutFields', object(jobCheckout.properties), {
      nested: {permissions: '#checkout-permissions-fields'},
      types: {permissions: namedType('CheckoutPermissions')},
    }),
    component('CheckoutFields', object(checkout.properties), {
      nested: {permissions: '#checkout-permissions-fields'},
      types: {permissions: namedType('CheckoutPermissions')},
    }),
    component('CheckoutPermissionsFields', object(checkoutPermissions.properties)),
    component('RunStepFields', object(steps.properties), {
      fields: ['key', 'if', 'name', 'run', 'gate', 'env', 'outputs'],
      required: ['run'],
      nested: {
        gate: '#gate-fields',
        env: '#environment-variables',
        outputs: '#step-outputs',
      },
      types: {
        gate: namedType('Gate'),
        env: namedType('Environment'),
        outputs: recordType('Output'),
      },
    }),
    component('CheckoutStepFields', object(steps.properties), {
      fields: ['key', 'if', 'name', 'checkout', 'gate', 'outputs'],
      required: ['checkout'],
      nested: {
        checkout: '#checkout-fields',
        gate: '#gate-fields',
        outputs: '#step-outputs',
      },
      types: {
        checkout: namedType('Checkout'),
        gate: namedType('Gate'),
        outputs: recordType('Output'),
      },
    }),
    component('AgentStepFields', object(steps.properties), {
      fields: [
        'key',
        'if',
        'name',
        'prompt',
        'model',
        'harness',
        'thinking',
        'provider',
        'tools',
        'integrations',
        'gate',
        'outputs',
      ],
      required: ['prompt'],
      nested: {
        integrations: '#agent-integration-fields',
        gate: '#gate-fields',
        outputs: '#step-outputs',
      },
      types: {
        thinking: thinkingType(),
        integrations: codeType('Integration[]'),
        gate: namedType('Gate'),
        outputs: recordType('Output'),
      },
    }),
    component('AgentIntegrationFields', object(integration.properties), {required: ['include']}),
    component('GateFields', object(gate.properties), {
      nested: {on_failure: '#gate-failure-fields'},
      types: {on_failure: namedType('GateFailure')},
    }),
    component('GateFailureFields', object(gateFailure.properties), {required: ['restart_from']}),
    component('StepOutputs', outputFields()),
    component('ListeningFields', object(listening.properties), {
      required: ['on'],
      nested: {
        on: '#trigger-fields',
        until: '#trigger-fields',
        batch: '#listening-batch-fields',
      },
      types: {
        on: codeType('Trigger[]'),
        until: codeType('Trigger[]'),
        batch: namedType('ListeningBatch'),
      },
    }),
    component('ListeningBatchFields', object(batch.properties)),
    component('EnvironmentVariables', environmentFields()),
  ]
    .filter(Boolean)
    .join('\n\n');
}

function component(name, properties, options = {}) {
  const table = renderTypeTable(properties, options)
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
  return [`export function ${name}() {`, '  return (', table, '  );', '}'].join('\n');
}

function renderTypeTable(properties, options) {
  const required = new Set(options.required ?? []);
  const names = options.fields ?? Object.keys(properties);
  const rows = names.flatMap((name) => {
    const property = properties[name];
    if (!property) return [];
    return [
      `    ${JSON.stringify(name)}: {`,
      `      type: ${options.types?.[name] ?? typeFor(property)},`,
      `      description: ${descriptionFor(property.description)},`,
      ...(required.has(name) ? ['      required: true,'] : []),
      ...(options.defaults?.[name] ? [`      default: ${codeType(options.defaults[name])},`] : []),
      ...(options.nested?.[name]
        ? [`      typeDescriptionLink: ${JSON.stringify(options.nested[name])},`]
        : []),
      '    },',
    ];
  });

  return ['<TypeTable', '  type={{', ...rows, '  }}', '/>'].join('\n');
}

function typeFor(schema) {
  if (Array.isArray(schema.enum)) return enumType(schema.enum);
  if (schema.type === 'array') return codeType(`${typeText(object(schema.items))}[]`);
  if (schema.type === 'object' && schema.additionalProperties)
    return codeType('Record<string, value>');
  if (Array.isArray(schema.anyOf)) {
    return codeType(schema.anyOf.map((option) => typeText(object(option))).join(' | '));
  }
  return codeType(typeof schema.type === 'string' ? schema.type : 'value');
}

function typeText(schema) {
  if (Array.isArray(schema.enum)) return schema.enum.join(' | ');
  if (schema.type === 'array') return `${typeText(object(schema.items))}[]`;
  if (schema.type === 'object')
    return schema.additionalProperties ? 'Record<string, value>' : 'object';
  return typeof schema.type === 'string' ? schema.type : 'value';
}

function thinkingType() {
  return [
    '<>',
    ...['pi', 'claude'].flatMap((harness, index) => [
      ...(index > 0 ? [' | '] : []),
      `<code>{${JSON.stringify(`${harness}: ${thinkingLevelsForHarness(harness).join(', ')}`)}}</code>`,
    ]),
    '</>',
  ].join('');
}

function enumType(values) {
  return `<>${values.map((value, index) => `${index > 0 ? ' | ' : ''}<code>{${JSON.stringify(String(value))}}</code>`).join('')}</>`;
}

function codeType(value) {
  return `<code>{${JSON.stringify(value)}}</code>`;
}

function namedType(name) {
  return codeType(name);
}

function recordType(valueType) {
  return codeType(`Record<string, ${valueType}>`);
}

function descriptionFor(description) {
  const value = typeof description === 'string' ? description : '';
  const parts = value.split(/(\[[^\]]+\]\([^)]*\)|`[^`]+`)/g).filter(Boolean);
  return `<>${parts
    .map((part) => {
      const link = markdownLinkPattern.exec(part);
      if (link) return `<a href=${JSON.stringify(link[2])}>{${JSON.stringify(link[1])}}</a>`;
      if (part.startsWith('`') && part.endsWith('`')) return codeType(part.slice(1, -1));
      return `{${JSON.stringify(part)}}`;
    })
    .join('')}</>`;
}

function outputFields() {
  return {
    OUTPUT_NAME: {
      type: 'string | number | boolean | json | {type: string | number | boolean} | {type: json; schema?: value}',
      description:
        'Output declaration. Use a type directly (for example, `sha: string`) or an object with required `type`. Only `json` declarations can include `schema`.',
    },
  };
}

function environmentFields() {
  return {
    '[A-Za-z_][A-Za-z0-9_]*': {
      type: 'string | number | boolean',
      description: 'Environment variable value. For example, `NODE_ENV: production`.',
    },
  };
}

for (const [file, render] of regions) {
  const path = join(docsRoot, file);
  mkdirSync(dirname(path), {recursive: true});
  const next = `${render()}\n`;
  writeFileSync(path, next);
  // biome-ignore lint/suspicious/noConsole: CLI diagnostics
  console.log(`✓ wrote ${file}`);
}
