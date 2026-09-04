import {Factory} from 'fishery';
import type {TriggerDecision} from '#core/entities/decision.js';
import {db} from '#db/db.js';
import {toTriggerDecision, triggersDecisions} from '#db/schema/decisions.js';

export const decisionFactory = Factory.define<TriggerDecision>(({onCreate}) => {
  onCreate(async (decision) => {
    const [row] = await db()
      .insert(triggersDecisions)
      .values({
        receivedEventId: decision.receivedEventId,
        subscriptionKind: decision.subscriptionKind,
        subscriptionId: decision.subscriptionId,
        subscriptionName: decision.subscriptionName,
        workflowDefinitionId: decision.workflowDefinitionId,
        projectId: decision.projectId,
        workflowRunId: decision.workflowRunId,
        jobId: decision.jobId,
        matcherKind: decision.matcherKind,
        matcherOrdinal: decision.matcherOrdinal,
        decision: decision.decision,
        runId: decision.runId,
        runName: decision.runName,
        reason: decision.reason,
        diagnostic: decision.diagnostic ?? null,
      })
      .returning();
    if (!row) throw new Error('Insert returned no rows');
    return toTriggerDecision(row);
  });

  return {
    id: crypto.randomUUID(),
    receivedEventId: crypto.randomUUID(),
    subscriptionKind: 'trigger',
    subscriptionId: crypto.randomUUID(),
    subscriptionName: 'Deploy production',
    workflowDefinitionId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workflowRunId: null,
    jobId: null,
    matcherKind: null,
    matcherOrdinal: null,
    decision: 'triggered',
    runId: crypto.randomUUID(),
    runName: 'deploy',
    reason: null,
    diagnostic: null,
    createdAt: new Date(),
  };
});
