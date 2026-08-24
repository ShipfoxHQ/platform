import {randomUUID} from 'node:crypto';
import type {TriggerDto} from '@shipfox/api-definitions-dto';
import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import {getTriggerEventById} from '#db/event-queries.js';
import {devRunsCount} from '#metrics/instance.js';
import {evaluateTriggerFilter} from './config.js';
import {
  DevRunInputsNotAllowedError,
  DevRunReplayEventMismatchError,
  DevRunReplayEventNotFoundError,
  DevRunReplayEventRequiredError,
  DevRunReplayEventUnavailableError,
  DevRunTriggerFilteredError,
  DevRunTriggerNotFoundError,
} from './errors.js';
import {beginTriggerHistory, toReason} from './record-trigger-history.js';
import {isPermanentStartDevRunError, type WorkflowsModuleClient} from './workflows-client.js';

export interface CreateDevRunParams {
  definitions: DefinitionsInterModuleClient;
  workflows: WorkflowsModuleClient;
  workspaceId: string;
  projectId: string;
  /** Branch or tag name the definition is read from. */
  ref: string;
  /** Commit the ref resolved to when the picker listed the file; a mismatch answers `ref-moved`. */
  commit: string | undefined;
  configPath: string;
  /** Trigger key in the resolved workflow file's `triggers` map. */
  triggerKey: string;
  /** Manual triggers only; rejected with `inputs-not-allowed` for cron and integration triggers. */
  inputs: Record<string, unknown> | undefined;
  /** Integration triggers only; the journaled event to replay. */
  replayEventId: string | undefined;
  userId: string;
}

export type DevRunTriggerKind = 'manual' | 'cron' | 'replay';

export interface DevRunResult {
  id: string;
  commit: string;
}

/**
 * Creates a dev run from a workflow file at a git ref. The definition is
 * resolved and validated at the ref without being persisted, the trigger
 * payload is built from the trigger source, and the run is created through
 * `workflows.startDevRun` with the inline model and snapshot. Manual and cron
 * triggers fire as their production counterparts; an integration trigger
 * replays one journaled event, evaluating the trigger filter exactly as
 * dispatch does. Nothing is persisted per branch and no trigger subscription
 * is created; the journal records the attempt with a single `dev` decision.
 */
export async function createDevRun(params: CreateDevRunParams): Promise<DevRunResult> {
  const resolved = await params.definitions.resolveDefinitionAtRef({
    projectId: params.projectId,
    ref: params.ref,
    configPath: params.configPath,
    ...(params.commit === undefined ? {} : {expectedCommit: params.commit}),
  });

  const trigger = resolved.triggers[params.triggerKey];
  if (!trigger) {
    throw new DevRunTriggerNotFoundError(params.triggerKey);
  }

  const built = await buildDevRunTrigger(trigger, params, resolved.workflow.id);

  // Dev runs have no upstream event id. Use the run id after success; failed
  // attempts need a synthesized ref because there is no run to key on. A
  // replay keeps the source row's provider, connection and payload on the dev
  // journal entry, with `replay_of_event_id` pointing back at the source event.
  const historyBase = {
    origin: 'dev' as const,
    workspaceId: params.workspaceId,
    provider: built.replaySource?.provider ?? null,
    source: trigger.source,
    event: built.event,
    replayOfEventId: built.replaySource?.replayOfEventId ?? null,
    deliveryId: built.replaySource?.deliveryId ?? null,
    connectionId: built.replaySource?.connectionId ?? null,
    connectionName: built.replaySource?.connectionName ?? null,
    payload: built.replaySource?.payload ?? null,
    receivedAt: new Date(),
  };

  let run: {id: string; name: string};
  try {
    run = await params.workflows.startDevRun({
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      workflowId: resolved.workflow.id,
      model: resolved.model,
      sourceSnapshot: resolved.sourceSnapshot,
      devSource: {
        ref: params.ref,
        commit: resolved.commit,
        configPath: params.configPath,
        initiatedByUserId: params.userId,
        ...(built.replaySource === undefined
          ? {}
          : {replayOfEventId: built.replaySource.replayOfEventId}),
      },
      ...(built.triggerConnectionId === undefined
        ? {}
        : {triggerConnectionId: built.triggerConnectionId}),
      triggerPayload: built.triggerPayload,
      ...(built.inputs === undefined ? {} : {inputs: built.inputs}),
    });
  } catch (error) {
    const failure = await beginTriggerHistory({...historyBase, eventRef: randomUUID()});
    await failure.devDispatchErrored(params.triggerKey, resolved.workflow.id, toReason(error));
    if (isPermanentStartDevRunError(error)) {
      devRunsCount.add(1, {trigger_kind: built.triggerKind, outcome: 'errored'});
      await failure.allErrored(1);
    } else {
      devRunsCount.add(1, {trigger_kind: built.triggerKind, outcome: 'failed'});
      await failure.failed(1);
    }
    throw error;
  }

  const history = await beginTriggerHistory({...historyBase, eventRef: run.id});
  await history.devTriggered(params.triggerKey, resolved.workflow.id, run);
  devRunsCount.add(1, {trigger_kind: built.triggerKind, outcome: 'routed'});
  await history.routed(1);
  return {id: run.id, commit: resolved.commit};
}

interface BuiltDevRunTrigger {
  triggerKind: DevRunTriggerKind;
  triggerPayload: Parameters<WorkflowsModuleClient['startDevRun']>[0]['triggerPayload'];
  inputs: Record<string, unknown> | undefined;
  event: string;
  /** Replay-only: journal identity taken from the source event row. */
  replaySource?:
    | {
        provider: string;
        deliveryId: string;
        connectionId: string | null;
        connectionName: string | null;
        payload: Record<string, unknown>;
        replayOfEventId: string;
      }
    | undefined;
  /** Replay-only: the connection the source event was received on. */
  triggerConnectionId?: string | undefined;
}

function buildDevRunTrigger(
  trigger: TriggerDto,
  params: Pick<
    CreateDevRunParams,
    'inputs' | 'replayEventId' | 'triggerKey' | 'userId' | 'workspaceId'
  >,
  workflowId: string,
): BuiltDevRunTrigger | Promise<BuiltDevRunTrigger> {
  if (trigger.source === 'manual') {
    // Request inputs override the trigger's `with` block, as fire-manual does.
    return {
      triggerKind: 'manual',
      triggerPayload: {
        provider: 'manual',
        source: 'manual',
        event: 'fire',
        userId: params.userId,
      },
      inputs: params.inputs ?? trigger.with,
      event: trigger.event ?? 'fire',
    };
  }
  if (trigger.source === 'cron') {
    if (params.inputs !== undefined) {
      throw new DevRunInputsNotAllowedError();
    }
    return {
      triggerKind: 'cron',
      triggerPayload: {provider: 'cron', source: 'cron', event: 'tick'},
      inputs: trigger.with,
      event: trigger.event ?? 'tick',
    };
  }
  return buildReplayTrigger(trigger, params, workflowId);
}

async function buildReplayTrigger(
  trigger: TriggerDto,
  params: Pick<CreateDevRunParams, 'inputs' | 'replayEventId' | 'triggerKey' | 'workspaceId'>,
  workflowId: string,
): Promise<BuiltDevRunTrigger> {
  if (params.inputs !== undefined) {
    throw new DevRunInputsNotAllowedError();
  }
  if (params.replayEventId === undefined) {
    throw new DevRunReplayEventRequiredError(trigger.source);
  }

  const sourceEvent = await getTriggerEventById(params.replayEventId);
  // A missing row and a row in another workspace answer identically: the id
  // is a uuid with no workspace scoping, so the 404 must not leak existence.
  if (!sourceEvent || sourceEvent.workspaceId !== params.workspaceId) {
    throw new DevRunReplayEventNotFoundError(params.replayEventId);
  }
  if (
    sourceEvent.origin !== 'integration' ||
    sourceEvent.source !== trigger.source ||
    sourceEvent.event !== trigger.event
  ) {
    throw new DevRunReplayEventMismatchError(params.replayEventId);
  }
  // Integration rows always carry provider and delivery id (dispatch requires
  // them); a pruned payload is the expected unavailability: `replayable`
  // lists only rows with a stored payload, so a pruned row is a race.
  if (
    sourceEvent.payload === null ||
    sourceEvent.provider === null ||
    sourceEvent.deliveryId === null
  ) {
    throw new DevRunReplayEventUnavailableError(params.replayEventId);
  }

  // Evaluate the trigger filter exactly as dispatch does: same predicate
  // context, same fail-closed semantics, no override. A false result or an
  // evaluation error refuses the replay with the reason and is journaled as a
  // `filter-error` dev decision so the events page shows why it did not run.
  const filterResult = evaluateTriggerFilter({
    subscription: {config: {filter: trigger.filter}},
    source: sourceEvent.source,
    event: sourceEvent.event,
    payload: sourceEvent.payload,
  });
  if (filterResult.kind !== 'matched') {
    const reason =
      filterResult.kind === 'filtered' ? 'Trigger filter evaluated to false' : filterResult.reason;
    const refusal = await beginTriggerHistory({
      origin: 'dev',
      workspaceId: params.workspaceId,
      provider: sourceEvent.provider,
      source: sourceEvent.source,
      event: sourceEvent.event,
      replayOfEventId: sourceEvent.id,
      deliveryId: sourceEvent.deliveryId,
      connectionId: sourceEvent.connectionId,
      connectionName: sourceEvent.connectionName,
      payload: sourceEvent.payload,
      receivedAt: new Date(),
      eventRef: randomUUID(),
    });
    await refusal.devFilterErrored(params.triggerKey, workflowId, reason);
    devRunsCount.add(1, {trigger_kind: 'replay', outcome: 'filtered'});
    throw new DevRunTriggerFilteredError(reason);
  }

  return {
    triggerKind: 'replay',
    triggerPayload: {
      provider: sourceEvent.provider,
      source: sourceEvent.source,
      event: sourceEvent.event,
      deliveryId: sourceEvent.deliveryId,
      data: sourceEvent.payload,
    },
    // The trigger `with` block supplies run inputs, as dispatch passes the
    // subscription's `with` through for integration events.
    inputs: trigger.with,
    event: sourceEvent.event,
    replaySource: {
      provider: sourceEvent.provider,
      deliveryId: sourceEvent.deliveryId,
      connectionId: sourceEvent.connectionId,
      connectionName: sourceEvent.connectionName,
      payload: sourceEvent.payload,
      replayOfEventId: sourceEvent.id,
    },
    triggerConnectionId: sourceEvent.connectionId ?? undefined,
  };
}
