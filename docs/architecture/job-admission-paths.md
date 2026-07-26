# Job-admission paths

This document maps the current paths that can admit new workflow work. It is
the source for the follow-up workspace-suspension gates.

## Workspace operating-state contract

The Workspaces module publishes
`getWorkspaceOperatingState({workspaceId})` through
`@shipfox/api-workspaces-dto/inter-module`.

The result contains only the checked `status` fact. The known
`workspace-not-found` error identifies a missing workspace. The contract does
not expose workspace details, membership, suspension commands, or dashboard
data.

The future admission gate uses `status: suspended` to reject new work with the
stable `workspace-suspended` result. It does not recheck work that was already
queued or running before suspension.

## Current inventory

| Path | Intake and routing owner | Admission boundary owner | Gate location for ENG-1274 |
| --- | --- | --- | --- |
| Manual workflow run | Triggers route `POST /triggers/:definitionId/fire-manual` and `fireManualSubscription` | Workflows | `createWorkflowsInterModulePresentation.startRunFromTrigger`, before `runWorkflow` |
| Scheduled workflow run | Triggers cron worker and `fireCronSubscription` | Workflows | The same `startRunFromTrigger` presentation |
| Integration webhook to a workflow trigger | The enabled integration provider receives the webhook; Integrations publishes `INTEGRATION_EVENT_RECEIVED`; Triggers runs `dispatchIntegrationEvent` | Workflows | The same `startRunFromTrigger` presentation |
| Integration webhook to a listening job | Integrations and Triggers route the event through `routeEventToJobListeners`; Workflows buffers and materializes the listener execution in `deliverEventToListener` | Workflows | `createWorkflowsInterModulePresentation.deliverEventToJobListener`, before listener execution materialization |
| User-requested rerun | Workflows route `POST /workflows/runs/:id/rerun` calls `createRerunWorkflowRun` | Workflows | `rerunRunRoute` and `createRerunWorkflowRun`, before the new attempt graph is persisted |

The webhook intake family currently includes the generic webhook, GitHub,
Gitea, Linear, Sentry, and Slack provider route groups. They validate and
publish provider events. They do not create workflow runs or listener
executions directly, so they do not each need a separate workspace admission
gate.

## Existing work that stays unchanged

Workflow orchestration later sends an already-materialized job execution to
Runners through `enqueueJobExecution`. This is execution of existing work, not
new workspace admission. The suspension change must not reject this path, so
queued and running jobs can finish normally.

## Follow-up ownership

ENG-1274 has one independently owned admission implementation package:
`@shipfox/api-workflows`. Triggers and Integrations remain responsible for
their intake and retry behavior. Workspaces remains responsible for the
status fact. No dashboard suspension route is part of this inventory change.
