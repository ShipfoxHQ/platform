import {triggerSourceConfigSchemas, type WorkflowDocument} from '@shipfox/workflow-document';
import type {
  WorkflowModelListeningTrigger,
  WorkflowModelTrigger,
} from '../entities/workflow-model.js';
import {cronTriggerDefaultTimezone, validateCronTrigger} from './cron-trigger.js';
import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {stableId} from './stable-id.js';
import {validatePredicateExpression} from './validate-predicate-expression.js';
import {issue} from './validation-issue.js';

const manualTriggerSource = 'manual';
const cronTriggerSource = 'cron';
type WorkflowDocumentTrigger = NonNullable<WorkflowDocument['triggers']>[string];

export function normalizeTriggers(
  document: WorkflowDocument,
  issues: WorkflowModelValidationIssue[],
): readonly WorkflowModelTrigger[] {
  const triggers = document.triggers ?? {};
  const manualTriggerKeys = Object.entries(triggers)
    .filter(([, trigger]) => trigger.source === manualTriggerSource)
    .map(([sourceKey]) => sourceKey);
  const usedTriggerIds = new Map<string, string>();
  let activeManualTriggerSeen = false;

  return Object.entries(triggers).flatMap(([sourceKey, trigger]) => {
    const id = stableId(sourceKey);
    const existingSourceKey = usedTriggerIds.get(id);
    if (existingSourceKey !== undefined) {
      issues.push(
        issue({
          code: 'duplicate-trigger-id',
          message: `Trigger keys "${existingSourceKey}" and "${sourceKey}" resolve to the same stable id "${id}".`,
          path: ['triggers', sourceKey],
          details: {id, sourceKeys: [existingSourceKey, sourceKey]},
          scope: 'trigger',
        }),
      );
      return [];
    }
    usedTriggerIds.set(id, sourceKey);

    if (trigger.source === manualTriggerSource) {
      if (activeManualTriggerSeen) {
        issues.push(
          issue({
            code: 'multiple-manual-triggers',
            message: `A workflow may declare at most one manual trigger; found ${manualTriggerKeys.length}: ${manualTriggerKeys.join(', ')}. This trigger is inert because it is not the first manual trigger in document order.`,
            path: ['triggers', sourceKey],
            details: {manualTriggerKeys},
            scope: 'trigger',
          }),
        );
        return [];
      }
      activeManualTriggerSeen = true;
    }

    const triggerIssues: WorkflowModelValidationIssue[] = [];
    validateTriggerFilter({sourceKey, trigger, issues: triggerIssues});
    issues.push(...triggerIssues);

    const normalizedTrigger = normalizeTriggerEntry(trigger);
    const triggerIsInert = triggerIssues.some((candidate) => candidate.scope === 'trigger');
    if (trigger.source !== cronTriggerSource) {
      if (triggerIsInert) return [];
      return [
        {
          id,
          key: sourceKey,
          ...normalizedTrigger,
          ...(trigger.config === undefined ? {} : {config: trigger.config}),
        },
      ];
    }

    const cronConfig = triggerSourceConfigSchemas.cron.parse(trigger.config ?? {});
    const normalizedCronConfig = {
      ...cronConfig,
      timezone: cronConfig.timezone ?? cronTriggerDefaultTimezone,
    };

    const cronIssues: WorkflowModelValidationIssue[] = [];
    validateCronTrigger({trigger, config: cronConfig, sourceKey, issues: cronIssues});
    issues.push(...cronIssues);

    const cronIsInert = cronIssues.some((candidate) => candidate.scope === 'trigger');
    if (triggerIsInert || cronIsInert) return [];

    return [
      {
        id,
        key: sourceKey,
        ...normalizedTrigger,
        config: normalizedCronConfig,
      },
    ];
  });
}

function validateTriggerFilter(params: {
  sourceKey: string;
  trigger: WorkflowDocumentTrigger;
  issues: WorkflowModelValidationIssue[];
}): void {
  const {sourceKey, trigger, issues} = params;
  if (trigger.filter === undefined) return;

  const path = ['triggers', sourceKey, 'filter'] as const;
  if (trigger.source === manualTriggerSource || trigger.source === cronTriggerSource) {
    issues.push(
      issue({
        code: 'invalid-trigger-filter',
        message: `A ${trigger.source} trigger cannot define a filter because it does not receive an event payload.`,
        path,
        details: {source: trigger.filter, triggerSource: trigger.source},
        scope: 'trigger',
      }),
    );
    return;
  }

  validatePredicateExpression({
    field: 'trigger.filter',
    source: trigger.filter,
    path,
    invalidCode: 'invalid-trigger-filter',
    invalidMessage: 'Trigger filter must be a valid boolean predicate.',
    issues,
    scope: 'trigger',
  });
}

export function normalizeTriggerEntry(trigger: {
  readonly source: string;
  readonly event?: string | undefined;
  readonly with?: Readonly<Record<string, unknown>> | undefined;
  readonly filter?: string | undefined;
}): WorkflowModelListeningTrigger {
  // `manual` and `cron` have no delivered event to resolve against at fire
  // time, so materialize their built-in name when the author omitted it.
  // Integration sources keep the event absent, which becomes a source
  // subscription (NULL row) on the write path.
  const event = builtinEventForSource(trigger.source, trigger.event);
  return {
    source: trigger.source,
    ...(event === undefined ? {} : {event}),
    ...(trigger.with === undefined ? {} : {inputs: trigger.with}),
    ...(trigger.filter === undefined ? {} : {filter: trigger.filter}),
  };
}

function builtinEventForSource(source: string, event: string | undefined): string | undefined {
  if (source === manualTriggerSource) return event ?? 'fire';
  if (source === cronTriggerSource) return event ?? 'tick';
  return event;
}
