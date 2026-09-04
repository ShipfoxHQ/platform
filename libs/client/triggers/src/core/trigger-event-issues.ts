import type {
  TriggerEventDecisionDiagnostic,
  TriggerEventDetail,
  TriggerEventMatchedWorkflowResult,
  TriggerEventProcessingDiagnostic,
} from './trigger-event.js';

export type TriggerEventIssueDescriptionPart =
  | {kind: 'text'; value: string}
  | {kind: 'code'; value: string}
  | {kind: 'bytes'; value: number};

export interface TriggerEventIssue {
  id: string;
  title: string;
  targetName?: string;
  description: TriggerEventIssueDescriptionPart[];
  affectedCount: number;
}

export interface TriggerEventIssueCallout {
  type: 'error' | 'warning';
  title: string;
  successSummary: string | null;
  issues: TriggerEventIssue[];
  hiddenIssueCount: number;
}

interface MappableTriggerEventIssue extends TriggerEventIssue {
  groupKey?: string;
  groupedDescription?: TriggerEventIssueDescriptionPart[];
}

const MAX_VISIBLE_ISSUES = 3;
const LEGACY_WORKFLOW_ERROR = /^workflows\.[^:]+: ([a-z][a-z0-9-]+)$/;

export function getTriggerEventIssueCallout(
  event: TriggerEventDetail,
): TriggerEventIssueCallout | null {
  const decisionIssues = event.decisions.flatMap((decision) => {
    if (
      decision.decision !== 'filter-error' &&
      decision.decision !== 'dispatch-error' &&
      decision.decision !== 'rejected'
    )
      return [];
    return [decisionIssue(decision)];
  });
  const issues = collapseIssues(resolveIssues(event, decisionIssues));

  if (issues.length === 0) return null;

  const successfulDecisions = event.decisions.filter(
    (decision) => decision.decision === 'triggered',
  );
  return {
    type: successfulDecisions.length > 0 ? 'warning' : 'error',
    title: calloutTitle(issues, successfulDecisions.length, decisionIssues.length),
    successSummary: successfulDecisionSummary(successfulDecisions),
    issues: issues.slice(0, MAX_VISIBLE_ISSUES),
    hiddenIssueCount: Math.max(0, issues.length - MAX_VISIBLE_ISSUES),
  };
}

function resolveIssues(
  event: TriggerEventDetail,
  decisionIssues: MappableTriggerEventIssue[],
): MappableTriggerEventIssue[] {
  if (decisionIssues.length > 0) return decisionIssues;
  if (event.processingDiagnostic != null) return [processingIssue(event.processingDiagnostic)];
  if (event.outcome === 'failed' || event.outcome === 'errored') return [eventFallbackIssue()];
  return [];
}

function calloutTitle(
  issues: TriggerEventIssue[],
  successfulDecisionCount: number,
  failedDecisionCount: number,
): string {
  if (successfulDecisionCount > 0) return 'Some workflow processing failed';
  if (failedDecisionCount > 1)
    return `${formatCount(failedDecisionCount)} workflow decisions failed`;
  if (issues.length === 1) return issues[0]?.title ?? 'Event processing failed';
  return 'Workflow decisions failed';
}

function successfulDecisionSummary(decisions: TriggerEventMatchedWorkflowResult[]): string | null {
  if (decisions.length === 0) return null;
  const workflowCount = decisions.filter(
    (decision) => decision.subscriptionKind !== 'listener',
  ).length;
  const listenerCount = decisions.length - workflowCount;
  const parts = [
    workflowCount === 0
      ? null
      : `${workflowCount} ${workflowCount === 1 ? 'workflow' : 'workflows'} started`,
    listenerCount === 0
      ? null
      : `${listenerCount} listener ${listenerCount === 1 ? 'action' : 'actions'} succeeded`,
  ].filter((part): part is string => part !== null);
  return `${parts.join(' and ')}.`;
}

function formatCount(count: number): string {
  if (count === 2) return 'Two';
  if (count === 3) return 'Three';
  return String(count);
}

function decisionIssue(decision: TriggerEventMatchedWorkflowResult): MappableTriggerEventIssue {
  const diagnostic = decision.diagnostic ?? legacyDiagnostic(decision.reason);
  if (diagnostic === null) return workflowFallbackIssue(decision);
  return diagnosticIssue(decision, diagnostic);
}

function diagnosticIssue(
  decision: TriggerEventMatchedWorkflowResult,
  diagnostic: TriggerEventDecisionDiagnostic,
): MappableTriggerEventIssue {
  const filterTarget = filterTargetCopy(decision);
  const filterName = filterNameCopy(decision);
  const targetName = decision.subscriptionName;

  switch (diagnostic.code) {
    case 'filter-config-invalid':
      return issue(decision, `${filterTarget} is invalid`, [
        text(`The ${filterName} is empty or has an unsupported stored value.`),
      ]);
    case 'expression-syntax-invalid':
      return issue(decision, `${filterTarget} has invalid syntax`, [
        text(
          diagnostic.offset === undefined
            ? `Shipfox could not parse the ${filterName}.`
            : `Shipfox could not parse the ${filterName} near character ${diagnostic.offset}.`,
        ),
      ]);
    case 'expression-missing-path':
      return issue(
        decision,
        `${filterTarget} could not be evaluated`,
        [
          code(diagnostic.path),
          text(` is not available in the ${filterName}. ${filterFailureConsequence(decision)}`),
        ],
        {
          groupKey:
            decision.subscriptionKind === 'listener'
              ? `${filterTarget}:${decision.id}:${diagnostic.code}:${diagnostic.path}`
              : `${filterTarget}:${diagnostic.code}:${diagnostic.path}`,
          groupedDescription: [
            code(diagnostic.path),
            text(
              ` is not available in the affected ${filterTarget.toLowerCase()}s. ${groupedFilterFailureConsequence(decision)}`,
            ),
          ],
        },
      );
    case 'expression-index-out-of-bounds':
      return issue(decision, `${filterTarget} could not be evaluated`, [
        text(
          `The ${filterName} tried to read item ${diagnostic.index}, but that item does not exist.`,
        ),
      ]);
    case 'expression-evaluation-failed':
      return issue(decision, `${filterTarget} could not be evaluated`, [
        text(`The ${filterName} failed during evaluation. No workflow run was created.`),
      ]);
    case 'expression-result-not-boolean':
      return issue(decision, `${filterTarget} returned an invalid result`, [
        text(`The ${filterName} returned ${diagnostic.actualType} instead of true or false.`),
      ]);
    case 'listener-snapshot-invalid':
      return issue(decision, 'Listener context could not be restored', [
        text(`Shipfox could not restore the saved context for ${targetName}.`),
      ]);
    case 'listener-output-types-invalid':
      return issue(decision, 'Listener context could not be restored', [
        text(`Shipfox could not restore output types for ${targetName}.`),
      ]);
    case 'admission-denied':
      return issue(
        decision,
        decision.subscriptionKind === 'listener'
          ? 'Listener delivery was blocked'
          : 'Workflow start was blocked',
        [text(`Workspace policy did not allow Shipfox to process ${targetName}.`)],
      );
    case 'workspace-not-found':
      return issue(decision, 'Workspace was unavailable', [
        text('Shipfox could not find the workspace when it processed this event.'),
      ]);
    case 'workspace-suspended':
      return issue(decision, 'Workflow start was blocked', [
        text('The workspace was suspended when Shipfox processed this event.'),
      ]);
    case 'workspace-deleted':
      return issue(decision, 'Workflow start was blocked', [
        text('The workspace was deleted when Shipfox processed this event.'),
      ]);
    case 'definition-not-found':
      return issue(decision, 'Workflow definition is unavailable', [
        text(`The saved definition for ${targetName} no longer exists.`),
      ]);
    case 'project-mismatch':
      return issue(decision, 'Workflow configuration is inconsistent', [
        text(`The ${targetName} trigger points to a definition in another project.`),
      ]);
    case 'agent-config-unresolvable':
      return issue(decision, 'Agent configuration could not be resolved', [
        text(`Shipfox could not resolve the agent configuration for ${targetName}.`),
      ]);
    case 'agent-integration-materialization-failed':
      return issue(decision, 'Agent integrations could not be prepared', [
        text(`Shipfox could not prepare the agent integrations for ${targetName}.`),
      ]);
    case 'interpolation-unresolvable':
      return issue(decision, 'Workflow value could not be resolved', [
        code(diagnostic.envKey ?? diagnostic.field),
        text(` could not be resolved in ${diagnostic.field} for ${targetName}.`),
      ]);
    case 'invalid-job-runner-labels': {
      const visibleLabels = diagnostic.labels.slice(0, 3);
      const remaining = diagnostic.labels.length - visibleLabels.length;
      return issue(decision, 'Runner labels are invalid', [
        text(
          `${targetName} requests unsupported runner labels: ${visibleLabels.join(', ')}${
            remaining > 0 ? `, and ${remaining} more` : ''
          }.`,
        ),
      ]);
    }
    case 'source-snapshot-too-large':
      return issue(decision, 'Workflow source is too large', [
        text('The workflow source is '),
        bytes(diagnostic.measuredBytes),
        text('. The limit is '),
        bytes(diagnostic.limitBytes),
        text('.'),
      ]);
    case 'diagnostic-too-large':
      return issue(decision, 'Workflow diagnostics are too large', [
        ...(diagnostic.field === undefined ? [] : [code(diagnostic.field)]),
        text(`${diagnostic.field === undefined ? 'The diagnostic' : ''} is `),
        bytes(diagnostic.measuredBytes),
        text('. The limit is '),
        bytes(diagnostic.limitBytes),
        text('.'),
      ]);
    case 'workflow-execution-payload-too-large':
      return issue(decision, 'Workflow configuration is too large', [
        code(diagnostic.field),
        text(' exceeds its size limit by '),
        bytes(diagnostic.overshootBytes),
        text('.'),
      ]);
    case 'listener-event-payload-too-large':
      return issue(decision, 'Event payload is too large', [
        text(`The event sent to ${targetName} is `),
        bytes(diagnostic.measuredBytes),
        text('. The listener limit is '),
        bytes(diagnostic.limitBytes),
        text('.'),
      ]);
    case 'unexpected-listener-delivery-failure':
      return issue(decision, 'Listener delivery could not complete', [
        text(`Shipfox encountered an unexpected error while processing ${targetName}.`),
      ]);
    case 'unexpected-workflow-start-failure':
      return workflowFallbackIssue(decision);
  }
}

function processingIssue(diagnostic: TriggerEventProcessingDiagnostic): MappableTriggerEventIssue {
  const copy = {
    'subscription-load-failed': [
      'Event routing could not complete',
      'Shipfox could not load the workflows and listeners for this event.',
    ],
    'trigger-reference-resolution-failed': [
      'Event context could not be prepared',
      'Shipfox could not prepare workflow context for this event.',
    ],
    'listener-routing-failed': [
      'Listener routing could not complete',
      'Shipfox could not finish routing this event to listeners.',
    ],
    'event-processing-failed': [
      'Event processing could not complete',
      'Shipfox encountered an unexpected error while processing this event.',
    ],
  } as const;
  const [title, description] = copy[diagnostic.code];
  return {
    id: `event:${diagnostic.code}`,
    title,
    description: [text(description)],
    affectedCount: 1,
  };
}

function workflowFallbackIssue(
  decision: TriggerEventMatchedWorkflowResult,
): MappableTriggerEventIssue {
  return issue(decision, 'Workflow processing failed', [
    text(
      'Shipfox could not complete this workflow decision. More details are unavailable for this event.',
    ),
  ]);
}

function eventFallbackIssue(): MappableTriggerEventIssue {
  return {
    id: 'event:fallback',
    title: 'Event processing failed',
    description: [
      text(
        'Shipfox could not complete event processing. More details are unavailable for this event.',
      ),
    ],
    affectedCount: 1,
  };
}

function legacyDiagnostic(reason: string | null): TriggerEventDecisionDiagnostic | null {
  switch (reason) {
    case 'Trigger filter evaluation failed':
    case 'Listener filter evaluation failed':
      return {version: 1, code: 'expression-evaluation-failed'};
    case 'Trigger subscription filter must be a non-empty string when set':
    case 'Listener subscription filter must be a non-empty string when set':
      return {version: 1, code: 'filter-config-invalid'};
    case 'Listener filter snapshot must be an object when set':
      return {version: 1, code: 'listener-snapshot-invalid'};
    case 'Listener filter output types must be valid when set':
      return {version: 1, code: 'listener-output-types-invalid'};
  }

  const code = LEGACY_WORKFLOW_ERROR.exec(reason ?? '')?.[1];
  switch (code) {
    case 'workspace-not-found':
    case 'workspace-suspended':
    case 'workspace-deleted':
    case 'definition-not-found':
    case 'project-mismatch':
    case 'agent-config-unresolvable':
    case 'agent-integration-materialization-failed':
      return {version: 1, code};
    default:
      return null;
  }
}

function filterTargetCopy(decision: TriggerEventMatchedWorkflowResult): string {
  if (decision.subscriptionKind !== 'listener') return 'Trigger filter';
  return decision.matcherKind === 'until' ? 'Listener stop condition' : 'Listener start condition';
}

function filterNameCopy(decision: TriggerEventMatchedWorkflowResult): string {
  if (decision.subscriptionKind !== 'listener') return `${decision.subscriptionName} filter`;
  return decision.matcherKind === 'until'
    ? `${decision.subscriptionName} stop condition`
    : `${decision.subscriptionName} start condition`;
}

function filterFailureConsequence(decision: TriggerEventMatchedWorkflowResult): string {
  return decision.subscriptionKind === 'listener'
    ? 'The listener action did not complete.'
    : 'No workflow run was created.';
}

function groupedFilterFailureConsequence(decision: TriggerEventMatchedWorkflowResult): string {
  return decision.subscriptionKind === 'listener'
    ? 'The affected listener actions did not complete.'
    : 'No workflow runs were created for the affected decisions.';
}

function issue(
  decision: TriggerEventMatchedWorkflowResult,
  title: string,
  description: TriggerEventIssueDescriptionPart[],
  grouping?: Pick<MappableTriggerEventIssue, 'groupKey' | 'groupedDescription'>,
): MappableTriggerEventIssue {
  return {
    id: decision.id,
    title,
    targetName: decision.subscriptionName,
    description,
    affectedCount: 1,
    ...grouping,
  };
}

function collapseIssues(issues: MappableTriggerEventIssue[]): MappableTriggerEventIssue[] {
  const collapsed: MappableTriggerEventIssue[] = [];
  const groupedIndexes = new Map<string, number>();

  for (const issue of issues) {
    if (issue.groupKey === undefined) {
      collapsed.push(issue);
      continue;
    }

    const existingIndex = groupedIndexes.get(issue.groupKey);
    if (existingIndex === undefined) {
      groupedIndexes.set(issue.groupKey, collapsed.length);
      collapsed.push(issue);
      continue;
    }

    const existing = collapsed[existingIndex];
    if (existing === undefined) continue;
    collapsed[existingIndex] = {
      id: existing.id,
      title: existing.title,
      description: existing.groupedDescription ?? existing.description,
      affectedCount: existing.affectedCount + issue.affectedCount,
      groupKey: issue.groupKey,
      ...(existing.groupedDescription === undefined
        ? {}
        : {groupedDescription: existing.groupedDescription}),
    };
  }

  return collapsed;
}

function text(value: string): TriggerEventIssueDescriptionPart {
  return {kind: 'text', value};
}

function code(value: string): TriggerEventIssueDescriptionPart {
  return {kind: 'code', value};
}

function bytes(value: number): TriggerEventIssueDescriptionPart {
  return {kind: 'bytes', value};
}
