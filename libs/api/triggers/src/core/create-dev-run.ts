import {randomUUID} from 'node:crypto';
import type {TriggerDto} from '@shipfox/api-definitions-dto';
import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import {devRunsCount} from '#metrics/instance.js';
import {
  DevRunInputsNotAllowedError,
  DevRunReplayEventRequiredError,
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
  /** Manual triggers only; rejected with `inputs-not-allowed` for cron. */
  inputs: Record<string, unknown> | undefined;
  userId: string;
}

export type DevRunTriggerKind = 'manual' | 'cron';

export interface DevRunResult {
  id: string;
  commit: string;
}

/**
 * Creates a dev run from a workflow file at a git ref for a manual or cron
 * trigger. The definition is resolved and validated at the ref without being
 * persisted, the trigger payload is built from the trigger source, and the
 * run is created through `workflows.startDevRun` with the inline model and
 * snapshot. Nothing is persisted per branch and no trigger subscription is
 * created; the journal records the attempt with a single `dev` decision.
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

  const {triggerKind, triggerPayload, inputs, event} = devRunTrigger(trigger, params);

  // Dev runs have no upstream event id. Use the run id after success; failed
  // attempts need a synthesized ref because there is no run to key on.
  const historyBase = {
    origin: 'dev' as const,
    workspaceId: params.workspaceId,
    provider: null,
    source: trigger.source,
    event,
    deliveryId: null,
    connectionId: null,
    connectionName: null,
    payload: null,
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
      },
      triggerPayload,
      ...(inputs === undefined ? {} : {inputs}),
    });
  } catch (error) {
    const failure = await beginTriggerHistory({...historyBase, eventRef: randomUUID()});
    await failure.devDispatchErrored(params.triggerKey, resolved.workflow.id, toReason(error));
    if (isPermanentStartDevRunError(error)) {
      devRunsCount.add(1, {trigger_kind: triggerKind, outcome: 'errored'});
      await failure.allErrored(1);
    } else {
      devRunsCount.add(1, {trigger_kind: triggerKind, outcome: 'failed'});
      await failure.failed(1);
    }
    throw error;
  }

  const history = await beginTriggerHistory({...historyBase, eventRef: run.id});
  await history.devTriggered(params.triggerKey, resolved.workflow.id, run);
  devRunsCount.add(1, {trigger_kind: triggerKind, outcome: 'routed'});
  await history.routed(1);
  return {id: run.id, commit: resolved.commit};
}

interface BuiltDevRunTrigger {
  triggerKind: DevRunTriggerKind;
  triggerPayload: Parameters<WorkflowsModuleClient['startDevRun']>[0]['triggerPayload'];
  inputs: Record<string, unknown> | undefined;
  event: string;
}

function devRunTrigger(
  trigger: TriggerDto,
  params: Pick<CreateDevRunParams, 'inputs' | 'userId'>,
): BuiltDevRunTrigger {
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
  // Integration sources require a journaled event before dispatch.
  throw new DevRunReplayEventRequiredError(trigger.source);
}
