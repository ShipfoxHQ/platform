# Shipfox API Workflows

Shipfox API Workflows creates and runs workflow definitions, jobs, executions, steps, and run history.

## What it does

- **`createWorkflowsModule`**: Registers workflow routes, persistence, events, subscribers, and orchestration.
- **`runWorkflow`**: Loads a definition and creates a run with its initial graph.
- **`WorkflowRun`**: Represents a run with UUID identity, status, trigger data, and display fields.
- **`loadRunningLeasedStep`**: Loads the step state available to a leased runner.

## Installation / Setup

```sh
pnpm add @shipfox/api-workflows
```

The module requires the Auth, Definitions, Integrations, Projects, Runners,
Secrets, Workspaces, Annotations, and Agent inter-module clients.

## Usage

```ts
import {runWorkflow} from '@shipfox/api-workflows';

const run = await runWorkflow(definitions, {
  agent,
  workspaceId,
  projectId,
  definitionId,
  triggerPayload: {
    source: 'manual',
    event: 'fire',
    subscriptionId,
    userId,
  },
});
```

## Routes / API / Data Model

Workflow routes keep UUIDs in path and query parameters. The run response
includes both `id` and `number`. The UUID identifies the run. The number is a
display label and workflow expression value.

## Behavior Notes

Run numbers are sequential within one workflow definition, start at `1`, and
are unique for `(definition_id, number)`. The Workflows module allocates the
number with a per-definition counter inside the run-creation transaction. It
resolves trigger idempotency before allocation, so a duplicate delivery returns
the original run without consuming another number.

Gaps are acceptable because the number is a label and monotonicity matters more
than density. Counter rows stay after a definition is removed, and reruns create
another attempt on the same run without consuming a number.

Run numbers are never addresses. No route resolves a run by its number, and run
URLs continue to use the run UUID. A run number is useful in workflow
expressions as `run.number` and should appear beside the workflow name when it is
shown in a list.

## Development

```sh
turbo check --filter=@shipfox/api-workflows
turbo type --filter=@shipfox/api-workflows
turbo test --filter=@shipfox/api-workflows
```

DB-backed workflow tests need local Postgres from `docker compose up -d`.

## License

MIT
