import type {WorkflowDocumentJob} from '@shipfox/workflow-document';
import type {IntegrationValidationContext} from '../entities/integration-context.js';
import type {WorkflowModelJobListening} from '../entities/workflow-model.js';
import {DEFAULT_RUN_TIMEOUT_MS} from './constants.js';
import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {normalizeTriggerEntry} from './normalize-triggers.js';
import {parseDurationMs} from './parse-duration-ms.js';
import {validatePredicateExpression} from './validate-predicate-expression.js';
import {issue} from './validation-issue.js';

export function normalizeJobListening(params: {
  job: WorkflowDocumentJob;
  sourceName: string;
  issues: WorkflowModelValidationIssue[];
  allowedJobReferences: ReadonlySet<string>;
  integrationValidationContext?: IntegrationValidationContext | undefined;
}): WorkflowModelJobListening | undefined {
  const path = ['jobs', params.sourceName] as const;
  const listening = params.job.listening;

  if (listening === undefined) {
    return undefined;
  }

  const timeoutMs = parseDurationMs({
    source: listening.timeout,
    path: [...path, 'listening', 'timeout'],
    issues: params.issues,
    maxMs: DEFAULT_RUN_TIMEOUT_MS,
    outOfRangeCode: 'listening-timeout-exceeds-run-timeout',
    outOfRangeMessage: 'Listening job timeout must be between 1s and the workflow run timeout.',
  });
  const debounceMs = parseDurationMs({
    source: listening.batch?.debounce,
    path: [...path, 'listening', 'batch', 'debounce'],
    issues: params.issues,
  });
  const maxWaitMs = parseDurationMs({
    source: listening.batch?.max_wait,
    path: [...path, 'listening', 'batch', 'max_wait'],
    issues: params.issues,
  });

  const on = listening.on
    .map((trigger, index) =>
      normalizeListeningTrigger({
        trigger,
        field: 'listener.on',
        path: [...path, 'listening', 'on', index],
        issues: params.issues,
        allowedJobReferences: params.allowedJobReferences,
        integrationValidationContext: params.integrationValidationContext,
      }),
    )
    .filter((matcher): matcher is WorkflowModelJobListening['on'][number] => matcher !== undefined);

  if (on.length === 0) {
    params.issues.push(
      issue({
        code: 'listening-job-no-active-matcher',
        message: `Listening job "${params.sourceName}" has no active "on" matcher; it can never execute.`,
        path: [...path, 'listening', 'on'],
      }),
    );
  }

  const until =
    listening.until === undefined
      ? undefined
      : listening.until
          .map((trigger, index) =>
            normalizeListeningTrigger({
              trigger,
              field: 'listener.until',
              path: [...path, 'listening', 'until', index],
              issues: params.issues,
              allowedJobReferences: params.allowedJobReferences,
              integrationValidationContext: params.integrationValidationContext,
            }),
          )
          .filter(
            (matcher): matcher is WorkflowModelJobListening['on'][number] => matcher !== undefined,
          );

  // Inert `until` matchers do not resolve the listening job; the check runs on
  // the matchers that stay active.
  if (
    (until === undefined || until.length === 0) &&
    listening.timeout === undefined &&
    listening.max_executions === undefined
  ) {
    params.issues.push(
      issue({
        code: 'listening-job-missing-resolution-source',
        message: `Listening job "${params.sourceName}" must declare until, timeout, or max_executions.`,
        path: [...path, 'listening'],
      }),
    );
  }

  const batch =
    debounceMs === undefined && listening.batch?.max_size === undefined && maxWaitMs === undefined
      ? undefined
      : {
          ...(debounceMs === undefined ? {} : {debounceMs}),
          ...(listening.batch?.max_size === undefined ? {} : {maxSize: listening.batch.max_size}),
          ...(maxWaitMs === undefined ? {} : {maxWaitMs}),
        };

  return {
    on,
    ...(until === undefined || until.length === 0
      ? {}
      : {
          until,
        }),
    ...(timeoutMs === undefined ? {} : {timeoutMs}),
    ...(listening.max_executions === undefined ? {} : {maxExecutions: listening.max_executions}),
    ...(batch === undefined ? {} : {batch}),
    onResolve: listening.on_resolve ?? 'finish',
  };
}

function normalizeListeningTrigger(params: {
  trigger: {
    readonly source: string;
    readonly event?: string | undefined;
    readonly with?: Readonly<Record<string, unknown>> | undefined;
    readonly filter?: string | undefined;
  };
  field: 'listener.on' | 'listener.until';
  path: readonly (string | number)[];
  issues: WorkflowModelValidationIssue[];
  allowedJobReferences: ReadonlySet<string>;
  integrationValidationContext?: IntegrationValidationContext | undefined;
}): WorkflowModelJobListening['on'][number] | undefined {
  const matcherIssues: WorkflowModelValidationIssue[] = [];
  if (params.trigger.filter !== undefined) {
    validatePredicateExpression({
      field: params.field,
      source: params.trigger.filter,
      path: [...params.path, 'filter'],
      invalidCode: 'invalid-listener-filter',
      invalidMessage: `${params.field === 'listener.on' ? 'Listener on' : 'Listener until'} filter must be a valid CEL boolean expression.`,
      issues: matcherIssues,
      allowedJobReferences: params.allowedJobReferences,
      scope: 'trigger',
    });
  }

  const normalizedMatcher = normalizeTriggerEntry(params.trigger, {
    path: params.path,
    issues: matcherIssues,
    integrationValidationContext: params.integrationValidationContext,
  });
  params.issues.push(...matcherIssues);

  // A matcher with a trigger-scoped error is inert: excluded from the matcher
  // list while the authored document entry stays untouched. Trigger-scoped
  // warnings (unknown source or event) keep the matcher active.
  if (
    matcherIssues.some(
      (candidate) => candidate.scope === 'trigger' && candidate.severity === 'error',
    )
  ) {
    return undefined;
  }

  return normalizedMatcher;
}
