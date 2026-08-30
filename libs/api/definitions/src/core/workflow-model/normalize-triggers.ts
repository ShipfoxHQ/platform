import {triggerSourceConfigSchemas, type WorkflowDocument} from '@shipfox/workflow-document';
import type {IntegrationValidationContext} from '../entities/integration-context.js';
import type {
  WorkflowModelListeningTrigger,
  WorkflowModelTrigger,
} from '../entities/workflow-model.js';
import {cronTriggerDefaultTimezone, validateCronTrigger} from './cron-trigger.js';
import type {
  WorkflowModelValidationIssue,
  WorkflowModelValidationIssuePathSegment,
} from './invalid-workflow-model-error.js';
import {stableId} from './stable-id.js';
import {validatePredicateExpression} from './validate-predicate-expression.js';
import {issue} from './validation-issue.js';

const manualTriggerSource = 'manual';
const cronTriggerSource = 'cron';
type WorkflowDocumentTrigger = NonNullable<WorkflowDocument['triggers']>[string];

interface NormalizeTriggersState {
  manualTriggerSeen: boolean;
  usedTriggerIds: Map<string, string>;
}

export function normalizeTriggers(
  document: WorkflowDocument,
  issues: WorkflowModelValidationIssue[],
  integrationValidationContext?: IntegrationValidationContext | undefined,
): readonly WorkflowModelTrigger[] {
  const triggers = document.triggers ?? {};
  const manualTriggerKeys = Object.entries(triggers)
    .filter(([, trigger]) => trigger.source === manualTriggerSource)
    .map(([sourceKey]) => sourceKey);
  const state: NormalizeTriggersState = {manualTriggerSeen: false, usedTriggerIds: new Map()};
  return Object.entries(triggers).flatMap(([sourceKey, trigger]) =>
    normalizeTopLevelTrigger({
      sourceKey,
      trigger,
      issues,
      manualTriggerKeys,
      integrationValidationContext,
      state,
    }),
  );
}

function normalizeTopLevelTrigger(params: {
  sourceKey: string;
  trigger: WorkflowDocumentTrigger;
  issues: WorkflowModelValidationIssue[];
  manualTriggerKeys: string[];
  integrationValidationContext: IntegrationValidationContext | undefined;
  state: NormalizeTriggersState;
}): WorkflowModelTrigger[] {
  const id = stableId(params.sourceKey);
  const existingSourceKey = params.state.usedTriggerIds.get(id);
  if (existingSourceKey !== undefined) {
    params.issues.push(
      issue({
        code: 'duplicate-trigger-id',
        message: `Trigger keys "${existingSourceKey}" and "${params.sourceKey}" resolve to the same stable id "${id}".`,
        path: ['triggers', params.sourceKey],
        details: {id, sourceKeys: [existingSourceKey, params.sourceKey]},
        scope: 'trigger',
      }),
    );
    return [];
  }
  params.state.usedTriggerIds.set(id, params.sourceKey);
  const triggerIssues = validateTopLevelTrigger(params);
  const normalizedTrigger = normalizeTriggerEntry(params.trigger, {
    path: ['triggers', params.sourceKey],
    issues: triggerIssues,
    integrationValidationContext: params.integrationValidationContext,
  });
  params.issues.push(...triggerIssues);
  const triggerIsInert = triggerIssues.some(
    (candidate) => candidate.scope === 'trigger' && candidate.severity === 'error',
  );
  if (params.trigger.source === cronTriggerSource) {
    return normalizeCronTrigger(
      params.sourceKey,
      id,
      params.trigger,
      normalizedTrigger,
      triggerIsInert,
      params.issues,
    );
  }
  if (params.trigger.source === manualTriggerSource) params.state.manualTriggerSeen = true;
  if (triggerIsInert) return [];
  return [
    {
      id,
      key: params.sourceKey,
      ...normalizedTrigger,
      ...(params.trigger.config === undefined ? {} : {config: params.trigger.config}),
    },
  ];
}

function validateTopLevelTrigger(
  params: Parameters<typeof normalizeTopLevelTrigger>[0],
): WorkflowModelValidationIssue[] {
  const triggerIssues: WorkflowModelValidationIssue[] = [];
  validateTriggerFilter({
    sourceKey: params.sourceKey,
    trigger: params.trigger,
    issues: triggerIssues,
  });
  if (params.trigger.source === manualTriggerSource && params.state.manualTriggerSeen) {
    triggerIssues.push(
      issue({
        code: 'multiple-manual-triggers',
        message: `A workflow may declare at most one manual trigger; found ${params.manualTriggerKeys.length}: ${params.manualTriggerKeys.join(', ')}. This trigger is inert because it is not the first manual trigger in document order.`,
        path: ['triggers', params.sourceKey],
        details: {manualTriggerKeys: params.manualTriggerKeys},
        scope: 'trigger',
      }),
    );
  }
  return triggerIssues;
}

function normalizeCronTrigger(
  sourceKey: string,
  id: string,
  trigger: WorkflowDocumentTrigger,
  normalizedTrigger: WorkflowModelListeningTrigger,
  triggerIsInert: boolean,
  issues: WorkflowModelValidationIssue[],
): WorkflowModelTrigger[] {
  const cronConfig = triggerSourceConfigSchemas.cron.parse(trigger.config ?? {});
  const cronIssues: WorkflowModelValidationIssue[] = [];
  validateCronTrigger({config: cronConfig, sourceKey, issues: cronIssues});
  issues.push(...cronIssues);
  if (triggerIsInert || cronIssues.some((candidate) => candidate.scope === 'trigger')) return [];
  return [
    {
      id,
      key: sourceKey,
      ...normalizedTrigger,
      config: {...cronConfig, timezone: cronConfig.timezone ?? cronTriggerDefaultTimezone},
    },
  ];
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

export function normalizeTriggerEntry(
  trigger: {
    readonly source: string;
    readonly event?: string | undefined;
    readonly with?: Readonly<Record<string, unknown>> | undefined;
    readonly filter?: string | undefined;
  },
  options?: {
    /** Base path naming the trigger key or the listening matcher index. */
    readonly path?: readonly WorkflowModelValidationIssuePathSegment[] | undefined;
    readonly issues?: WorkflowModelValidationIssue[] | undefined;
    readonly integrationValidationContext?: IntegrationValidationContext | undefined;
  },
): WorkflowModelListeningTrigger {
  // `manual` and `cron` have no delivered event to resolve against at fire
  // time, so materialize their built-in name when the author omitted it.
  // Integration sources keep the event absent, which becomes a source
  // subscription (NULL row) on the write path.
  const event = builtinEventForSource(trigger.source, trigger.event?.trim());
  if (options?.issues !== undefined && options.path !== undefined) {
    validateTriggerSourceEvent({
      source: trigger.source,
      event,
      path: options.path,
      issues: options.issues,
      integrationValidationContext: options.integrationValidationContext,
    });
  }
  return {
    source: trigger.source,
    ...(event === undefined ? {} : {event}),
    ...(trigger.with === undefined ? {} : {inputs: trigger.with}),
    ...(trigger.filter === undefined ? {} : {filter: trigger.filter}),
  };
}

/**
 * Validates a trigger `source` and explicit `event` against the workspace
 * connection snapshot and provider event catalogs. Applies to top-level
 * triggers and listening `on` / `until` matchers alike; `path` names the
 * trigger key or the matcher index.
 *
 * Shipfox-minted sources (`manual`, `cron`) are checked without an
 * integration context: their one event is fixed by this codebase. Integration
 * slugs need the connection snapshot, so definitions parsed without one skip
 * the slug and event checks entirely.
 */
export function validateTriggerSourceEvent(params: {
  readonly source: string;
  readonly event: string | undefined;
  readonly path: readonly WorkflowModelValidationIssuePathSegment[];
  readonly issues: WorkflowModelValidationIssue[];
  readonly integrationValidationContext?: IntegrationValidationContext | undefined;
}): void {
  const {source, path, issues} = params;
  const event = params.event?.trim();
  const eventPath: readonly WorkflowModelValidationIssuePathSegment[] = [...path, 'event'];
  const integrationValidationContext = params.integrationValidationContext;

  if (source === manualTriggerSource || source === cronTriggerSource) {
    validateBuiltinTriggerEvent(source, event, eventPath, issues);
    return;
  }

  // Integration-source checks are intentionally skipped when the caller has
  // no workspace context. Keep that contract even for blank event values.
  if (integrationValidationContext === undefined) return;
  validateIntegrationTriggerEvent(
    source,
    event,
    path,
    eventPath,
    integrationValidationContext,
    issues,
  );
}

function pushInvalidTriggerEvent(
  source: string,
  event: string | undefined,
  path: readonly WorkflowModelValidationIssuePathSegment[],
  message: string,
  issues: WorkflowModelValidationIssue[],
  provider?: string,
): void {
  issues.push(
    issue({
      code: 'invalid-trigger-event',
      message,
      path,
      details: provider === undefined ? {event, source} : {event, source, provider},
      scope: 'trigger',
    }),
  );
}

function validateBuiltinTriggerEvent(
  source: string,
  event: string | undefined,
  eventPath: readonly WorkflowModelValidationIssuePathSegment[],
  issues: WorkflowModelValidationIssue[],
): void {
  if (event === '') {
    pushInvalidTriggerEvent(
      source,
      event,
      eventPath,
      `A ${source} trigger event cannot be blank.`,
      issues,
    );
    return;
  }
  const expectedEvent = source === manualTriggerSource ? 'fire' : 'tick';
  if (event !== undefined && event !== expectedEvent) {
    pushInvalidTriggerEvent(
      source,
      event,
      eventPath,
      `A ${source} trigger must use event "${expectedEvent}"; found "${event}".`,
      issues,
    );
  }
}

function validateIntegrationTriggerEvent(
  source: string,
  event: string | undefined,
  path: readonly WorkflowModelValidationIssuePathSegment[],
  eventPath: readonly WorkflowModelValidationIssuePathSegment[],
  integrationValidationContext: IntegrationValidationContext,
  issues: WorkflowModelValidationIssue[],
): void {
  if (event === '') {
    pushInvalidTriggerEvent(
      source,
      event,
      eventPath,
      `A ${source} trigger event cannot be blank.`,
      issues,
    );
    return;
  }
  const connection = integrationValidationContext.workspaceConnectionSnapshot.get(source);
  if (connection === undefined) {
    // The connection may be created later; INTEGRATION_CONNECTION_AVAILABLE
    // re-syncs every project, so the warning clears by itself. The trigger
    // stays active and its subscription is created now. An unknown slug also
    // means an unknown provider, so the event is not checked.
    issues.push(
      issue({
        code: 'unknown-trigger-source',
        message: `Source "${source}" matches no connection in this workspace; the trigger stays active and fires once a connection with this slug exists.`,
        path,
        details: {source},
        severity: 'warning',
        scope: 'trigger',
      }),
    );
    return;
  }

  if (event === undefined) return;

  const {provider} = connection;
  const catalog = integrationValidationContext.eventCatalogs.get(provider);
  if (integrationValidationContext.fixedEventProviders.has(provider)) {
    validateFixedProviderEvent(source, event, provider, catalog, eventPath, issues);
    return;
  }

  // Provider-minted event name: the catalog documents what this version's
  // handler forwards, not what a deployment can receive, so an unlisted name
  // is a warning and the trigger stays active.
  if (catalog !== undefined && !catalog.has(event)) {
    issues.push(
      issue({
        code: 'unknown-trigger-event',
        message: `Event "${event}" is not in the ${provider} event catalog; the trigger stays active because this deployment's provider app may deliver it.`,
        path: eventPath,
        details: {event, source, provider},
        severity: 'warning',
        scope: 'trigger',
      }),
    );
  }
}

function validateFixedProviderEvent(
  source: string,
  event: string,
  provider: string,
  catalog: ReadonlySet<string> | undefined,
  eventPath: readonly WorkflowModelValidationIssuePathSegment[],
  issues: WorkflowModelValidationIssue[],
): void {
  if (catalog?.has(event)) return;
  const singleEvent = catalog?.size === 1 ? [...catalog][0] : undefined;
  let message = `Event "${event}" is never delivered by provider "${provider}".`;
  if (catalog === undefined) {
    message = `Provider "${provider}" has no fixed event catalog; event "${event}" cannot be validated.`;
  } else if (singleEvent !== undefined) {
    message = `A ${provider} trigger must use event "${singleEvent}"; found "${event}".`;
  }
  pushInvalidTriggerEvent(source, event, eventPath, message, issues, provider);
}

function builtinEventForSource(source: string, event: string | undefined): string | undefined {
  if (source === manualTriggerSource) return event ?? 'fire';
  if (source === cronTriggerSource) return event ?? 'tick';
  return event;
}
