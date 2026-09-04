# @shipfox/api-triggers-dto

## 21.2.0

### Minor Changes

- 41e1cfc: Surfaces precise, safe trigger event errors in the event detail callout.

### Patch Changes

- 8407bd1: Rejects oversized listener fire deliveries without suppressing matching resolve events.

## 21.0.0

### Minor Changes

- f3df1e5: Add bounded Agent Access trigger-event detail and facet discovery tools.

## 19.0.0

### Minor Changes

- 5af8d52: Adds project catalog and workflow-definition reads, plus trigger-event summaries, details, and facets.

### Patch Changes

- @shipfox/inter-module@0.2.3

## 15.0.0

### Minor Changes

- 1801f46: Adds `POST /dev-runs` for manually and cron-triggered dev runs. Manual runs build inputs from the request body (overriding the trigger's `with`); cron runs take inputs from the trigger's `with` and reject body inputs. Pins the optional commit, answering 409 `ref-moved` on mismatch and 422 `replay-event-required` for integration-source triggers. Ships the request body schema and `201 {workflow_run_id, commit}` response DTOs in `@shipfox/api-triggers-dto`.
- c6e7526: Adds targeted replay to `POST /dev-runs` for integration-source triggers.
  Requests may provide `replay_event_id` to use the recorded payload and integration connection.
  Manual and scheduled triggers reject `replay_event_id`.
  Refusals return `trigger-filtered` (409), `replay-event-mismatch` (409), `replay-event-not-found` (404), or `replay-event-unavailable` (410).
  Development journal entries retain `replay_of_event_id` for each replay attempt.

## 14.0.0

### Minor Changes

- 05c7c4d: Adds dev-run and replay-link support to trigger journal interfaces and client types.
- b6c7871: Adds `origin` and `replayable` filters to the trigger events list, an `origins` facet, and `replay_of_event_id` with a `replays` list on the event detail response.

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

## 0.1.0

### Minor Changes

- a460020: Add trigger event detail decisions with stored subscription names, run links, and payload inspection.
- 5ec8367: Adds trigger event inspection endpoints with matching DTO schemas for listing received events and reading event decisions.

### Patch Changes

- e5d2f13: Add the workspace **Events** page in Settings: a filterable, cursor-paginated table of
  trigger events (status dot, source/event, routing summary, delivery id, received time)
  mounted at `/workspaces/$wid/settings/events` and wired into the settings sub-nav. Filters
  (date range, source, event, outcome) live in the URL via `validateSearch`, so a filtered
  view is shareable. Source and event filters are populated by a new
  `GET /trigger-events/facets` endpoint that returns each workspace's distinct source/event
  values with counts (top 50, backed by `(workspace_id, source)` / `(workspace_id, event)`
  indexes); the list still renders if facets fail to load.
- a982f20: Stop a permanently-broken trigger subscription from starving its siblings or wedging the outbox. Integration dispatch now attempts every matched subscription and classifies each `runWorkflow` failure: a permanent error (deleted definition or project mismatch) is recorded and skipped, while a transient one re-throws so the outbox replays the event and converges. The event reaches a terminal outcome once no transient error remains (`routed` when any run was created, otherwise the new `errored` outcome), with a guarded write that never records `errored` over an event that already produced a run. The manual-fire path records the same terminal outcome, and `@shipfox/api-workflows` exports an `isPermanentRunWorkflowError` classifier. The trigger-events read API (`triggerEventOutcomeSchema`) accepts the new `errored` outcome for serialization and filtering.
- e192d86: Adds the cron firing engine: a once-per-minute tick fans out bounded drain activities that claim due schedules (FOR UPDATE SKIP LOCKED), advance their next fire time, and fire the workflow deduplicated and crash-safe, recorded in trigger history with a `cron` origin and surfaced through cron fire and backlog metrics.
