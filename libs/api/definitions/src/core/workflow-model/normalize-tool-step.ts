import {
  type AvailabilitySite,
  type ExpressionType,
  type ExpressionTypeEnvironment,
  jsonSchemaToExpressionType,
  type OutputTypeDeclaration,
  type WorkflowExpression,
  type WorkflowStepTypeOverlay,
} from '@shipfox/expression';
import type {WorkflowDocumentStep} from '@shipfox/workflow-document';
import type {IntegrationValidationContext} from '../entities/integration-context.js';
import type {
  WorkflowFieldTemplate,
  WorkflowJsonTemplateTree,
  WorkflowModelToolStep,
} from '../entities/workflow-model.js';
import type {
  WorkflowModelValidationIssue,
  WorkflowModelValidationIssuePathSegment,
} from './invalid-workflow-model-error.js';
import type {WorkflowModelStepBaseFields} from './normalize-jobs.js';
import {parseInterpolationField} from './parse-interpolation-field.js';
import {issue} from './validation-issue.js';

interface ToolCatalogEntry {
  readonly id: string;
  readonly description: string;
  readonly sensitivity: 'read' | 'write';
  readonly sensitive: boolean;
  readonly requiredScope: unknown;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema?: Readonly<Record<string, unknown>>;
  readonly methods?: readonly {readonly id: string}[];
}

export interface NormalizedToolStep {
  readonly step: WorkflowModelToolStep;
  /**
   * The `steps.<key>` type overlay recorded for this step so later steps and
   * job outputs see the tool result typed from the catalog output schema.
   */
  readonly overlay: WorkflowStepTypeOverlay;
}

export function normalizeToolStep(params: {
  step: WorkflowDocumentStep;
  stepBase: WorkflowModelStepBaseFields;
  sourceName: string;
  stepIndex: number;
  name: WorkflowFieldTemplate | undefined;
  issues: WorkflowModelValidationIssue[];
  fillSite: AvailabilitySite;
  allowedJobReferences: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
  integrationValidationContext?: IntegrationValidationContext | undefined;
}): NormalizedToolStep {
  const tool = splitToolId(params.step.tool);
  const catalogEntry = validateConnectionAndTool({
    ...params,
    tool,
  });
  const outputSchema = catalogEntry?.outputSchema;

  const withTemplates = normalizeWithTemplates({
    ...params,
    withValue: params.step.with,
  });
  const outputMappings = normalizeOutputMappings({
    ...params,
    outputs: params.step.outputs,
    resultTypeOverlay:
      outputSchema === undefined ? undefined : {result: jsonSchemaToExpressionType(outputSchema)},
  });
  if (catalogEntry !== undefined) {
    validateToolInputs({
      ...params,
      tool,
      withValue: params.step.with,
      schema: catalogEntry.inputSchema,
    });
  }
  if (tool.method !== undefined && params.step.with !== undefined) {
    rejectWithMethod({...params, tool, withValue: params.step.with});
  }

  const step: WorkflowModelToolStep = {
    ...params.stepBase,
    kind: 'tool',
    tool,
    ...(params.step.connection === undefined ? {} : {connection: params.step.connection}),
    ...(params.step.with === undefined ? {} : {with: params.step.with}),
    ...(outputMappings === undefined ? {} : {outputMappings}),
    ...(withTemplates === undefined && params.name === undefined
      ? {}
      : {
          templates: {
            ...(withTemplates === undefined ? {} : {with: withTemplates}),
            ...(params.name === undefined ? {} : {name: params.name}),
          },
        }),
  };

  return {
    step,
    overlay: {
      key: params.stepBase.key ?? step.id,
      kind: 'tool',
      ...(outputMappings === undefined
        ? {}
        : {outputs: outputMappingsToDeclarations(outputMappings)}),
      ...(outputSchema === undefined ? {} : {outputSchema}),
    },
  };
}

function splitToolId(source: string | undefined): {readonly id: string; readonly method?: string} {
  const toolId = source ?? '';
  const dotIndex = toolId.indexOf('.');
  if (dotIndex < 1 || dotIndex === toolId.length - 1) return {id: toolId};
  return {id: toolId.slice(0, dotIndex), method: toolId.slice(dotIndex + 1)};
}

function validateConnectionAndTool(params: {
  step: WorkflowDocumentStep;
  tool: {readonly id: string; readonly method?: string};
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
  integrationValidationContext?: IntegrationValidationContext | undefined;
}): ToolCatalogEntry | undefined {
  const context = params.integrationValidationContext;
  if (context === undefined) return undefined;

  const connectionSlug = params.step.connection ?? context.defaultConnectionSlug;
  if (connectionSlug === undefined) {
    params.issues.push(
      issue({
        code: 'missing-connection-for-tool',
        message: 'Tool step requires a connection or a default source connection.',
        path: toolConnectionPath(params),
      }),
    );
    return undefined;
  }

  const connection = context.workspaceConnectionSnapshot.get(connectionSlug);
  if (connection === undefined) {
    params.issues.push(
      issue({
        code: 'integration-connection-not-found',
        message: `Tool step connection "${connectionSlug}" was not found in the workspace.`,
        path: toolConnectionPath(params),
        details: {connection: connectionSlug},
      }),
    );
    return undefined;
  }

  const catalog = context.agentToolCatalogs.get(connection.provider);
  if (catalog === undefined || !connection.capabilities.includes('agent_tools')) {
    params.issues.push(
      issue({
        code: 'integration-connection-not-capable',
        message: `Tool step connection "${connectionSlug}" does not support agent tools.`,
        path: toolConnectionPath(params),
        details: {
          connection: connectionSlug,
          provider: connection.provider,
          capabilities: connection.capabilities,
        },
      }),
    );
    return undefined;
  }

  return findToolEntry({
    ...params,
    catalog: catalog.tools,
    source: params.step.tool ?? params.tool.id,
  });
}

function findToolEntry(params: {
  tool: {readonly id: string; readonly method?: string};
  catalog: readonly ToolCatalogEntry[];
  source: string;
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
}): ToolCatalogEntry | undefined {
  const entry = params.catalog.find((candidate) => candidate.id === params.tool.id);
  if (entry === undefined) {
    params.issues.push(
      issue({
        code: 'unknown-integration-tool',
        message: `Unknown integration tool: ${params.source}.`,
        path: toolIdPath(params),
        details: {tool: params.tool.id},
      }),
    );
    return undefined;
  }

  if (entry.methods === undefined) {
    if (params.tool.method === undefined) return entry;
    params.issues.push(
      issue({
        code: 'unknown-integration-tool',
        message: `Unknown integration tool: ${params.source}.`,
        path: toolIdPath(params),
        details: {tool: params.tool.id},
      }),
    );
    return undefined;
  }

  const methodLabels = entry.methods.map((method) => `${entry.id}.${method.id}`);
  if (params.tool.method === undefined) {
    params.issues.push(
      issue({
        code: 'unknown-integration-tool',
        message: `Tool "${entry.id}" names a method family; specify one of its methods. Available methods: ${methodLabels.join(', ')}.`,
        path: toolIdPath(params),
        details: {tool: entry.id, methods: methodLabels},
      }),
    );
    return undefined;
  }

  if (!entry.methods.some((method) => method.id === params.tool.method)) {
    params.issues.push(
      issue({
        code: 'unknown-integration-tool',
        message: `Unknown integration tool method "${entry.id}.${params.tool.method}". Available methods: ${methodLabels.join(', ')}.`,
        path: toolIdPath(params),
        details: {tool: entry.id, method: params.tool.method, methods: methodLabels},
      }),
    );
    return undefined;
  }

  return entry;
}

function normalizeWithTemplates(params: {
  step: WorkflowDocumentStep;
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
  fillSite: AvailabilitySite;
  allowedJobReferences: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
  withValue: Readonly<Record<string, unknown>> | undefined;
}): WorkflowJsonTemplateTree | undefined {
  if (params.withValue === undefined) return undefined;
  return walkWithValue({
    value: params.withValue,
    path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'with'],
    ...params,
  });
}

function walkWithValue(params: {
  value: unknown;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
  fillSite: AvailabilitySite;
  allowedJobReferences: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
}): WorkflowJsonTemplateTree | undefined {
  if (Array.isArray(params.value)) {
    const trees = params.value.map((child, index) =>
      walkWithValue({...params, value: child, path: [...params.path, index]}),
    );
    return trees.every((tree) => tree === undefined) ? undefined : trees;
  }

  if (isPlainRecord(params.value)) {
    const entries = Object.entries(params.value).flatMap(([key, child]) => {
      const tree = walkWithValue({...params, value: child, path: [...params.path, key]});
      return tree === undefined ? [] : [[key, tree] as const];
    });
    return entries.length === 0 ? undefined : Object.fromEntries(entries);
  }

  if (typeof params.value !== 'string') return undefined;

  return parseInterpolationField({
    field: 'tool.with',
    source: params.value,
    path: params.path,
    issues: params.issues,
    fillSite: params.fillSite,
    allowedJobReferences: params.allowedJobReferences,
    typeOverlay: params.typeOverlay,
  });
}

function normalizeOutputMappings(params: {
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
  outputs: WorkflowDocumentStep['outputs'];
  resultTypeOverlay?: ExpressionTypeEnvironment | undefined;
}): Readonly<Record<string, WorkflowExpression>> | undefined {
  if (params.outputs === undefined) return undefined;

  const mappings: Record<string, WorkflowExpression> = {};
  for (const [key, source] of Object.entries(params.outputs)) {
    if (key === 'result') {
      params.issues.push(
        issue({
          code: 'tool-input-invalid',
          message: 'The "result" output is reserved for the tool result and cannot be redeclared.',
          path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'outputs', key],
          details: {output: key},
        }),
      );
      continue;
    }

    if (typeof source !== 'string') {
      params.issues.push(
        issue({
          code: 'tool-input-invalid',
          message: `Tool step output "${key}" must be a mapping of keys to exactly one $${'{{ }}'} expression.`,
          path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'outputs', key],
          details: {output: key},
        }),
      );
      continue;
    }

    const template = parseInterpolationField({
      field: 'tool.outputs',
      source,
      path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'outputs', key],
      issues: params.issues,
      fillSite: 'step-report',
      typeOverlay: params.resultTypeOverlay,
    });
    if (template === undefined || template.length !== 1 || template[0]?.kind !== 'deferred') {
      params.issues.push(
        issue({
          code: 'tool-input-invalid',
          message: `Tool step output mapping "${key}" must be exactly one $${'{{ }}'} expression over "result" or "vars".`,
          path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'outputs', key],
          details: {output: key, source},
        }),
      );
      continue;
    }

    mappings[key] = template[0].expression;
  }

  return Object.keys(mappings).length === 0 ? undefined : mappings;
}

function outputMappingsToDeclarations(
  mappings: Readonly<Record<string, WorkflowExpression>>,
): Readonly<Record<string, OutputTypeDeclaration>> {
  return Object.fromEntries(
    Object.entries(mappings).map(([key, expression]) => [
      key,
      expressionTypeToDeclaration(expression.resultType),
    ]),
  );
}

function expressionTypeToDeclaration(type: ExpressionType | undefined): OutputTypeDeclaration {
  switch (type) {
    case 'string':
      return {type: 'string'};
    case 'int':
      return {type: 'number'};
    case 'double':
      return {type: 'number'};
    case 'bool':
      return {type: 'boolean'};
    default:
      return {type: 'json'};
  }
}

function validateToolInputs(params: {
  tool: {readonly id: string; readonly method?: string};
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
  withValue: Readonly<Record<string, unknown>> | undefined;
  schema: Readonly<Record<string, unknown>>;
}): void {
  validateInputRecord({
    ...params,
    record: params.withValue ?? {},
    schema: params.schema,
    path: ['with'],
  });
}

function validateInputRecord(params: {
  record: Readonly<Record<string, unknown>>;
  schema: Readonly<Record<string, unknown>>;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  tool: {readonly id: string; readonly method?: string};
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
}): void {
  const toolDisplayName = toolLabel(params.tool);
  const properties = isPlainRecord(params.schema.properties) ? params.schema.properties : {};

  if (params.schema.additionalProperties === false) {
    for (const key of Object.keys(params.record)) {
      if (Object.hasOwn(properties, key)) continue;
      params.issues.push(
        issue({
          code: 'tool-input-unknown-key',
          message: `Unknown tool input "${key}" for tool "${toolDisplayName}".`,
          path: ['jobs', params.sourceName, 'steps', params.stepIndex, ...params.path, key],
          details: {tool: toolDisplayName, key},
        }),
      );
    }
  }

  for (const key of requiredKeys(params.schema)) {
    if (Object.hasOwn(params.record, key)) continue;
    params.issues.push(
      issue({
        code: 'tool-input-invalid',
        message: `Tool "${toolDisplayName}" requires input "${key}".`,
        path: ['jobs', params.sourceName, 'steps', params.stepIndex, ...params.path, key],
        details: {tool: toolDisplayName, key},
      }),
    );
  }

  for (const [key, value] of Object.entries(params.record)) {
    const propertySchema = properties[key];
    if (propertySchema === undefined || !isPlainRecord(propertySchema)) continue;
    validateInputValue({
      ...params,
      value,
      schema: propertySchema,
      path: [...params.path, key],
    });
  }
}

function validateInputValue(params: {
  value: unknown;
  schema: Readonly<Record<string, unknown>>;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  tool: {readonly id: string; readonly method?: string};
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
}): void {
  // Interpolated leaves are re-checked at dispatch, after residual expressions fill.
  if (typeof params.value === 'string' && params.value.includes('$' + '{{')) return;

  if (Array.isArray(params.value)) {
    if (!schemaAllowsType(params.schema, 'array')) {
      pushTypeMismatch(params, 'array');
      return;
    }
    const items = params.schema.items;
    if (!isPlainRecord(items)) return;
    for (const [index, item] of params.value.entries()) {
      validateInputValue({...params, value: item, schema: items, path: [...params.path, index]});
    }
    return;
  }

  if (isPlainRecord(params.value)) {
    if (!schemaAllowsType(params.schema, 'object')) {
      pushTypeMismatch(params, 'object');
      return;
    }
    validateInputRecord({...params, record: params.value, schema: params.schema});
    return;
  }

  if (!literalLeafMatchesType(params.value, params.schema)) {
    pushTypeMismatch(params, foundTypeLabel(params.value));
  }
}

function pushTypeMismatch(
  params: {
    schema: Readonly<Record<string, unknown>>;
    path: readonly WorkflowModelValidationIssuePathSegment[];
    tool: {readonly id: string; readonly method?: string};
    sourceName: string;
    stepIndex: number;
    issues: WorkflowModelValidationIssue[];
  },
  foundLabel: string,
): void {
  params.issues.push(
    issue({
      code: 'tool-input-invalid',
      message: `Tool input "${params.path.join('.')}" must be ${expectedTypeLabel(params.schema)}; found ${foundLabel}.`,
      path: ['jobs', params.sourceName, 'steps', params.stepIndex, ...params.path],
      details: {
        tool: toolLabel(params.tool),
        expected: expectedTypeLabel(params.schema),
        found: foundLabel,
      },
    }),
  );
}

function literalLeafMatchesType(
  value: unknown,
  schema: Readonly<Record<string, unknown>>,
): boolean {
  const type = schema.type;
  if (type === undefined) return true;
  const types = Array.isArray(type) ? type : [type];

  if (value === null) return types.includes('null');
  if (typeof value === 'string') return types.includes('string');
  if (typeof value === 'boolean') return types.includes('boolean');
  if (typeof value === 'number') {
    if (types.includes('number')) return true;
    return types.includes('integer') && Number.isInteger(value);
  }
  return true;
}

function schemaAllowsType(schema: Readonly<Record<string, unknown>>, type: string): boolean {
  const declared = schema.type;
  if (declared === undefined) return true;
  const types = Array.isArray(declared) ? declared : [declared];
  return types.includes(type);
}

function expectedTypeLabel(schema: Readonly<Record<string, unknown>>): string {
  const type = schema.type;
  const types = type === undefined ? [] : Array.isArray(type) ? type : [type];
  return types.length === 0 ? 'a supported type' : types.join(' or ');
}

function foundTypeLabel(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function requiredKeys(schema: Readonly<Record<string, unknown>>): readonly string[] {
  if (!Array.isArray(schema.required)) return [];
  return schema.required.filter((key): key is string => typeof key === 'string');
}

function rejectWithMethod(params: {
  tool: {readonly id: string; readonly method?: string};
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
  withValue: Readonly<Record<string, unknown>>;
}): void {
  if (!Object.hasOwn(params.withValue, 'method')) return;

  params.issues.push(
    issue({
      code: 'tool-input-invalid',
      message: `"method" is not a valid tool input; the server injects it for "${params.tool.id}.${params.tool.method}" tools.`,
      path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'with', 'method'],
      details: {tool: params.tool.id, method: params.tool.method},
    }),
  );
}

function toolLabel(tool: {readonly id: string; readonly method?: string}): string {
  return tool.method === undefined ? tool.id : `${tool.id}.${tool.method}`;
}

function toolIdPath(params: {
  sourceName: string;
  stepIndex: number;
}): readonly WorkflowModelValidationIssuePathSegment[] {
  return ['jobs', params.sourceName, 'steps', params.stepIndex, 'tool'];
}

function toolConnectionPath(params: {
  step: WorkflowDocumentStep;
  sourceName: string;
  stepIndex: number;
}): readonly WorkflowModelValidationIssuePathSegment[] {
  const path = ['jobs', params.sourceName, 'steps', params.stepIndex] as const;
  return params.step.connection === undefined ? [...path, 'tool'] : [...path, 'connection'];
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
