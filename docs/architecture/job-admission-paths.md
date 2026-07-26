# Job-admission paths

This document maps the current paths that can admit new workflow work. It is
the source for workspace admission behavior.

## Workspace operating-state contract

The Workspaces module publishes
`getWorkspaceOperatingState({workspaceId})` through
`@shipfox/api-workspaces-dto/inter-module`.

The result contains only the checked `status` fact. The known
`workspace-not-found` error identifies a missing workspace. The contract does
not expose workspace details, membership, suspension commands, or dashboard
data.

The admission gate allows only `status: active`. It rejects `suspended` with
the stable `workspace-suspended` result and `deleted` with
`workspace-deleted`. A missing workspace produces `workspace-not-found`. The
gate fails closed for any status that the contract does not define.

The gate does not recheck work that was already queued or running before
suspension. Those jobs continue through execution.

## Current inventory

| Path | Intake and routing owner | Admission boundary owner | Gate location |
| --- | --- | --- | --- |
| Manual workflow run | Triggers route `POST /triggers/:definitionId/fire-manual` and `fireManualSubscription` | Workflows | `createWorkflowsInterModulePresentation.startRunFromTrigger`, before `runWorkflow` |
| Scheduled workflow run | Triggers cron worker and `fireCronSubscription` | Workflows | The same `startRunFromTrigger` presentation |
| Integration webhook to a workflow trigger | The enabled integration provider receives the webhook; Integrations publishes `INTEGRATION_EVENT_RECEIVED`; Triggers runs `dispatchIntegrationEvent` | Workflows | The same `startRunFromTrigger` presentation |
| Integration webhook to a listening job | Integrations and Triggers route the event through `routeEventToJobListeners`; Workflows buffers and materializes the listener execution in `deliverEventToListener` | Workflows | `createWorkflowsInterModulePresentation.deliverEventToJobListener`, before materialization for `fire` deliveries; `resolve` deliveries intentionally bypass the gate |
| User-requested rerun | Workflows route `POST /workflows/runs/:id/rerun` calls `createRerunWorkflowRun` | Workflows | `rerunRunRoute`, before `createRerunWorkflowRun` persists the new attempt graph |

The webhook intake family currently includes the generic webhook, GitHub,
Gitea, Linear, Sentry, and Slack provider route groups. They validate and
publish provider events. They do not create workflow runs or listener
executions directly, so they do not each need a separate workspace admission
gate.

## Existing work that stays unchanged

Workflow orchestration later sends an already-materialized job execution to
Runners through `enqueueJobExecution`. This is execution of existing work, not
new workspace admission. The admission gate does not reject this path, so
queued and running jobs can finish normally.

## Admission decisions

- `resolve` deliveries are exempt from the gate because they terminate existing
  listener work and do not materialize a new job execution.
- Reruns are gated in `rerunRunRoute`, immediately before
  `createRerunWorkflowRun` persists the new attempt graph.
- Already queued or running work is not rechecked after a workspace changes
  status.
- Admission failures are permanent. Triggers records and skips the event
  instead of replaying it, so webhook events received while a workspace is
  suspended are discarded and do not resume after reactivation.

## Ownership

`@shipfox/api-workflows` owns the shared admission gate. Triggers and
Integrations remain responsible for their intake and retry behavior. Workspaces
remains responsible for the operating-state fact. No dashboard suspension route
is part of this inventory.
