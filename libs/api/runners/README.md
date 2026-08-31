# Shipfox API Runners

Shipfox API Runners owns runner enrollment, job leases, provider-runner state,
reservations, and termination authorization.

## What it does

- **`createRunnersModule`** registers runner routes, authentication methods,
  workers, metrics, database migrations, and event subscribers.
- **`getWorkspaceJobCounts`** returns workspace job counts for API consumers.
- **`isJobLeaseActive`** checks whether a job lease is active.
- **`getEffectiveRunnerToolCapabilities`** and **`unadvertisedRunnerTools`**
  expose runner tool capability decisions for consumers.
- **Runner lifecycle** records authorization decisions and active runner age for
  operational monitoring.

## Installation and setup

Add the package to the API application workspace:

```json
{
  "dependencies": {
    "@shipfox/api-runners": "workspace:*"
  }
}
```

The application must provide an `AuthInterModuleClient` and register the module
with the API composition root.

## Usage

```ts
import {createRunnersModule} from '@shipfox/api-runners';

const runners = createRunnersModule({auth});
```

The composition root owns module ordering, inter-module transport, and worker
startup. Runner database access remains private to this package.

## Routes and data model

`createRunnersModule` registers the runner and provisioner HTTP routes. The
module owns runner, session, reservation, lease, and outbox persistence. Its
migration directory is registered with the module database namespace.

## Behavior notes

The runners module records instance counters and service-level gauges through
`@shipfox/node-opentelemetry`. Instance metrics are emitted when a decision or
report occurs. Service gauges read current runner database state.

| Metric | Labels | Meaning |
| --- | --- | --- |
| `runners_termination_authorization_issued` | `reason` | A new durable termination authorization was persisted. |
| `runners_provider_runner_terminate_intent_honored` | `reason` | A provisioner terminate intent, including legacy intents, was honored by a terminated report. |
| `runners_termination_authorization_honored` | `reason` | A durable termination authorization was matched by a terminated report. |
| `runners_termination_authorization_rejected` | `reason` | An authorization request was rejected by the gate. |
| `runners_job_lease_expiry_deferred` | `cause` | A stale job lease expiry batch was deferred by the circuit breaker. |
| `runners_provider_runner_by_state` | `state` | Active provider-runner count. |
| `runners_provider_runner_by_state_oldest_age` | `state` | Age in milliseconds of the oldest active provider runner in that state. |

Lifecycle telemetry label cardinality is bounded. `reason` is one of the ten
values in the `RunnerTerminationReason` union, plus `unknown-reason` or
`unknown-runner` for rejected requests. `cause` is currently `correlated-stale`.
`state` is one of `starting`, `running`, or `stopping`. Terminal historical rows
are not included in active capacity gauges.

Existing phase gauges use finite phase and launch-kind unions. Provider kind is
a deployment-owned bounded value: `ec2`, `docker`, or `unknown`. Runner,
provider-instance, session, workspace, job, and provisioner identifiers are
never metric labels.

The oldest-age gauge is measured from provider-runner creation. Operators can
compare the `running` series with 172,800,000 milliseconds to find capacity
approaching the temporary 48-hour limit. Alert and dashboard configuration is
an operational rollout gate. This package does not claim that an alert is
installed unless the consuming monitoring repository versions that configuration.

Authorization and honoring logs include `component`, bounded `reason`,
`provisionerId`, and `providerRunnerId`. Operators can correlate the durable API
decision with the provisioner component that reported it honored. IDs are
structured-log fields only.

## Development

```sh
turbo check --filter=@shipfox/api-runners
turbo type --filter=@shipfox/api-runners
turbo test --filter=@shipfox/api-runners
turbo build --filter=@shipfox/api-runners
```

Tests use PostgreSQL. Start the local services with `docker compose up -d`.

## License

MIT
