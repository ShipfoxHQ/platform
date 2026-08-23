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

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `RUNNER_CATALOG_PATH` | empty | Optional path to a YAML file mapping runner catalog names to complete runner label sets. |

The catalog is loaded and validated once when the Workflows module is imported;
restart the API after changing the file. An empty YAML document behaves like an
unset path; a `null` or comment-only document is invalid. Catalog names and
labels are canonicalized to lowercase.
Values that do not match a catalog name remain literal labels, so a misspelled
catalog name can leave a job waiting for a runner that never advertises it.

```yaml
# runner-catalog.yaml
shipfox-4cpu:
  - arch.amd64
  - cpu.4
```

## Routes / API / Data Model

Workflow routes keep UUIDs in path and query parameters. The run response
includes both `id` and `number`. The UUID identifies the run. The number is a
display label and workflow expression value.

## Behavior Notes

Run numbers are sequential within one workflow lineage, start at `1`, and are
unique for `(definition_id, number)`. `workflow_runs.definition_id` carries the
workflow lineage id: a stable identity per `(project_id, config_path)` shared by
every definition row of one workflow file. Pathless manual definitions share one
project-scoped lineage because they have no config path. Runs of a file keep one
numbering sequence before and after the file merges. The column keeps its v1 name;
a rename is a separate cleanup. The Workflows module allocates the number with a
per-lineage counter inside the run-creation transaction. It resolves trigger
idempotency before allocation, so a duplicate delivery returns the original run
without consuming another number.

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
