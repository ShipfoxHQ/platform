import type {
  WorkflowFieldTemplate,
  WorkflowModelStep,
  WorkflowModelToolStep,
  WorkflowModelToolWithTemplate,
  WorkflowModelToolWithTemplates,
  WorkflowModelToolWithValue,
  WorkflowOutputTemplates,
} from '@shipfox/api-definitions-dto';
import type {
  AvailabilitySite,
  ExpressionTypeEnvironment,
  OutputDeclarations,
  OutputTypeDeclaration,
} from '@shipfox/expression';
import type {
  WorkflowDocumentStep,
  WorkflowDocumentToolStepOutputs,
  WorkflowDocumentToolWith,
} from '@shipfox/workflow-document';
import type {
  AgentToolSelector,
  IntegrationValidationContext,
} from '../entities/integration-context.js';
import {classifyUnknownSelection, resolveAgentToolConnection} from './agent-tool-selection.js';
import type {
  WorkflowModelValidationIssue,
  WorkflowModelValidationIssuePathSegment,
} from './invalid-workflow-model-error.js';
import {parseInterpolationField} from './parse-interpolation-field.js';
import {issue} from './validation-issue.js';

export interface NormalizedToolStepOutputs {
  readonly templates: WorkflowOutputTemplates;
  /** Typed declarations mirroring the mapped outputs for expression type overlays. */
  readonly declarations: OutputDeclarations;
}

type ToolStepBaseFields = Pick<
  WorkflowModelStep,
  'id' | 'key' | 'name' | 'workingDirectory' | 'sourceLocation' | 'gate' | 'if'
>;

export function normalizeToolStep(params: {
  step: WorkflowDocumentStep;
  stepBase: ToolStepBaseFields;
  toolOutputs: NormalizedToolStepOutputs | undefined;
  name: WorkflowFieldTemplate | undefined;
  workingDirectory: WorkflowFieldTemplate | undefined;
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
  fillSite: AvailabilitySite;
  allowedJobReferences: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
  integrationValidationContext?: IntegrationValidationContext | undefined;
}): WorkflowModelToolStep {
  if (params.step.tool === undefined) {
    throw new Error('Tool step normalization requires a tool selector');
  }

  const token = params.step.tool;
  const selected = splitSelectorToken(token);
  const connectionSlug =
    params.step.connection ?? params.integrationValidationContext?.defaultConnectionSlug;
  const connectionPath = ['jobs', params.sourceName, 'steps', params.stepIndex, 'connection'];
  const resolved =
    params.integrationValidationContext === undefined
      ? undefined
      : resolveAgentToolConnection({
          connectionSlug,
          context: params.integrationValidationContext,
          connectionPath,
          missingConnectionPath: connectionPath,
          missingConnectionCode: 'tool-step-missing-connection',
          missingConnectionMessage:
            'A tool step requires a connection or a default source connection.',
          issues: params.issues,
        });
  if (resolved !== undefined) {
    validateToolSelector({
      token,
      selectorsByToken: resolved.selectorsByToken,
      sourceName: params.sourceName,
      stepIndex: params.stepIndex,
      issues: params.issues,
    });
  }

  const toolWith = normalizeToolWith({
    with: params.step.with,
    sourceName: params.sourceName,
    stepIndex: params.stepIndex,
    issues: params.issues,
    fillSite: params.fillSite,
    allowedJobReferences: params.allowedJobReferences,
    typeOverlay: params.typeOverlay,
  });
  const templates = optionalToolStepTemplates({
    with: toolWith.templates,
    name: params.name,
    workingDirectory: params.workingDirectory,
  });

  return {
    ...params.stepBase,
    kind: 'tool',
    ...(connectionSlug === undefined ? {} : {connection: connectionSlug}),
    ...(resolved === undefined ? {} : {provider: resolved.connection.provider}),
    tool: selected.tool,
    ...(selected.method === undefined ? {} : {method: selected.method}),
    with: toolWith.value,
    ...(params.toolOutputs === undefined ? {} : {outputs: params.toolOutputs.templates}),
    ...(templates === undefined ? {} : {templates}),
  };
}

function validateToolSelector(params: {
  token: string;
  selectorsByToken: ReadonlyMap<string, AgentToolSelector>;
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
}): void {
  const selector = params.selectorsByToken.get(params.token);
  const path = ['jobs', params.sourceName, 'steps', params.stepIndex, 'tool'];

  if (selector === undefined) {
    const code = classifyUnknownSelection(params.token, params.selectorsByToken);
    params.issues.push(
      issue({
        code,
        message:
          code === 'unknown-integration-method'
            ? `Unknown integration tool method: ${params.token}.`
            : `Unknown integration tool: ${params.token}.`,
        path,
        details: {token: params.token},
      }),
    );
    return;
  }

  if (selector.kind === 'family' || selector.kind === 'family_wildcard') {
    params.issues.push(
      issue({
        code: 'tool-step-ambiguous-selector',
        message: `Tool step selector "${params.token}" matches more than one operation; use a standalone tool id or an explicit "family.method" token.`,
        path,
        details: {token: params.token, kind: selector.kind},
      }),
    );
    return;
  }

  if (selector.sensitive) {
    params.issues.push(
      issue({
        code: 'tool-step-sensitive-tool',
        message: `Tool "${params.token}" is sensitive and cannot be used in a tool step.`,
        path,
        details: {token: params.token},
      }),
    );
  }
}

function normalizeToolWith(params: {
  with: WorkflowDocumentToolWith | undefined;
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
  fillSite: AvailabilitySite;
  allowedJobReferences: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
}): {
  value: Readonly<Record<string, WorkflowModelToolWithValue>>;
  templates: WorkflowModelToolWithTemplates | undefined;
} {
  const value: Record<string, WorkflowModelToolWithValue> = Object.create(null) as Record<
    string,
    WorkflowModelToolWithValue
  >;
  const templates: Record<string, WorkflowModelToolWithTemplate | undefined> = Object.create(
    null,
  ) as Record<string, WorkflowModelToolWithTemplate | undefined>;
  const path: WorkflowModelValidationIssuePathSegment[] = [
    'jobs',
    params.sourceName,
    'steps',
    params.stepIndex,
    'with',
  ];

  for (const [key, raw] of Object.entries(params.with ?? {})) {
    value[key] = raw as WorkflowModelToolWithValue;
    const template = normalizeToolWithValue({
      value: raw,
      path: [...path, key],
      issues: params.issues,
      fillSite: params.fillSite,
      allowedJobReferences: params.allowedJobReferences,
      typeOverlay: params.typeOverlay,
    });
    if (template !== undefined) templates[key] = template;
  }

  return {
    value,
    templates: Object.keys(templates).length === 0 ? undefined : templates,
  };
}

/**
 * Builds the parallel template tree over a `with` value: a node exists only
 * where a string leaf below it carries a `${{ }}` template, and sequence
 * items and record fields keep their authored positions so materialization
 * can walk both trees in lockstep.
 */
function normalizeToolWithValue(params: {
  value: unknown;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  issues: WorkflowModelValidationIssue[];
  fillSite: AvailabilitySite;
  allowedJobReferences: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
}): WorkflowModelToolWithTemplate | undefined {
  const value = params.value;

  if (typeof value === 'string') {
    if (!value.includes('$' + '{{')) return undefined;

    const template = parseInterpolationField({
      field: 'tool.with',
      source: value,
      path: params.path,
      issues: params.issues,
      fillSite: params.fillSite,
      allowedJobReferences: params.allowedJobReferences,
      typeOverlay: params.typeOverlay,
    });
    return template === undefined ? undefined : {kind: 'field', template};
  }

  if (Array.isArray(value)) {
    const items = value.map((item, index) =>
      normalizeToolWithValue({...params, value: item, path: [...params.path, index]}),
    );
    return items.some((item) => item !== undefined) ? {kind: 'sequence', items} : undefined;
  }

  if (typeof value === 'object' && value !== null) {
    const fields: Record<string, WorkflowModelToolWithTemplate | undefined> = Object.create(
      null,
    ) as Record<string, WorkflowModelToolWithTemplate | undefined>;
    let hasTemplate = false;
    for (const [key, child] of Object.entries(value)) {
      const node = normalizeToolWithValue({...params, value: child, path: [...params.path, key]});
      if (node !== undefined) hasTemplate = true;
      fields[key] = node;
    }
    return hasTemplate ? {kind: 'record', fields} : undefined;
  }

  return undefined;
}

export function normalizeToolStepOutputs(params: {
  outputs: WorkflowDocumentToolStepOutputs | undefined;
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
}): NormalizedToolStepOutputs | undefined {
  if (params.outputs === undefined) return undefined;

  const templates: Record<string, WorkflowFieldTemplate> = Object.create(null) as Record<
    string,
    WorkflowFieldTemplate
  >;
  const declarations: Record<string, OutputTypeDeclaration> = Object.create(null) as Record<
    string,
    OutputTypeDeclaration
  >;

  for (const [key, source] of Object.entries(params.outputs)) {
    const template = parseInterpolationField({
      field: 'tool.outputs',
      source,
      path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'outputs', key],
      issues: params.issues,
      fillSite: 'step-report',
    });
    if (template === undefined) continue;

    templates[key] = template;
    declarations[key] = outputDeclarationForTemplate(template);
  }

  return {templates, declarations: declarations as OutputDeclarations};
}

function outputDeclarationForTemplate(template: WorkflowFieldTemplate): OutputTypeDeclaration {
  const [segment] = template;
  const resultType = segment?.kind === 'deferred' ? segment.expression.resultType : undefined;

  switch (resultType) {
    case 'string':
      return {type: 'string'};
    case 'int':
    case 'double':
      return {type: 'number'};
    case 'bool':
      return {type: 'boolean'};
    default:
      return {type: 'json'};
  }
}

function optionalToolStepTemplates(params: {
  with: WorkflowModelToolWithTemplates | undefined;
  name: WorkflowFieldTemplate | undefined;
  workingDirectory: WorkflowFieldTemplate | undefined;
}):
  | {
      with?: WorkflowModelToolWithTemplates;
      name?: WorkflowFieldTemplate;
      workingDirectory?: WorkflowFieldTemplate;
    }
  | undefined {
  if (
    params.with === undefined &&
    params.name === undefined &&
    params.workingDirectory === undefined
  ) {
    return undefined;
  }

  return {
    ...(params.with === undefined ? {} : {with: params.with}),
    ...(params.name === undefined ? {} : {name: params.name}),
    ...(params.workingDirectory === undefined ? {} : {workingDirectory: params.workingDirectory}),
  };
}

function splitSelectorToken(token: string): {tool: string; method?: string} {
  const dotIndex = token.indexOf('.');
  if (dotIndex < 1) return {tool: token};
  return {tool: token.slice(0, dotIndex), method: token.slice(dotIndex + 1)};
}
