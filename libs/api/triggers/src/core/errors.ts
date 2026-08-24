export class TriggerSubscriptionNotFoundError extends Error {
  readonly subscriptionId: string;

  constructor(subscriptionId: string) {
    super(`Trigger subscription not found: ${subscriptionId}`);
    this.name = 'TriggerSubscriptionNotFoundError';
    this.subscriptionId = subscriptionId;
  }
}

export class ManualTriggerNotFoundError extends Error {
  readonly workflowDefinitionId: string;

  constructor(workflowDefinitionId: string) {
    super(`Workflow definition ${workflowDefinitionId} has no manual trigger`);
    this.name = 'ManualTriggerNotFoundError';
    this.workflowDefinitionId = workflowDefinitionId;
  }
}

export class TriggerSubscriptionNotManualError extends Error {
  readonly subscriptionId: string;
  readonly source: string;

  constructor(subscriptionId: string, source: string) {
    super(
      `Trigger subscription ${subscriptionId} has source '${source}', expected 'manual' for manual fire`,
    );
    this.name = 'TriggerSubscriptionNotManualError';
    this.subscriptionId = subscriptionId;
    this.source = source;
  }
}

export class TriggerSubscriptionNotCronError extends Error {
  readonly subscriptionId: string;
  readonly source: string;

  constructor(subscriptionId: string, source: string) {
    super(
      `Trigger subscription ${subscriptionId} has source '${source}', expected 'cron' for cron fire`,
    );
    this.name = 'TriggerSubscriptionNotCronError';
    this.subscriptionId = subscriptionId;
    this.source = source;
  }
}

export class TriggerWorkspaceMismatchError extends Error {
  readonly subscriptionId: string;
  readonly subscriptionWorkspaceId: string;
  readonly callerWorkspaceId: string;

  constructor(subscriptionId: string, subscriptionWorkspaceId: string, callerWorkspaceId: string) {
    super(
      `Trigger subscription ${subscriptionId} belongs to workspace ${subscriptionWorkspaceId}, not ${callerWorkspaceId}`,
    );
    this.name = 'TriggerWorkspaceMismatchError';
    this.subscriptionId = subscriptionId;
    this.subscriptionWorkspaceId = subscriptionWorkspaceId;
    this.callerWorkspaceId = callerWorkspaceId;
  }
}

export class DevRunTriggerNotFoundError extends Error {
  readonly triggerKey: string;

  constructor(triggerKey: string) {
    super(`Workflow definition has no trigger named '${triggerKey}'`);
    this.name = 'DevRunTriggerNotFoundError';
    this.triggerKey = triggerKey;
  }
}

export class DevRunInputsNotAllowedError extends Error {
  constructor() {
    super('Cron dev runs do not accept request inputs; the trigger `with` block is used');
    this.name = 'DevRunInputsNotAllowedError';
  }
}

export class DevRunReplayEventRequiredError extends Error {
  readonly source: string;

  constructor(source: string) {
    super(`Replaying a ${source} trigger requires a journaled event (replay_event_id)`);
    this.name = 'DevRunReplayEventRequiredError';
    this.source = source;
  }
}
