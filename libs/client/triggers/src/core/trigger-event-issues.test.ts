import type {
  TriggerEventDecisionDiagnostic,
  TriggerEventDetail,
  TriggerEventMatchedWorkflowResult,
} from './trigger-event.js';
import {getTriggerEventIssueCallout} from './trigger-event-issues.js';

function decision(
  overrides: Partial<TriggerEventMatchedWorkflowResult> = {},
): TriggerEventMatchedWorkflowResult {
  return {
    id: crypto.randomUUID(),
    subscriptionKind: 'trigger',
    subscriptionName: 'on_pr_opened',
    workflowDefinitionId: crypto.randomUUID(),
    decision: 'filter-error',
    projectId: crypto.randomUUID(),
    workflowRunId: null,
    jobId: null,
    matcherKind: null,
    matcherOrdinal: null,
    runId: null,
    runName: null,
    reason: 'Trigger filter evaluation failed',
    diagnostic: {version: 1, code: 'expression-evaluation-failed'},
    ...overrides,
  };
}

function event(overrides: Partial<TriggerEventDetail> = {}): TriggerEventDetail {
  return {
    id: crypto.randomUUID(),
    eventRef: crypto.randomUUID(),
    origin: 'integration',
    workspaceId: crypto.randomUUID(),
    provider: 'github',
    source: 'github',
    event: 'on_pr_opened',
    deliveryId: crypto.randomUUID(),
    connectionId: crypto.randomUUID(),
    outcome: 'errored',
    matchedCount: 1,
    receivedAt: '2026-09-04T12:00:00.000Z',
    processedAt: '2026-09-04T12:00:01.000Z',
    createdAt: '2026-09-04T12:00:00.000Z',
    connectionName: 'GitHub',
    payload: {},
    processingDiagnostic: null,
    decisions: [decision()],
    ...overrides,
  };
}

function descriptionText(diagnostic: TriggerEventDecisionDiagnostic): string {
  const callout = getTriggerEventIssueCallout(event({decisions: [decision({diagnostic})]}));
  return callout?.issues[0]?.description.map((part) => part.value).join('') ?? '';
}

describe('getTriggerEventIssueCallout', () => {
  test('surfaces the exact safe expression path', () => {
    const callout = getTriggerEventIssueCallout(
      event({
        decisions: [
          decision({
            diagnostic: {
              version: 1,
              code: 'expression-missing-path',
              path: 'trigger.repository',
            },
          }),
        ],
      }),
    );

    expect(callout).toMatchObject({
      type: 'error',
      title: 'Trigger filter could not be evaluated',
    });
    expect(callout?.issues[0]?.description).toContainEqual({
      kind: 'code',
      value: 'trigger.repository',
    });
    expect(
      descriptionText({version: 1, code: 'expression-missing-path', path: 'trigger.repository'}),
    ).toBe(
      'trigger.repository is not available in the on_pr_opened filter. No workflow run was created.',
    );
  });

  test('uses warning severity for partial success and caps visible issues', () => {
    const failed = Array.from({length: 4}, (_, index) =>
      decision({id: `failed-${index}`, subscriptionName: `workflow-${index}`}),
    );
    const callout = getTriggerEventIssueCallout(
      event({
        outcome: 'routed',
        decisions: [decision({id: 'success', decision: 'triggered', diagnostic: null}), ...failed],
      }),
    );

    expect(callout).toMatchObject({
      type: 'warning',
      title: 'Some workflow processing failed',
      successSummary: '1 workflow started.',
      hiddenIssueCount: 1,
    });
    expect(callout?.issues).toHaveLength(3);
  });

  test('collapses matching error codes and expression paths in decision order', () => {
    const callout = getTriggerEventIssueCallout(
      event({
        decisions: [
          decision({
            id: 'first',
            subscriptionName: 'on_pr_opened',
            diagnostic: {
              version: 1,
              code: 'expression-missing-path',
              path: 'trigger.repository',
            },
          }),
          decision({
            id: 'second',
            subscriptionName: 'deploy_preview',
            diagnostic: {
              version: 1,
              code: 'expression-missing-path',
              path: 'trigger.repository',
            },
          }),
        ],
      }),
    );

    expect(callout).toMatchObject({
      title: 'Two workflow decisions failed',
      hiddenIssueCount: 0,
      issues: [{id: 'first', affectedCount: 2}],
    });
    expect(callout?.issues[0]?.description).toContainEqual({
      kind: 'code',
      value: 'trigger.repository',
    });
  });

  test('does not render an unknown legacy reason', () => {
    const callout = getTriggerEventIssueCallout(
      event({
        decisions: [decision({diagnostic: null, reason: 'database host db.internal failed'})],
      }),
    );

    expect(callout?.title).toBe('Workflow processing failed');
    expect(callout?.issues[0]?.description.map((part) => part.value).join('')).not.toContain(
      'db.internal',
    );
  });

  test('uses an event-level diagnostic when no decision owns the failure', () => {
    const callout = getTriggerEventIssueCallout(
      event({
        decisions: [],
        processingDiagnostic: {version: 1, code: 'subscription-load-failed'},
      }),
    );

    expect(callout?.title).toBe('Event routing could not complete');
  });

  test('does not create a callout for a valid filtered decision', () => {
    const callout = getTriggerEventIssueCallout(
      event({
        outcome: 'discarded',
        decisions: [decision({decision: 'filtered', diagnostic: null, reason: null})],
      }),
    );

    expect(callout).toBeNull();
  });

  test('surfaces rejected listener event payload limits', () => {
    const callout = getTriggerEventIssueCallout(
      event({
        decisions: [
          decision({
            subscriptionKind: 'listener',
            subscriptionName: 'Notify Slack',
            decision: 'rejected',
            reason: 'payload-too-large',
            diagnostic: {
              version: 1,
              code: 'listener-event-payload-too-large',
              limitBytes: 786_432,
              measuredBytes: 786_433,
              overshootBytes: 1,
            },
          }),
        ],
      }),
    );

    expect(callout).toMatchObject({
      type: 'error',
      title: 'Event payload is too large',
    });
    expect(callout?.issues[0]?.description.map((part) => part.value).join('')).toBe(
      'The event sent to Notify Slack is 786433. The listener limit is 786432.',
    );
  });

  test('surfaces policy admission denials without exposing their raw reason', () => {
    const callout = getTriggerEventIssueCallout(
      event({
        decisions: [
          decision({
            decision: 'dispatch-error',
            reason: 'billing-payment-method-required',
            diagnostic: {version: 1, code: 'admission-denied'},
          }),
        ],
      }),
    );

    expect(callout).toMatchObject({type: 'error', title: 'Workflow start was blocked'});
    expect(callout?.issues[0]?.description.map((part) => part.value).join('')).toBe(
      'Workspace policy did not allow Shipfox to process on_pr_opened.',
    );
    expect(JSON.stringify(callout)).not.toContain('billing-payment-method-required');
  });

  test('uses the event fallback when an error has no recorded decision', () => {
    const callout = getTriggerEventIssueCallout(
      event({outcome: 'errored', decisions: [], processingDiagnostic: null}),
    );

    expect(callout?.title).toBe('Event processing failed');
  });
});
