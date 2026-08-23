import {
  type AvailabilitySite,
  createWorkflowExpression,
  type ExpressionType,
  type ExpressionTypeEnvironment,
  extractExactContextRoots,
  getWorkflowContextDefinition,
  getWorkflowPredicateContextRoots,
  getWorkflowPredicateFieldMinimumFillTarget,
  getWorkflowPredicateFieldTypeEnvironment,
  InvalidWorkflowExpressionError,
  predicateSourceIsBooleanShaped,
  resolveContextRootHost,
  validateServerEvaluable,
  type WorkflowContextName,
  type WorkflowExpression,
  type WorkflowPredicateField,
  workflowContextNames,
} from '@shipfox/expression';
import type {
  WorkflowModelValidationIssue,
  WorkflowModelValidationIssueCode,
  WorkflowModelValidationIssuePathSegment,
  WorkflowModelValidationIssueScope,
} from './invalid-workflow-model-error.js';
import {validateDirectJobReferences} from './validate-job-references.js';
import {issue} from './validation-issue.js';
import {workflowFieldLabel} from './workflow-field-label.js';

export function validatePredicateExpression(params: {
  field: WorkflowPredicateField;
  source: string;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  invalidCode: WorkflowModelValidationIssueCode;
  invalidMessage: string;
  issues: WorkflowModelValidationIssue[];
  allowedJobReferences?: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
  /** Scope for the invalidCode issue; other issues keep the definition scope. */
  scope?: WorkflowModelValidationIssueScope | undefined;
}): WorkflowExpression | undefined {
  const site = getWorkflowPredicateFieldMinimumFillTarget(params.field);
  const syntaxExpression = createSyntaxExpression(params);
  if (syntaxExpression === undefined) return undefined;

  const contextRoots = extractExactContextRoots(syntaxExpression.source);
  const knownRoots = contextRoots.filter((root) => resolveContextRootHost(root) !== undefined);
  const unknownRoots = contextRoots.filter((root) => resolveContextRootHost(root) === undefined);

  if (unknownRoots.length > 0) {
    params.issues.push(invalidPredicateIssue({...params, contextRoots}));
    return undefined;
  }

  const serverEvaluability = validateServerEvaluable(syntaxExpression);
  if (!serverEvaluability.ok) {
    params.issues.push(
      ...serverEvaluability.violations.map((violation) =>
        runnerContextInServerPredicateIssue({
          ...params,
          site,
          contextRoots,
          runnerRoots: violation.runnerRoots,
        }),
      ),
    );
    return undefined;
  }

  const predicateContextRoots = getWorkflowPredicateContextRoots(params.field);
  const unavailableRoots = knownRoots.filter(
    (root) => !predicateContextRoots.includes(root as (typeof predicateContextRoots)[number]),
  );
  if (unavailableRoots.length > 0) {
    params.issues.push(
      unavailablePredicateContextIssue({
        ...params,
        site,
        contextRoots,
        unavailableRoots,
      }),
    );
    return undefined;
  }

  const invalidJobReferenceIssue =
    params.allowedJobReferences === undefined
      ? undefined
      : validateDirectJobReferences({
          source: params.source,
          expression: syntaxExpression,
          field: params.field,
          path: params.path,
          allowedJobReferences: params.allowedJobReferences,
        });
  if (invalidJobReferenceIssue !== undefined) {
    params.issues.push(invalidJobReferenceIssue);
    return undefined;
  }

  if (
    params.typeOverlay === undefined &&
    knownRoots.length > 0 &&
    knownRoots.every((root) => hasSyntaxOnlyCheckMode(root))
  ) {
    if (
      isWorkflowFilterPredicateField(params.field) &&
      !predicateSourceIsBooleanShaped(syntaxExpression.source)
    ) {
      params.issues.push(
        invalidPredicateIssue({
          ...params,
          contextRoots,
          reason: 'Predicate source must be boolean-shaped.',
        }),
      );
      return undefined;
    }

    return syntaxExpression;
  }

  try {
    return createWorkflowExpression({
      source: params.source,
      check: {
        mode: 'typed',
        // `undefined` preserves the legacy syntax-only path above. `{}` means
        // callers intentionally requested typed checking with the standard roots.
        typeEnvironment: mergeTypeEnvironments(params.field, knownRoots, params.typeOverlay),
        expectedResultType: 'bool',
      },
    });
  } catch (error) {
    params.issues.push(
      invalidPredicateIssue({
        ...params,
        contextRoots,
        reason:
          error instanceof InvalidWorkflowExpressionError
            ? error.reason
            : 'Expression source did not parse or type-check.',
      }),
    );
    return undefined;
  }
}

function createSyntaxExpression(params: {
  field: WorkflowPredicateField;
  source: string;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  invalidCode: WorkflowModelValidationIssueCode;
  invalidMessage: string;
  issues: WorkflowModelValidationIssue[];
  scope?: WorkflowModelValidationIssueScope | undefined;
}): WorkflowExpression | undefined {
  try {
    return createWorkflowExpression({
      source: params.source,
      check: {mode: 'syntax'},
    });
  } catch (error) {
    params.issues.push(
      invalidPredicateIssue({
        ...params,
        contextRoots: [],
        reason:
          error instanceof InvalidWorkflowExpressionError
            ? error.reason
            : 'Expression source did not parse or type-check.',
      }),
    );
    return undefined;
  }
}

function invalidPredicateIssue(params: {
  field: WorkflowPredicateField;
  source: string;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  invalidCode: WorkflowModelValidationIssueCode;
  invalidMessage: string;
  contextRoots: readonly string[];
  reason?: string;
  scope?: WorkflowModelValidationIssueScope | undefined;
}): WorkflowModelValidationIssue {
  return issue({
    code: params.invalidCode,
    message: params.invalidMessage,
    path: params.path,
    details: {
      field: params.field,
      source: params.source,
      contextRoots: params.contextRoots,
      reason: params.reason ?? 'Expression source did not parse or type-check.',
    },
    ...(params.scope === undefined ? {} : {scope: params.scope}),
  });
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

function runnerContextInServerPredicateIssue(params: {
  field: WorkflowPredicateField;
  source: string;
  site: AvailabilitySite;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  contextRoots: readonly string[];
  runnerRoots: readonly string[];
}): WorkflowModelValidationIssue {
  return issue({
    code: 'runner-context-in-server-predicate',
    message: `${fieldLabel(params.field)} cannot reference runner context ${formatList(
      params.runnerRoots,
    )} because it is evaluated on the server at ${describeAvailabilitySite(params.site)}.`,
    path: params.path,
    details: {
      field: params.field,
      source: params.source,
      contextRoots: params.contextRoots,
      runnerRoots: params.runnerRoots,
      site: params.site,
    },
  });
}

function unavailablePredicateContextIssue(params: {
  field: WorkflowPredicateField;
  source: string;
  site: AvailabilitySite;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  contextRoots: readonly string[];
  unavailableRoots: readonly string[];
}): WorkflowModelValidationIssue {
  return issue({
    code: 'context-unavailable-at-predicate-site',
    message: `${fieldLabel(params.field)} references ${contextNoun(
      params.unavailableRoots,
    )} ${formatList(params.unavailableRoots)} that ${availabilityVerb(
      params.unavailableRoots,
    )} not supplied when ${fieldLabel(params.field)} is evaluated at ${describeAvailabilitySite(
      params.site,
    )}.`,
    path: params.path,
    details: {
      field: params.field,
      source: params.source,
      contextRoots: params.contextRoots,
      unavailableRoots: params.unavailableRoots,
      site: params.site,
    },
  });
}

function hasSyntaxOnlyCheckMode(root: string): boolean {
  if (!isWorkflowContextName(root)) return resolveContextRootHost(root) === 'server';
  return isWorkflowContextName(root) && getWorkflowContextDefinition(root).checkMode === 'syntax';
}

function mergeTypeEnvironments(
  field: WorkflowPredicateField,
  roots: readonly string[],
  typeOverlay?: ExpressionTypeEnvironment,
): ExpressionTypeEnvironment {
  const typeEnvironment: Record<string, ExpressionTypeEnvironment[string]> = {};

  for (const root of roots) {
    const overlayType = typeOverlay?.[root];
    if (!isWorkflowContextName(root)) {
      if (overlayType !== undefined) typeEnvironment[root] = overlayType;
      else typeEnvironment[root] = {kind: 'map'};
      continue;
    }

    const contextTypeEnvironment = getWorkflowPredicateFieldTypeEnvironment(field, root);
    if (contextTypeEnvironment === undefined) {
      if (overlayType !== undefined) typeEnvironment[root] = overlayType;
      else typeEnvironment[root] = {kind: 'map'};
      continue;
    }

    const contextType = contextTypeEnvironment[root];
    if (contextType === undefined) continue;
    typeEnvironment[root] =
      overlayType === undefined ? contextType : overlayKnownFields(contextType, overlayType);
  }

  return typeEnvironment;
}

function overlayKnownFields(base: ExpressionType, overlay: ExpressionType): ExpressionType {
  if (typeof base === 'string' || typeof overlay === 'string') return overlay;
  if (base.kind !== 'object' || overlay.kind !== 'object') return overlay;

  // Preserve output specialization without reintroducing properties absent from this field's
  // runtime shape.
  return {
    kind: 'object',
    fields: Object.fromEntries(
      Object.entries(base.fields).map(([key, fieldType]) => [
        key,
        overlay.fields[key] ?? fieldType,
      ]),
    ),
  };
}

function isWorkflowContextName(root: string): root is WorkflowContextName {
  return (workflowContextNames as readonly string[]).includes(root);
}

function isWorkflowFilterPredicateField(field: WorkflowPredicateField): boolean {
  return field === 'trigger.filter' || field === 'listener.on' || field === 'listener.until';
}

function fieldLabel(field: WorkflowPredicateField): string {
  return workflowFieldLabel(field);
}

function contextNoun(roots: readonly string[]): 'context' | 'contexts' {
  return roots.length === 1 ? 'context' : 'contexts';
}

function availabilityVerb(roots: readonly string[]): 'is' | 'are' {
  return roots.length === 1 ? 'is' : 'are';
}

function describeAvailabilitySite(site: AvailabilitySite): string {
  return availabilitySiteLabels[site];
}

function formatList(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join(', ');
}
