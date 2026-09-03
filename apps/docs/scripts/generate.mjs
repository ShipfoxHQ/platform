#!/usr/bin/env node
import {randomUUID} from 'node:crypto';
import {existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {listHarnessDescriptors, MODEL_PROVIDER_CATALOG_SEED} from '@shipfox/api-agent-dto';
import {
  githubAgentToolCatalog,
  githubAgentToolSelectionCatalog,
} from '@shipfox/api-integration-github/agent-tools';
import {githubEventCatalog} from '@shipfox/api-integration-github-dto';
import {
  jiraAgentToolCatalog,
  jiraAgentToolSelectionCatalog,
} from '@shipfox/api-integration-jira/agent-tools';
import {jiraEventCatalog} from '@shipfox/api-integration-jira-dto';
import {
  linearAgentToolCatalog,
  linearAgentToolSelectionCatalog,
} from '@shipfox/api-integration-linear/agent-tools';
import {linearEventCatalog} from '@shipfox/api-integration-linear-dto';
import {sentryEventCatalog} from '@shipfox/api-integration-sentry-dto';
import {
  slackAgentToolCatalog,
  slackAgentToolSelectionCatalog,
} from '@shipfox/api-integration-slack/agent-tools';
import {slackEventCatalog} from '@shipfox/api-integration-slack-dto';
import {webhookEventCatalog} from '@shipfox/api-integration-webhook-dto';
import {
  buildTypedRootsEnvironment,
  contextRootsForField,
  getWorkflowContextTypeEnvironment,
  workflowContextDocs,
  workflowContextNames,
} from '@shipfox/expression';
import {buildWorkflowJsonSchema, thinkingLevelsForHarness} from '@shipfox/workflow-document';
import {GENERATED_MANIFEST_FILE} from '@/lib/generated-artifacts';
import {inlineCode, tableValue} from '@/lib/markdown';
import {registeredIntegrationProviders} from '@/lib/registered-integration-providers';
import {
  contextFieldRows,
  contextRootShape,
  WORKFLOW_FIELD_YAML_KEYS,
} from './lib/context-reference.mjs';
import {slugForHeading} from './lib/slug.mjs';

const docsRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const markdownLinkPattern = /^\[([^\]]+)\]\(([^)]*)\)$/;
const dtoCatalogBySlug = {
  github: {
    eventCatalog: githubEventCatalog,
    toolCatalog: githubAgentToolCatalog,
    toolSelectionCatalog: githubAgentToolSelectionCatalog,
  },
  jira: {
    eventCatalog: jiraEventCatalog,
    toolCatalog: jiraAgentToolCatalog,
    toolSelectionCatalog: jiraAgentToolSelectionCatalog,
  },
  linear: {
    eventCatalog: linearEventCatalog,
    toolCatalog: linearAgentToolCatalog,
    toolSelectionCatalog: linearAgentToolSelectionCatalog,
  },
  sentry: {
    eventCatalog: sentryEventCatalog,
  },
  slack: {
    eventCatalog: slackEventCatalog,
    toolCatalog: slackAgentToolCatalog,
    toolSelectionCatalog: slackAgentToolSelectionCatalog,
  },
  webhooks: {
    eventCatalog: webhookEventCatalog,
  },
};
const integrationCatalogProviders = registeredIntegrationProviders
  .filter((provider) => provider.kind === 'catalog')
  .map((provider) => ({...provider, ...dtoCatalogBySlug[provider.slug]}));
const regions = [
  {file: 'content/generated/reference/model-providers.mdx', render: renderModelProvidersTable},
  ...integrationCatalogProviders.flatMap((provider) => [
    ...(provider.eventCatalog
      ? [
          {
            file: `content/generated/integrations/${provider.slug}/events.mdx`,
            render: () => renderEventCatalog(provider.eventCatalog),
          },
        ]
      : []),
    ...(provider.toolCatalog
      ? [
          {
            file: `content/generated/integrations/${provider.slug}/tools.mdx`,
            render: () => renderToolCatalog(provider.toolCatalog, provider.toolSelectionCatalog),
          },
        ]
      : []),
  ]),
  {file: 'content/generated/integrations/catalog.json', render: renderIntegrationCatalogData},
  {
    file: 'content/generated/reference/workflow-schema.mdx',
    render: renderWorkflowSchemaArtifact,
    machineReadable: {
      format: 'json',
      file: 'content/generated/reference/workflow-schema.llm.json',
    },
  },
  {file: 'content/generated/reference/context-roots.mdx', render: renderContextRoots},
  {
    file: 'content/generated/reference/context-availability.mdx',
    render: renderContextAvailability,
  },
  {file: 'content/generated/reference/context-properties.mdx', render: renderContextProperties},
];

const contextShapeDeps = {
  getTypeEnvironment: getWorkflowContextTypeEnvironment,
  buildTypedRoots: buildTypedRootsEnvironment,
  contextNames: workflowContextNames,
};

function renderContextRoots() {
  return [
    '| Context | Holds |',
    '|---|---|',
    ...workflowContextDocs.map((doc) => `| \`${doc.root}\` | ${doc.summary} |`),
  ].join('\n');
}

function renderContextAvailability() {
  return [
    '| Workflow key | Available contexts |',
    '|---|---|',
    ...Object.entries(WORKFLOW_FIELD_YAML_KEYS).map(
      ([field, key]) =>
        `| \`${key}\` | ${contextRootsForField(field)
          .map((root) => `\`${root}\``)
          .join(', ')} |`,
    ),
  ].join('\n');
}

function renderContextProperties() {
  return workflowContextDocs.flatMap((doc) => renderContextRoot(doc)).join('\n');
}

function renderContextRoot(doc) {
  const lines = [`### \`${doc.root}\``, '', doc.summary, ''];
  if (doc.shapeNote !== undefined) lines.push(doc.shapeNote, '');

  const shape = contextRootShape(doc.root, contextShapeDeps);
  const rows = shape === undefined ? [] : contextFieldRows(shape, '', doc.collapse ?? []);
  if (rows.length === 0) return lines;

  const prefix = doc.propertyPrefix ?? `${doc.root}.`;
  lines.push('| Property | Type | Description |', '|---|---|---|');
  for (const row of rows) {
    const description = doc.fields?.[row.path];
    if (description === undefined) {
      throw new Error(`Context ${doc.root} property ${row.path} has no description.`);
    }
    lines.push(`| \`${prefix}${row.path}\` | \`${row.type}\` | ${description} |`);
  }
  lines.push('');
  return lines;
}

function renderIntegrationCatalogData() {
  return JSON.stringify(
    Object.fromEntries(
      integrationCatalogProviders.map((provider) => [
        provider.slug,
        {
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

const UNCATEGORIZED_TOOL_CATEGORY = 'tools';

function renderToolMethod(tool, method) {
  return [
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
  ];
}

function renderTool(tool, selectionCatalog) {
  const lines = [
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
  ];
  for (const method of tool.methods ?? []) lines.push(...renderToolMethod(tool, method));
  if (tool.outputSchema) lines.push('', '##### Output', '', ...renderFields(tool.outputSchema));
  lines.push('');
  return lines;
}

function renderToolCatalog(catalog, selectionCatalog) {
  const lines = [];
  const categoryOf = (tool) => tool.category ?? UNCATEGORIZED_TOOL_CATEGORY;
  const categories = [...new Set(catalog.map(categoryOf))];
  for (const category of categories) {
    lines.push(`### ${category.replaceAll('_', ' ')}`, '');
    for (const tool of catalog.filter((candidate) => categoryOf(candidate) === category)) {
      lines.push(...renderTool(tool, selectionCatalog));
    }
  }
  return lines.join('\n').trimEnd();
}

function unwrapNullableProperty(property) {
  const branches = objects(property.anyOf);
  const nullBranch = branches.find((branch) => branch.type === 'null');
  const valueBranch = branches.find((branch) => branch !== nullBranch);
  if (branches.length !== 2 || !nullBranch || !valueBranch) return property;
  return {...valueBranch, type: `${valueBranch.type ?? 'value'} | null`};
}

function escapeTableCell(value) {
  return value.replaceAll('|', '\\|');
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
    const property = unwrapNullableProperty(object(value));
    let requirement = 'Optional';
    if (required.has(name)) requirement = 'Required';
    else if (conditional.has(name)) requirement = 'Conditional';
    const propertyType = Array.isArray(property.type)
      ? property.type.join(' | ')
      : (property.type ?? 'value');
    const type =
      strings(property.enum).length > 0
        ? `${propertyType}: ${strings(property.enum)
            .map((item) => `\`${item}\``)
            .join(', ')}`
        : propertyType;
    return `| \`${name}\` | ${escapeTableCell(type)} | ${requirement} | ${escapeTableCell(property.description ?? '')} |`;
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
  if (Array.isArray(scope) && scope.length > 0)
    return scope
      .map((entry) => `\`${object(entry).permission}:${object(entry).access}\``)
      .join(', ');
  if (typeof scope === 'string' && scope.length > 0) return `\`${scope}\``;
  return 'None.';
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

function renderWorkflowSchemaArtifact() {
  const machineReadable = {};
  const content = renderWorkflowSchemaReference(buildWorkflowJsonSchema(), machineReadable);
  return {content, machineReadable};
}

function renderWorkflowSchemaReference(schema, workflowSchemaMarkdown) {
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
  const session = objectSchemaFor(object(steps.properties).session);

  const output = [
    "import {TypeTable} from 'fumadocs-ui/components/type-table';",
    '',
    workflowComponent(workflowSchemaMarkdown, 'TopLevelFields', root, {
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
    workflowComponent(workflowSchemaMarkdown, 'TriggerFields', object(trigger.properties), {
      required: strings(trigger.required),
    }),
    workflowComponent(workflowSchemaMarkdown, 'JobFields', object(jobs.properties), {
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
    workflowComponent(workflowSchemaMarkdown, 'JobCheckoutFields', object(jobCheckout.properties), {
      nested: {permissions: '#checkout-permissions-fields'},
      types: {permissions: namedType('CheckoutPermissions')},
    }),
    workflowComponent(workflowSchemaMarkdown, 'CheckoutFields', object(checkout.properties), {
      nested: {permissions: '#checkout-permissions-fields'},
      types: {permissions: namedType('CheckoutPermissions')},
    }),
    workflowComponent(
      workflowSchemaMarkdown,
      'CheckoutPermissionsFields',
      object(checkoutPermissions.properties),
    ),
    workflowComponent(workflowSchemaMarkdown, 'RunStepFields', object(steps.properties), {
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
    workflowComponent(workflowSchemaMarkdown, 'ToolStepFields', object(steps.properties), {
      fields: ['key', 'if', 'name', 'tool', 'connection', 'with', 'gate', 'outputs'],
      required: ['tool'],
      nested: {
        gate: '#gate-fields',
        outputs: '#tool-step-outputs',
      },
      types: {
        with: codeType('Record<string, value>'),
        gate: namedType('Gate'),
        outputs: recordType('string'),
      },
    }),
    workflowComponent(workflowSchemaMarkdown, 'CheckoutStepFields', object(steps.properties), {
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
    workflowComponent(workflowSchemaMarkdown, 'AgentStepFields', object(steps.properties), {
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
        'session',
        'gate',
        'outputs',
      ],
      required: ['prompt'],
      nested: {
        integrations: '#agent-integration-fields',
        session: '#agent-session-fields',
        gate: '#gate-fields',
        outputs: '#step-outputs',
      },
      types: {
        thinking: thinkingType(),
        integrations: codeType('Integration[]'),
        session: codeType('string | Session'),
        gate: namedType('Gate'),
        outputs: recordType('Output'),
      },
    }),
    workflowComponent(
      workflowSchemaMarkdown,
      'AgentIntegrationFields',
      object(integration.properties),
      {required: ['include']},
    ),
    workflowComponent(workflowSchemaMarkdown, 'AgentSessionFields', object(session.properties), {
      required: ['key'],
      defaults: {mode: 'resume'},
      types: {key: codeType('string')},
    }),
    workflowComponent(workflowSchemaMarkdown, 'GateFields', object(gate.properties), {
      nested: {on_failure: '#gate-failure-fields'},
      types: {on_failure: namedType('GateFailure')},
    }),
    workflowComponent(workflowSchemaMarkdown, 'GateFailureFields', object(gateFailure.properties), {
      required: ['restart_from'],
    }),
    workflowComponent(workflowSchemaMarkdown, 'StepOutputs', outputFields()),
    workflowComponent(workflowSchemaMarkdown, 'ToolStepOutputs', toolOutputFields()),
    workflowComponent(workflowSchemaMarkdown, 'ListeningFields', object(listening.properties), {
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
    workflowComponent(workflowSchemaMarkdown, 'ListeningBatchFields', object(batch.properties)),
    workflowComponent(workflowSchemaMarkdown, 'EnvironmentVariables', environmentFields()),
  ]
    .filter(Boolean)
    .join('\n\n');

  return output;
}

function component(name, properties, options = {}) {
  const table = renderTypeTable(properties, options)
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
  return [`export function ${name}() {`, '  return (', table, '  );', '}'].join('\n');
}

function workflowComponent(markdown, name, properties, options = {}) {
  markdown[name] = renderTypeTableMarkdown(properties, options);
  return component(name, properties, options);
}

function renderTypeTable(properties, options) {
  const rows = workflowTableRows(properties, options);
  return [
    '<TypeTable',
    '  type={{',
    ...rows.flatMap((row) => [
      `    ${JSON.stringify(row.name)}: {`,
      `      type: ${row.typeExpression},`,
      `      description: ${descriptionFor(row.description)},`,
      ...(row.required ? ['      required: true,'] : []),
      ...(row.defaultValue ? [`      default: ${codeType(row.defaultValue)},`] : []),
      ...(row.nestedHref ? [`      typeDescriptionLink: ${JSON.stringify(row.nestedHref)},`] : []),
      '    },',
    ]),
    '  }}',
    '/>',
  ].join('\n');
}

function renderTypeTableMarkdown(properties, options) {
  const rows = workflowTableRows(properties, options);

  return [
    '| Field | Type | Required | Default | Description |',
    '|---|---|---|---|---|',
    ...rows.map((row) => {
      const linkedType = row.nestedHref
        ? `[${inlineCode(row.type)}](${row.nestedHref})`
        : inlineCode(row.type);
      const defaultText = row.defaultValue ? inlineCode(row.defaultValue) : '-';
      return `| ${inlineCode(row.name)} | ${linkedType} | ${row.required ? 'Required' : 'Optional'} | ${defaultText} | ${tableValue(row.description || '-')} |`;
    }),
  ].join('\n');
}

function workflowTableRows(properties, options) {
  const required = new Set(options.required ?? []);
  const names = options.fields ?? Object.keys(properties);
  return names.flatMap((name) => {
    const property = properties[name];
    if (!property) return [];

    const typeExpression = options.types?.[name] ?? typeFor(property);
    return [
      {
        name,
        typeExpression,
        type: markdownTypeFromExpression(typeExpression),
        required: required.has(name),
        defaultValue: options.defaults?.[name],
        nestedHref: options.nested?.[name],
        description: typeof property.description === 'string' ? property.description : '',
      },
    ];
  });
}

function markdownTypeFromExpression(expression) {
  const values = [...expression.matchAll(/<code>\{("(?:\\.|[^"\\])*")\}<\/code>/g)].map((match) =>
    JSON.parse(match[1]),
  );
  if (values.length > 0) return values.join(' | ');
  return expression;
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

function toolOutputFields() {
  return {
    OUTPUT_NAME: {
      type: 'string',
      description:
        'Output mapping. Use exactly one $' + '{{ }} expression over `result` or `vars`.',
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

for (const region of regions) {
  const path = join(docsRoot, region.file);
  const rendered = region.render();
  const content = typeof rendered === 'string' ? rendered : rendered.content;
  writeGeneratedFile(path, `${content}\n`);

  if (region.machineReadable) {
    if (typeof rendered === 'string' || !rendered.machineReadable) {
      throw new Error(`${region.file} did not return its machine-readable artifact.`);
    }
    writeGeneratedFile(
      join(docsRoot, region.machineReadable.file),
      `${JSON.stringify(rendered.machineReadable, null, 2)}\n`,
    );
  }

  // biome-ignore lint/suspicious/noConsole: CLI diagnostics
  console.log(`✓ wrote ${region.file}`);
}

writeGeneratedFile(
  join(docsRoot, GENERATED_MANIFEST_FILE),
  `${JSON.stringify(
    Object.fromEntries(
      regions.map((region) => [
        region.file,
        region.machineReadable
          ? {format: region.machineReadable.format, file: region.machineReadable.file}
          : {format: 'markdown'},
      ]),
    ),
    null,
    2,
  )}\n`,
);

function writeGeneratedFile(path, content) {
  mkdirSync(dirname(path), {recursive: true});
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, content);
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}
