import {
  type AvailabilitySite,
  type ExpressionType,
  type ExpressionTypeEnvironment,
  jsonSchemaToExpressionType,
  type OutputTypeDeclaration,
  parseWorkflowTemplate,
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

type NormalizeToolStepParams = Parameters<typeof normalizeToolStep>[0];
type ParsedToolId = {readonly id: string; readonly method?: string};

function validateToolConnection(params: NormalizeToolStepParams): boolean {
  const interpolated =
    params.step.connection !== undefined && isInterpolated(params.step.connection);
  if (!interpolated) return false;
  params.issues.push(
    issue({
      code: 'tool-id-invalid',
      message: `Connection slug "${params.step.connection}" must be literal. Interpolation is rejected.`,
      path: toolConnectionPath(params),
      details: {connection: params.step.connection},
    }),
  );
  return true;
}

function resolveToolCatalogEntry(
  params: NormalizeToolStepParams,
  tool: ParsedToolId | undefined,
  connectionIsInterpolated: boolean,
): ToolCatalogEntry | undefined {
  if (tool === undefined || connectionIsInterpolated) return undefined;
  return validateConnectionAndTool({...params, tool});
}

function validateResolvedTool(
  params: NormalizeToolStepParams,
  tool: ParsedToolId | undefined,
  catalogEntry: ToolCatalogEntry | undefined,
): void {
  if (catalogEntry !== undefined && tool !== undefined) {
    validateToolInputs({
      ...params,
      tool,
      withValue: params.step.with,
      schema: catalogEntry.inputSchema,
    });
  }
  if (tool?.method !== undefined && params.step.with !== undefined) {
    rejectWithMethod({...params, tool, withValue: params.step.with});
  }
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
  // The document schema rejects interpolated `tool` and `connection` values at
  // parse. Mirror that at the model boundary so typed callers that bypass the
  // schema cannot freeze a raw template into the model: a non-literal id or
  // slug fails with `tool-id-invalid` and skips the catalog lookup so each
  // root cause reports exactly one issue.
  const tool = splitToolId({
    source: params.step.tool,
    sourceName: params.sourceName,
    stepIndex: params.stepIndex,
    issues: params.issues,
  });
  const connectionIsInterpolated = validateToolConnection(params);
  const catalogEntry = resolveToolCatalogEntry(params, tool, connectionIsInterpolated);
  const outputSchema = catalogEntry?.outputSchema;

  const withTemplates = normalizeWithTemplates({
    ...params,
    withValue: params.step.with,
  });
  const outputMappings = normalizeOutputMappings({
    ...params,
    outputs: params.step.outputs,
    // Keep schema-less tool results open while still type-checking mappings so
    // unknown field values are persisted as CEL dyn instead of syntax-only
    // expressions.
    resultTypeOverlay: {
      result: outputSchema === undefined ? {kind: 'dyn'} : jsonSchemaToExpressionType(outputSchema),
    },
  });
  validateResolvedTool(params, tool, catalogEntry);

  const step = createNormalizedToolModelStep({
    params,
    tool,
    withTemplates,
    outputMappings,
  });

  return {
    step,
    overlay: createToolStepOverlay(params, step, outputMappings, outputSchema),
  };
}

function createNormalizedToolModelStep(params: {
  params: NormalizeToolStepParams;
  tool: ParsedToolId | undefined;
  withTemplates: WorkflowJsonTemplateTree | undefined;
  outputMappings: Record<string, WorkflowExpression> | undefined;
}): WorkflowModelToolStep {
  const {params: input, tool, withTemplates, outputMappings} = params;
  return {
    ...input.stepBase,
    kind: 'tool',
    // An invalid id (interpolated or mis-shaped) is frozen unsplit; the emitted
    // `tool-id-invalid` issue fails normalization, so the model is never used.
    tool: tool ?? {id: input.step.tool ?? ''},
    ...(input.step.connection === undefined ? {} : {connection: input.step.connection}),
    ...(input.step.with === undefined ? {} : {with: input.step.with}),
    ...(outputMappings === undefined
      ? {}
      : {outputs: outputMappingsToDeclarations(outputMappings)}),
    ...(outputMappings === undefined ? {} : {outputMappings}),
    ...(withTemplates === undefined && input.name === undefined
      ? {}
      : {
          templates: {
            ...(withTemplates === undefined ? {} : {with: withTemplates}),
            ...(input.name === undefined ? {} : {name: input.name}),
          },
        }),
  };
}

function createToolStepOverlay(
  params: NormalizeToolStepParams,
  step: WorkflowModelToolStep,
  outputMappings: Record<string, WorkflowExpression> | undefined,
  outputSchema: Readonly<Record<string, unknown>> | undefined,
): WorkflowStepTypeOverlay {
  return {
    key: params.stepBase.key ?? step.id,
    kind: 'tool',
    ...(outputMappings === undefined
      ? {}
      : {outputs: outputMappingsToDeclarations(outputMappings)}),
    ...(outputSchema === undefined ? {} : {outputSchema}),
  };
}

function splitToolId(params: {
  source: string | undefined;
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
}): {readonly id: string; readonly method?: string} | undefined {
  const toolId = params.source ?? '';

  if (isInterpolated(toolId)) {
    params.issues.push(
      issue({
        code: 'tool-id-invalid',
        message: 'Tool id must be literal. Interpolation is rejected.',
        path: toolIdPath(params),
        details: {tool: toolId},
      }),
    );
    return undefined;
  }

  const dotIndex = toolId.indexOf('.');
  if (dotIndex < 0) return {id: toolId};

  if (dotIndex === 0 || dotIndex === toolId.length - 1) {
    params.issues.push(toolIdInvalidIssue(params, toolId));
    return undefined;
  }

  const method = toolId.slice(dotIndex + 1);
  if (method.includes('.')) {
    params.issues.push(toolIdInvalidIssue(params, toolId));
    return undefined;
  }
  return {id: toolId.slice(0, dotIndex), method};
}

function toolIdInvalidIssue(
  params: {sourceName: string; stepIndex: number},
  toolId: string,
): WorkflowModelValidationIssue {
  return issue({
    code: 'tool-id-invalid',
    message: `Tool id "${toolId}" must be a standalone tool id or "family.method" with a single dot.`,
    path: toolIdPath(params),
    details: {tool: toolId},
  });
}

/**
 * True when the source carries an interpolation expression. Mirrors the
 * document schema's literal-name rule: `$${{` is the escaped literal form and
 * stays literal, while any other `${{ ... }}` expression is rejected.
 */
function isInterpolated(source: string): boolean {
  try {
    return parseWorkflowTemplate(source).some((segment) => segment.kind === 'expr');
  } catch {
    // Malformed template syntax can never be a literal id or slug.
    return true;
  }
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

  if (params.tool.method === undefined) {
    const methodLabels = entry.methods.map((method) => `${entry.id}.${method.id}`);
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
    const methodLabels = entry.methods.map((method) => `${entry.id}.${method.id}`);
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

  const mappings: Readonly<Record<string, WorkflowExpression>> = Object.fromEntries(
    Object.entries(params.outputs).flatMap(([key, source]) => {
      if (key === 'result') {
        params.issues.push(
          issue({
            code: 'tool-output-invalid',
            message:
              'The "result" output is reserved for the tool result and cannot be redeclared.',
            path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'outputs', key],
            details: {output: key},
          }),
        );
        return [];
      }

      if (typeof source !== 'string') {
        params.issues.push(
          issue({
            code: 'tool-output-invalid',
            message: `Tool step output "${key}" must be a mapping of keys to exactly one $${'{{ }}'} expression.`,
            path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'outputs', key],
            details: {output: key},
          }),
        );
        return [];
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
            code: 'tool-output-invalid',
            message: `Tool step output mapping "${key}" must be exactly one $${'{{ }}'} expression over "result" or "vars".`,
            path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'outputs', key],
            details: {output: key, source},
          }),
        );
        return [];
      }

      // `Object.fromEntries` creates `__proto__` as an own data property;
      // assigning `mappings[key]` would hit the prototype setter instead.
      return [[key, template[0].expression] as const];
    }),
  );

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
  if (type === undefined || (typeof type === 'object' && type.kind === 'dyn')) {
    return {type: 'json'};
  }

  switch (type) {
    case 'string':
      return {type: 'string'};
    case 'int':
      return {type: 'number'};
    case 'double':
      return {type: 'number'};
    case 'bool':
      return {type: 'boolean'};
    case 'null':
    case 'timestamp':
      return {type: 'json'};
    default:
      // Structured (object/map/list) result types keep their shape in the
      // declaration schema so the step overlay re-derives list/object typing
      // for later expressions instead of degrading to schema-less JSON.
      return {type: 'json', schema: expressionTypeToJsonSchema(type)};
  }
}

function expressionTypeToJsonSchema(type: ExpressionType): Readonly<Record<string, unknown>> {
  switch (type) {
    case 'string':
      return {type: 'string'};
    case 'int':
      return {type: 'integer'};
    case 'double':
      return {type: 'number'};
    case 'bool':
      return {type: 'boolean'};
    case 'null':
      return {type: 'null'};
    case 'timestamp':
      // `jsonSchemaToExpressionType` reads only `type` and ignores `format`, so
      // claiming `format: 'date-time'` here would degrade timestamps to strings
      // on the next round trip. Keep the reverse conversion honest.
      return {type: 'string'};
    default:
      switch (type.kind) {
        case 'dyn':
          return {};
        case 'object':
          return {
            type: 'object',
            properties: Object.fromEntries(
              Object.entries(type.fields).map(([field, fieldType]) => [
                field,
                expressionTypeToJsonSchema(fieldType),
              ]),
            ),
            required: Object.keys(type.fields),
            additionalProperties: false,
          };
        case 'map':
          return {type: 'object'};
        case 'list':
          return {type: 'array', items: expressionTypeToJsonSchema(type.element)};
      }
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
  // For `family.method` tools the provider catalog lists `method` as a required
  // schema property, but the server injects it at dispatch and authors cannot
  // set it (`rejectWithMethod` guards the authored side). Skip it in the
  // required and unknown-key loops at the top level so the two never conflict.
  const serverInjectedMethod =
    params.tool.method === undefined || params.path.length !== 1 ? undefined : 'method';

  validateUnknownInputKeys(params, properties, serverInjectedMethod, toolDisplayName);
  validateRequiredInputKeys(params, serverInjectedMethod, toolDisplayName);
  validateNestedInputValues(params, properties);
}

type ValidateInputRecordParams = Parameters<typeof validateInputRecord>[0];

function validateUnknownInputKeys(
  params: ValidateInputRecordParams,
  properties: Readonly<Record<string, unknown>>,
  serverInjectedMethod: string | undefined,
  toolDisplayName: string,
): void {
  if (params.schema.additionalProperties !== false) return;
  for (const key of Object.keys(params.record)) {
    if (key === serverInjectedMethod || Object.hasOwn(properties, key)) continue;
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

function validateRequiredInputKeys(
  params: ValidateInputRecordParams,
  serverInjectedMethod: string | undefined,
  toolDisplayName: string,
): void {
  for (const key of requiredKeys(params.schema)) {
    if (key === serverInjectedMethod || Object.hasOwn(params.record, key)) continue;
    params.issues.push(
      issue({
        code: 'tool-input-invalid',
        message: `Tool "${toolDisplayName}" requires input "${key}".`,
        path: ['jobs', params.sourceName, 'steps', params.stepIndex, ...params.path, key],
        details: {tool: toolDisplayName, key},
      }),
    );
  }
}

function validateNestedInputValues(
  params: ValidateInputRecordParams,
  properties: Readonly<Record<string, unknown>>,
): void {
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
  let types: unknown[] = [];
  if (Array.isArray(type)) types = type;
  else if (type !== undefined) types = [type];
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
