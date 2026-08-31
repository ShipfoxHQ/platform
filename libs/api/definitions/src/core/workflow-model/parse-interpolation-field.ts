import {secretKeySchema, secretStoreSchema} from '@shipfox/api-secrets-dto';
import {
  type AvailabilitySite,
  analyzeContextKeyAccess,
  analyzeContextRootKeyAccess,
  contextRootsForField,
  createWorkflowExpression,
  type ExpressionTypeEnvironment,
  getWorkflowContextTypeEnvironment,
  getWorkflowInterpolationFieldSelfReference,
  getWorkflowInterpolationFieldTypeEnvironment,
  InvalidWorkflowExpressionError,
  InvalidWorkflowTemplateError,
  type PlanViolation,
  parseWorkflowTemplate,
  planInterpolationField,
  resolveContextRootAvailability,
  resolveContextRootHost,
  unavailableRootsAt,
  type WorkflowContextName,
  type WorkflowContextReservedRoot,
  type WorkflowInterpolationField,
  type WorkflowTemplateExprSegment,
  type WorkflowTemplateSegment,
  workflowContextNames,
  workflowInterpolationFieldAcceptsHost,
} from '@shipfox/expression';
import type {WorkflowFieldTemplate} from '../entities/workflow-model.js';
import type {
  WorkflowModelValidationIssue,
  WorkflowModelValidationIssuePathSegment,
} from './invalid-workflow-model-error.js';
import {validateDirectJobReferences} from './validate-job-references.js';
import {issue} from './validation-issue.js';

export type StoredInterpolationField =
  | 'run'
  | 'env.value'
  | 'agent.prompt'
  | 'agent.model'
  | 'agent.provider'
  | 'agent.thinking'
  | 'agent.session'
  | 'job.outputs'
  | 'workflow.run_name'
  | 'job.execution_name'
  | 'job.runner'
  | 'step.name'
  | 'step.working_directory'
  | 'step.feedback'
  | 'checkout.project'
  | 'checkout.connection'
  | 'checkout.repository'
  | 'checkout.ref'
  | 'checkout.path'
  | 'tool.with'
  | 'tool.outputs';

export function parseInterpolationField(params: {
  field: StoredInterpolationField;
  source: string;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  issues: WorkflowModelValidationIssue[];
  fillSite?: AvailabilitySite;
  allowedJobReferences?: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
}): WorkflowFieldTemplate | undefined {
  const segments = parseTemplate(params);
  if (segments === undefined) return undefined;

  const expressionSegments = segments.filter(isExpressionSegment);
  if (expressionSegments.length === 0) return undefined;

  const checkedSegments = segments.map((segment) => {
    if (segment.kind === 'literal') return segment;

    const validatedSegment = validateExpressionSegment({...params, segment});
    return validatedSegment ?? segment;
  });

  const plan = planInterpolationField({field: params.field, segments: checkedSegments});
  if (!plan.ok) {
    params.issues.push(
      ...plan.violations.map((violation) => planViolationIssue(params, violation)),
    );
    return undefined;
  }

  return plan.plan.field.segments;
}

function dynamicNameSelfReference(params: {
  field: StoredInterpolationField;
  source: string;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  segment: WorkflowTemplateExprSegment;
}): WorkflowModelValidationIssue | undefined {
  const target = getWorkflowInterpolationFieldSelfReference(params.field);
  if (target === undefined) return undefined;

  const access = analyzeContextRootKeyAccess(params.segment.expression, [target.root]);
  const reference = access.references.find((entry) => entry.key === target.key);
  const computedReference = access.violations.find(
    (violation) =>
      violation.root === target.root &&
      (violation.key === undefined || violation.key === target.key),
  );
  if (reference === undefined && computedReference === undefined) return undefined;

  return issue({
    code: 'dynamic-name-self-reference',
    message: `${fieldLabel(params.field)} interpolation cannot reference its own dynamic name.`,
    path: params.path,
    details: {
      field: params.field,
      source: params.source,
      expression: params.segment.expression.source,
      reference:
        reference === undefined ? `${target.root}[computed]` : `${reference.root}.${reference.key}`,
    },
  });
}

function parseTemplate(params: {
  field: WorkflowInterpolationField;
  source: string;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  issues: WorkflowModelValidationIssue[];
}): WorkflowTemplateSegment[] | undefined {
  try {
    return parseWorkflowTemplate(params.source);
  } catch (error) {
    params.issues.push(
      issue({
        code: 'invalid-interpolation-template',
        message: `${fieldLabel(params.field)} must use valid $${'{{ }}'} interpolation syntax.`,
        path: params.path,
        details: {
          field: params.field,
          source: params.source,
          reason:
            error instanceof InvalidWorkflowTemplateError
              ? error.reason
              : 'Template source did not parse.',
        },
      }),
    );
    return undefined;
  }
}

function validateExpressionSegment(params: {
  field: StoredInterpolationField;
  source: string;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  issues: WorkflowModelValidationIssue[];
  segment: WorkflowTemplateExprSegment;
  fillSite?: AvailabilitySite;
  allowedJobReferences?: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
}): WorkflowTemplateExprSegment | undefined {
  const contextRoots = uniqueStrings(params.segment.contextRoots);
  const fieldRoots = new Set<string>(contextRootsForField(params.field));
  const recognizedRoots = contextRoots.filter(isWorkflowContextRoot);

  const rejectedHostRoots = recognizedRoots.filter((root) => {
    const host = resolveContextRootHost(root);
    return host !== undefined && !workflowInterpolationFieldAcceptsHost(params.field, host);
  });
  if (rejectedHostRoots.length > 0) {
    params.issues.push(runnerContextInFieldIssue({...params, contextRoots, rejectedHostRoots}));
    return undefined;
  }

  const knownRoots = recognizedRoots.filter((root) => fieldRoots.has(root));
  const unknownRoots = contextRoots.filter((root) => !fieldRoots.has(root));

  const keyAccess = analyzeContextKeyAccess(params.segment.expression);
  if (keyAccess.violations.length > 0) {
    params.issues.push(
      ...keyAccess.violations.map((violation) =>
        computedContextKeyIssue({
          ...params,
          contextRoots,
          root: violation.root,
          expression: violation.source,
        }),
      ),
    );
    return undefined;
  }

  const selfReference = dynamicNameSelfReference(params);
  if (selfReference !== undefined) {
    params.issues.push(selfReference);
    return undefined;
  }

  const invalidReferenceIssue = validateContextKeyReferences({
    ...params,
    contextRoots,
    references: keyAccess.references,
  });
  if (invalidReferenceIssue !== undefined) {
    params.issues.push(invalidReferenceIssue);
    return undefined;
  }

  const invalidJobReferenceIssue = validateAllowedJobReferences(params);
  if (invalidJobReferenceIssue !== undefined) {
    params.issues.push(invalidJobReferenceIssue);
    return undefined;
  }

  if (unknownRoots.length > 0) {
    params.issues.push(
      issue({
        code: 'unknown-interpolation-context',
        message: `${fieldLabel(params.field)} interpolation references unknown context ${formatList(
          unknownRoots,
        )}.`,
        path: params.path,
        details: {
          field: params.field,
          source: params.source,
          expression: params.segment.expression.source,
          contextRoots,
          unknownRoots,
        },
      }),
    );
    return undefined;
  }

  const unavailableIssue = unavailableContextAtFillSite(params, contextRoots, knownRoots);
  if (unavailableIssue !== undefined) {
    params.issues.push(unavailableIssue);
    return undefined;
  }

  if (
    params.typeOverlay === undefined &&
    (knownRoots.length === 0 || knownRoots.some((root) => hasSyntaxOnlyCheckMode(root)))
  ) {
    return params.segment;
  }

  try {
    return {
      ...params.segment,
      expression: createWorkflowExpression({
        source: params.segment.expression.source,
        check: {
          mode: 'typed',
          // `undefined` preserves the legacy syntax-only path above. `{}` means
          // callers intentionally requested typed checking with the standard roots.
          typeEnvironment: mergeTypeEnvironments(params.field, knownRoots, params.typeOverlay),
        },
      }),
    };
  } catch (error) {
    params.issues.push(
      issue({
        code: 'invalid-interpolation-expression',
        message: `${fieldLabel(params.field)} interpolation expression did not type-check.`,
        path: params.path,
        details: {
          field: params.field,
          source: params.source,
          expression: params.segment.expression.source,
          contextRoots,
          reason:
            error instanceof InvalidWorkflowExpressionError
              ? error.reason
              : 'Expression source did not type-check.',
        },
      }),
    );
    return undefined;
  }
}

function validateAllowedJobReferences(
  params: Parameters<typeof validateExpressionSegment>[0],
): WorkflowModelValidationIssue | undefined {
  if (params.allowedJobReferences === undefined) return undefined;
  return validateDirectJobReferences({
    source: params.source,
    expression: params.segment.expression,
    field: params.field,
    path: params.path,
    allowedJobReferences: params.allowedJobReferences,
  });
}

function unavailableContextAtFillSite(
  params: Parameters<typeof validateExpressionSegment>[0],
  contextRoots: readonly string[],
  knownRoots: readonly (WorkflowContextName | WorkflowContextReservedRoot)[],
): WorkflowModelValidationIssue | undefined {
  if (params.fillSite === undefined) return undefined;
  const serverRoots = knownRoots.filter((root) => resolveContextRootHost(root) === 'server');
  const unavailableRoots = unavailableRootsAt(serverRoots, params.fillSite);
  if (unavailableRoots.length === 0) return undefined;
  return unavailableContextIssue({
    ...params,
    contextRoots,
    unavailableRoots,
    fillSite: params.fillSite,
  });
}

function runnerContextInFieldIssue(params: {
  field: WorkflowInterpolationField;
  source: string;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  contextRoots: readonly string[];
  rejectedHostRoots: readonly string[];
}): WorkflowModelValidationIssue {
  return issue({
    code: 'runner-context-in-field',
    message: `${fieldLabel(params.field)} interpolation cannot use runner context ${formatList(
      params.rejectedHostRoots,
    )}. Bind secrets to a run-step env value instead.`,
    path: params.path,
    details: {
      field: params.field,
      source: params.source,
      contextRoots: params.contextRoots,
      rejectedRoots: params.rejectedHostRoots,
    },
  });
}

function computedContextKeyIssue(params: {
  field: WorkflowInterpolationField;
  source: string;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  contextRoots: readonly string[];
  root: string;
  expression: string;
}): WorkflowModelValidationIssue {
  return issue({
    code: 'computed-context-key',
    message: `${fieldLabel(params.field)} interpolation must reference ${params.root} with a literal dot key.`,
    path: params.path,
    details: {
      field: params.field,
      source: params.source,
      expression: params.expression,
      contextRoots: params.contextRoots,
      root: params.root,
    },
  });
}

function validateContextKeyReferences(params: {
  field: WorkflowInterpolationField;
  source: string;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  contextRoots: readonly string[];
  segment: WorkflowTemplateExprSegment;
  references: ReturnType<typeof analyzeContextKeyAccess>['references'];
}): WorkflowModelValidationIssue | undefined {
  for (const reference of params.references) {
    if (!secretKeySchema.safeParse(reference.key).success) {
      return computedContextKeyIssue({
        ...params,
        root: reference.root,
        expression: params.segment.expression.source,
      });
    }

    if (reference.root !== 'secrets' || reference.store === undefined) continue;
    if (secretStoreSchema.safeParse(reference.store).success) continue;

    return issue({
      code: 'unknown-secret-store',
      message: `${fieldLabel(params.field)} interpolation references unknown secret store "${reference.store}".`,
      path: params.path,
      details: {
        field: params.field,
        source: params.source,
        expression: params.segment.expression.source,
        contextRoots: params.contextRoots,
        store: reference.store,
      },
    });
  }

  return undefined;
}

const availabilitySiteLabels = {
  ingest: 'ingest',
  'run-creation': 'run creation',
  'execution-creation': 'execution creation',
  'job-activation': 'job activation',
  'step-dispatch': 'step dispatch',
  'step-report': 'step reporting',
  'execution-resolution': 'execution resolution',
  'job-resolution': 'job resolution',
} as const satisfies Record<AvailabilitySite, string>;

function unavailableContextIssue(params: {
  field: WorkflowInterpolationField;
  source: string;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  segment: WorkflowTemplateExprSegment;
  contextRoots: readonly string[];
  unavailableRoots: readonly (WorkflowContextName | WorkflowContextReservedRoot)[];
  fillSite: AvailabilitySite;
}): WorkflowModelValidationIssue {
  return issue({
    code: 'context-unavailable-at-fill-site',
    message: `${fieldLabel(params.field)} interpolation references ${contextNoun(
      params.unavailableRoots,
    )} ${formatList(params.unavailableRoots)} that ${availabilityVerb(
      params.unavailableRoots,
    )} not available at ${describeAvailabilitySite(params.fillSite)}. ${params.unavailableRoots
      .map(unavailableRootAvailabilityMessage)
      .join(' ')}`,
    path: params.path,
    details: {
      field: params.field,
      source: params.source,
      expression: params.segment.expression.source,
      contextRoots: params.contextRoots,
      unavailableRoots: params.unavailableRoots,
      fillSite: params.fillSite,
    },
  });
}

function planViolationIssue(
  params: {
    field: WorkflowInterpolationField;
    source: string;
    path: readonly WorkflowModelValidationIssuePathSegment[];
  },
  violation: PlanViolation,
): WorkflowModelValidationIssue {
  if (violation.reason === 'computed-context-key') {
    return issue({
      code: 'computed-context-key',
      message: `${fieldLabel(params.field)} interpolation must reference ${formatList(
        violation.contextRoots ?? [],
      )} with a literal dot key.`,
      path: params.path,
      details: {
        field: params.field,
        source: params.source,
        expression: violation.source,
        contextRoots: violation.contextRoots,
      },
    });
  }

  return issue({
    code: 'runner-context-not-bare',
    message: `${fieldLabel(params.field)} interpolation references runner context in a larger expression; ${violation.hint}.`,
    path: params.path,
    details: {
      field: params.field,
      source: params.source,
      expression: violation.source,
      runnerRoots: violation.runnerRoots ?? [],
    },
  });
}

function contextNoun(roots: readonly string[]): 'context' | 'contexts' {
  return roots.length === 1 ? 'context' : 'contexts';
}

function availabilityVerb(roots: readonly string[]): 'is' | 'are' {
  return roots.length === 1 ? 'is' : 'are';
}

function unavailableRootAvailabilityMessage(root: string): string {
  const availability = resolveContextRootAvailability(root);
  if (availability === undefined) return `"${root}" is not available at any server site.`;
  return `"${root}" becomes available at ${describeAvailabilitySite(availability)}.`;
}

function describeAvailabilitySite(site: AvailabilitySite): string {
  return availabilitySiteLabels[site];
}

function hasSyntaxOnlyCheckMode(root: string): boolean {
  if (!isWorkflowContextName(root)) return resolveContextRootHost(root) === 'server';
  return getWorkflowContextTypeEnvironment(root) === undefined;
}

function mergeTypeEnvironments(
  field: WorkflowInterpolationField,
  roots: readonly (WorkflowContextName | WorkflowContextReservedRoot)[],
  typeOverlay?: ExpressionTypeEnvironment,
): ExpressionTypeEnvironment {
  const typeEnvironment: Record<string, ExpressionTypeEnvironment[string]> = {};

  for (const root of roots) {
    const overlayType = typeOverlay?.[root];
    if (overlayType !== undefined) {
      typeEnvironment[root] = overlayType;
      continue;
    }

    const contextTypeEnvironment = getWorkflowInterpolationFieldTypeEnvironment(field, root);
    if (contextTypeEnvironment === undefined) {
      if (typeOverlay !== undefined) typeEnvironment[root] = {kind: 'map'};
      continue;
    }

    Object.assign(typeEnvironment, contextTypeEnvironment);
  }

  return typeEnvironment;
}

function isExpressionSegment(
  segment: WorkflowTemplateSegment,
): segment is WorkflowTemplateExprSegment {
  return segment.kind === 'expr';
}

function isWorkflowContextName(root: string): root is WorkflowContextName {
  return (workflowContextNames as readonly string[]).includes(root);
}

function isWorkflowContextRoot(
  root: string,
): root is WorkflowContextName | WorkflowContextReservedRoot {
  return resolveContextRootHost(root) !== undefined;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function formatList(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join(', ');
}

function fieldLabel(field: WorkflowInterpolationField): string {
  return `Workflow ${field}`;
}
