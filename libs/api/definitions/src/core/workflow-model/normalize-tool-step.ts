import type {
  WorkflowFieldTemplate,
  WorkflowModelStep,
  WorkflowModelToolStep,
  WorkflowModelToolWithTemplate,
  WorkflowModelToolWithTemplates,
  WorkflowModelToolWithValue,
  WorkflowOutputTemplates,
} from '@shipfox/api-definitions-dto';
import {
  type AvailabilitySite,
  type ExpressionTypeEnvironment,
  type OutputDeclarations,
  type OutputTypeDeclaration,
  parseWorkflowTemplate,
} from '@shipfox/expression';
import {
  WORKFLOW_DOCUMENT_TOOL_WITH_MAX_DEPTH,
  type WorkflowDocumentStep,
  type WorkflowDocumentToolStepOutputs,
  type WorkflowDocumentToolWith,
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
  const selector =
    resolved === undefined
      ? undefined
      : validateToolSelector({
          token,
          selectorsByToken: resolved.selectorsByToken,
          sourceName: params.sourceName,
          stepIndex: params.stepIndex,
          issues: params.issues,
        });
  // A resolved standalone selector is the full tool id even when it contains
  // a dot; split only family.method selections so consumers round-trip the
  // exact token the catalog validated.
  const selected = selector?.kind === 'standalone' ? {tool: token} : splitSelectorToken(token);

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
}): AgentToolSelector | undefined {
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
    return undefined;
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
    return selector;
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

  return selector;
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
    const node = normalizeToolWithValue({
      value: raw,
      // The root `with` record is depth 1, mirroring the document schema.
      depth: 2,
      path: [...path, key],
      issues: params.issues,
      fillSite: params.fillSite,
      allowedJobReferences: params.allowedJobReferences,
      typeOverlay: params.typeOverlay,
    });
    value[key] = node.value;
    if (node.template !== undefined) templates[key] = node.template;
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
 * can walk both trees in lockstep. Returns the deep-copied value alongside
 * the template node so the model never aliases the source document's tree.
 */
function normalizeToolWithValue(params: {
  value: unknown;
  depth: number;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  issues: WorkflowModelValidationIssue[];
  fillSite: AvailabilitySite;
  allowedJobReferences: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
}): {
  value: WorkflowModelToolWithValue;
  template?: WorkflowModelToolWithTemplate | undefined;
} {
  const value = params.value;

  if (typeof value === 'string') {
    if (!value.includes('$' + '{{')) return {value};

    const issuesBefore = params.issues.length;
    const template = parseInterpolationField({
      field: 'tool.with',
      source: value,
      path: params.path,
      issues: params.issues,
      fillSite: params.fillSite,
      allowedJobReferences: params.allowedJobReferences,
      typeOverlay: params.typeOverlay,
    });
    if (template !== undefined) return {value, template: {kind: 'field', template}};
    // An all-literal parse means every `${{` opener was escaped with `$${{`;
    // record a literal node so materialization unescapes the leaf like every
    // other template field instead of passing the `$${{` text through.
    if (params.issues.length === issuesBefore) {
      return {
        value,
        template: {
          kind: 'field',
          template: [{kind: 'literal' as const, value: unescapeTemplateSource(value)}],
        },
      };
    }
    return {value};
  }

  if (Array.isArray(value)) {
    if (params.depth > WORKFLOW_DOCUMENT_TOOL_WITH_MAX_DEPTH) {
      params.issues.push(toolWithDepthIssue(params));
      return {value: []};
    }
    const items: WorkflowModelToolWithValue[] = [];
    const itemTemplates: (WorkflowModelToolWithTemplate | undefined)[] = [];
    let hasTemplate = false;
    value.forEach((item, index) => {
      const node = normalizeToolWithValue({
        ...params,
        value: item,
        depth: params.depth + 1,
        path: [...params.path, index],
      });
      items.push(node.value);
      itemTemplates.push(node.template);
      if (node.template !== undefined) hasTemplate = true;
    });
    return {
      value: items,
      template: hasTemplate ? {kind: 'sequence', items: itemTemplates} : undefined,
    };
  }

  if (typeof value === 'object' && value !== null) {
    if (params.depth > WORKFLOW_DOCUMENT_TOOL_WITH_MAX_DEPTH) {
      params.issues.push(toolWithDepthIssue(params));
      return {value: Object.create(null) as WorkflowModelToolWithValue};
    }
    const fields: Record<string, WorkflowModelToolWithValue> = Object.create(null) as Record<
      string,
      WorkflowModelToolWithValue
    >;
    const templateFields: Record<string, WorkflowModelToolWithTemplate | undefined> = Object.create(
      null,
    ) as Record<string, WorkflowModelToolWithTemplate | undefined>;
    let hasTemplate = false;
    for (const [key, child] of Object.entries(value)) {
      const node = normalizeToolWithValue({
        ...params,
        value: child,
        depth: params.depth + 1,
        path: [...params.path, key],
      });
      fields[key] = node.value;
      templateFields[key] = node.template;
      if (node.template !== undefined) hasTemplate = true;
    }
    return {
      value: fields,
      template: hasTemplate ? {kind: 'record', fields: templateFields} : undefined,
    };
  }

  return {value: value as WorkflowModelToolWithValue};
}

function toolWithDepthIssue(params: {
  depth: number;
  path: readonly WorkflowModelValidationIssuePathSegment[];
}): WorkflowModelValidationIssue {
  return issue({
    code: 'tool-with-max-depth-exceeded',
    message: `Tool \`with\` cannot be nested deeper than ${WORKFLOW_DOCUMENT_TOOL_WITH_MAX_DEPTH} levels.`,
    path: params.path,
    details: {depth: params.depth, maxDepth: WORKFLOW_DOCUMENT_TOOL_WITH_MAX_DEPTH},
  });
}

function unescapeTemplateSource(source: string): string {
  return parseWorkflowTemplate(source)
    .map((segment) => (segment.kind === 'literal' ? segment.text : segment.expression.source))
    .join('');
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
    // A mapping that parses to an all-literal template (`$${{ ... }}` escape)
    // falls back to a literal template, mirroring normalizeJobOutputs, so the
    // key is never silently dropped from the model's outputs.
    const template = parseInterpolationField({
      field: 'tool.outputs',
      source,
      path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'outputs', key],
      issues: params.issues,
      fillSite: 'step-report',
    }) ?? [{kind: 'literal' as const, value: source}];

    templates[key] = template;
    declarations[key] = outputDeclarationForTemplate(template);
  }

  return {templates, declarations: declarations as OutputDeclarations};
}

function outputDeclarationForTemplate(template: WorkflowFieldTemplate): OutputTypeDeclaration {
  // A mapping with literal segments mixed in fills to a string, mirroring
  // inferJobOutputType for job outputs.
  if (template.length !== 1) return {type: 'string'};

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
