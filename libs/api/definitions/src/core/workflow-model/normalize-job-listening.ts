import type {WorkflowDocumentJob} from '@shipfox/workflow-document';
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

  if (
    listening.until === undefined &&
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
    on: listening.on.map((trigger, index) =>
      normalizeListeningTrigger({
        trigger,
        field: 'listener.on',
        path: [...path, 'listening', 'on', index, 'filter'],
        issues: params.issues,
        allowedJobReferences: params.allowedJobReferences,
      }),
    ),
    ...(listening.until === undefined
      ? {}
      : {
          until: listening.until.map((trigger, index) =>
            normalizeListeningTrigger({
              trigger,
              field: 'listener.until',
              path: [...path, 'listening', 'until', index, 'filter'],
              issues: params.issues,
              allowedJobReferences: params.allowedJobReferences,
            }),
          ),
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
}): WorkflowModelJobListening['on'][number] {
  if (params.trigger.filter !== undefined) {
    validatePredicateExpression({
      field: params.field,
      source: params.trigger.filter,
      path: params.path,
      invalidCode: 'invalid-listener-filter',
      invalidMessage: `${params.field === 'listener.on' ? 'Listener on' : 'Listener until'} filter must be a valid CEL boolean expression.`,
      issues: params.issues,
      allowedJobReferences: params.allowedJobReferences,
    });
  }

  return normalizeTriggerEntry(params.trigger);
}
