# Architecture decision record 0002: Server inter-module architecture

- **Status:** Accepted.
- **Date:** 2026-07-19.
- **Decision owners:** Inter-module contracts.
- **Decision issue:** [Define the server inter-module architecture](https://linear.app/shipfox/issue/ENG-1032/define-the-api-inter-module-architecture-and-bounded-context-policy).
- **Foundation delivery:** [Build the registered in-memory transport](https://linear.app/shipfox/issue/ENG-1033/build-the-registered-in-memory-inter-module-transport).
- **Amended by:** [ADR 0004: Shared semantic packages and server dependency boundaries](0004-shared-semantic-packages-and-server-dependency-boundaries.md).
- **Amended by:** [ADR 0006: Database ownership boundaries](0006-database-ownership-boundaries.md).
- **Amended by:** [ADR 0015: Usage context and application seams](0015-usage-context-and-application-seams.md).

## Context

**Direct imports hide the real boundary.** Shipfox's application programming interface (API)
modules import domain functions, errors, database helpers, and config from each other. They also
import callback-based providers. Some modules use global setters.

**Local calls hide data problems.** They can pass classes and functions. They can also share objects
that cannot cross a network. Published packages can make these internal details part of the public
contract.

**A spike compared two designs.** The [contract-first transport spike](https://linear.app/shipfox/issue/ENG-1031/spike-contract-first-in-memory-calls-between-triggers-and-workflows)
used plain [TypeScript](https://www.typescriptlang.org/) and [Zod](https://zod.dev/) in one design.
The other design used [oRPC](https://github.com/unnoq/orpc). The spike tested local and network calls
at the Triggers to Workflows boundary. It kept no code.

## Decision

**Shipfox uses producer-owned inter-module APIs.** Each API has four parts:

- A **contract** defines stable method names, checked data, and known errors.
- A **client** gives a caller only the methods it needs.
- A **presentation** maps the contract to the producer's domain code.
- A **transport** checks and copies each call. The first transport runs in memory.

**The application root owns the full graph.** It creates the transport and clients. It passes each
module only the clients that module needs. It registers all presentations. It seals the graph before
startup work can change state.

**The same client can later use a network.** A future
[Hypertext Transfer Protocol (HTTP)](https://developer.mozilla.org/en-US/docs/Web/HTTP) transport can
implement the contract without changing callers.

**Plain TypeScript and Zod meet the current need.** oRPC adds a framework and a larger release
surface. It does not solve a missing requirement. Shipfox does not adopt it today.

**This record changes no runtime behavior.** Follow-up work builds the shared transport. Later work
moves one producer boundary at a time.

## Bounded contexts

**A bounded context owns one business capability.** It owns the data and rules. It also owns the
operations, errors, config, and presentations.

**A package is a build and release unit.** One context can use more than one package. Its data
transfer object (DTO) packages hold public data shapes and events.

**This map defines the current contexts.** A package split does not create a new context.

| Bounded context | Packages |
| --- | --- |
| Agent | `@shipfox/api-agent`, `@shipfox/api-agent-dto`. |
| Annotations | `@shipfox/annotations`, `@shipfox/annotations-dto`. |
| Auth | `@shipfox/api-auth`, `@shipfox/api-auth-dto`. |
| Definitions | `@shipfox/api-definitions`, `@shipfox/api-definitions-dto`. |
| Integrations | `@shipfox/api-integration-core`, all provider packages, and their DTO packages. |
| Logs | `@shipfox/api-logs`, `@shipfox/api-logs-dto`. |
| Projects | `@shipfox/api-projects`, `@shipfox/api-projects-dto`. |
| Runners | `@shipfox/api-runners`, `@shipfox/api-runners-dto`. |
| Secrets | `@shipfox/api-secrets`, `@shipfox/api-secrets-dto`. |
| Triggers | `@shipfox/api-triggers`, `@shipfox/api-triggers-dto`. |
| Workflows | `@shipfox/api-workflows`, `@shipfox/api-workflows-dto`. |
| Workspaces | `@shipfox/api-workspaces`, `@shipfox/api-workspaces-dto`. |

**Three packages provide shared API support.** `@shipfox/api-dispatcher`,
`@shipfox/api-auth-context`, and `@shipfox/api-common-dto` do not own business capabilities.
`@shipfox/api-server` is the application root.

**Integrations is one context with an internal service provider interface (SPI).** Its core and
provider packages can share provider ports and adapters. The context map controls this exception.
[Dependency Cruiser](https://github.com/sverweij/dependency-cruiser) uses the map for its rules.
Update this record before adding another package to the map.

## Current crossing inventory

**The inventory covers both imports and runtime wiring.** It checks production files under
`libs/api/**/src` and package exports as of 2026-07-19. It also checks
`libs/api/server/src/modules.ts`. Root-level injection matters because it does not appear as a caller
import.

<details>
<summary><strong>Show the source-backed crossing map.</strong></summary>

| Producer | Caller | Current surface | Intended producer API |
| --- | --- | --- | --- |
| Secrets | Agent | Reads, writes, deletes, and domain errors. | Secret and namespace operations. |
| Secrets | Integrations | Raw secret functions and provider namespace wrappers. | Provider-scoped secret operations. |
| Secrets | Workflows | Secret and variable reads plus a domain error. | Secret and variable reads. |
| Workspaces | Auth | Membership and invitation functions plus domain errors. | Membership and invitation operations. |
| Workspaces | Integrations | A membership database check in install routes. | Active membership checks. |
| Integrations | Projects | Source-control provider ports and domain errors. | Source-control operations. |
| Integrations | Definitions | Source control, catalogs, snapshots, connections, and errors. | Source-control and connection operations. |
| Integrations | Workflows | Checkout types, catalogs, connection data, and global setters. | Checkout, connection, and agent-tool operations. |
| Workflows | Integrations | A leased-step loader passed through the application root. | Leased-step context lookup. |
| Projects | Definitions | Project access function and domain error. | Project access checks. |
| Projects | Secrets | Project lookup and access function plus a domain error. | Project ownership checks. |
| Projects | Workflows | Project lookup and access functions plus domain errors. | Project lookup and access checks. |
| Auth | Runners | Token functions and Auth config. | Runner and job token creation. |
| Auth | Workflows | Job lease token function. | Job lease token creation. |
| Auth | Logs | Auth config. | Module-owned config or application policy. |
| Workflows | Triggers | Run and listener commands, entities, and domain errors. | Run start and listener delivery commands. |
| Workflows | Logs | Step entity lookup and a global test replacement. | Step log context lookup. |
| Definitions | Workflows | Definition lookup, mutable models, and defaults. | Versioned definition snapshots. |
| Runners | Workflows | Queue commands, lease checks, and capability helpers. | Scheduling, lease, and capability operations. |
| Agent | Workflows | Callbacks, credentials, deep imports, and domain errors. | Agent defaults, step setup, and runtime credentials. |
| Annotations | Workflows | Write function, params, and domain errors. | Annotation replace and remove commands. |

</details>

**The root may import module code.** `@shipfox/api-server` must import module factories and
presentations to build the graph. Other packages cannot use this exception.

**Delivery tracking lives outside this record.** The
[API inter-module contracts project](https://linear.app/shipfox/project/api-inter-module-contracts-de98dd5921b5)
holds the order, owners, and issue links.

## Contract ownership and names

**The producer's DTO package owns the contract.** It adds an explicit `/inter-module` export. Shipfox
does not create a second contract package for the same context.

**The package root does not re-export these symbols.** HTTP data and events can keep their current DTO
exports without becoming inter-module API contracts.

**Names follow one pattern.** Workflows provides this import:

```ts
import {
  workflowsInterModuleContract,
  type WorkflowsInterModuleClient,
} from '@shipfox/api-workflows-dto/inter-module';
```

| Item | Pattern | Example |
| --- | --- | --- |
| Package export | `<producer DTO package>/inter-module`. | `@shipfox/api-workflows-dto/inter-module`. |
| Contract value | `<producer>InterModuleContract`. | `workflowsInterModuleContract`. |
| Client type | `<Producer>InterModuleClient`. | `WorkflowsInterModuleClient`. |
| Presentation factory | `create<Producer>InterModulePresentation`. | `createWorkflowsInterModulePresentation`. |
| Module name | Stable lowercase context name. | `workflows`. |
| Method name | Stable use-case verb phrase. | `startRunFromTrigger`. |

**Method names describe business use cases.** They do not copy database function names. Contracts do
not expose broad stores, callbacks, config objects, or transactions.

**DTO packages stay small.** They can use Zod and other DTO packages. They cannot use producer code
or a transport. They also cannot use these tools:

- [Fastify](https://fastify.dev/).
- [Drizzle](https://orm.drizzle.team/).
- [OpenTelemetry](https://opentelemetry.io/).

## Composition lifecycle

**The root builds and seals one graph.** It follows this order:

1. Create an isolated transport for the application instance.
2. Create typed clients from contracts.
3. Pass only declared clients to each module factory.
4. Collect presentations from the returned `ShipfoxModule` values.
5. Register presentations and reject duplicates.
6. Check that every required method has one presentation.
7. Seal the transport and reject later changes.
8. Start migrations, tasks, workers, metrics, and HTTP listeners.

**Clients can exist before presentations.** This rule supports two contexts that call each other without a
code import cycle.

```ts
const transport = createInterModuleTransport();

// Clients can exist before the root registers producer presentations.
const workflows = transport.createClient(workflowsInterModuleContract);
const integrations = transport.createClient(integrationsInterModuleContract);

const modules = [
  createWorkflowsModule({clients: {integrations}}),
  createIntegrationsModule({clients: {workflows}}),
];

registerInterModulePresentations({transport, modules});

// Seal the graph before startup can change state.
transport.seal();
```

**Modules declare needs and presentations as data.** A module receives clients, but it never receives
the registry. A presentation closes over its producer's domain code.

**Global injection is forbidden.** Modules cannot use a global setter, service locator, module-load
registration, or mutable default client. Tests and application instances create isolated transports.

## Call rules

### Data

**Every contract value uses
[JavaScript Object Notation (JSON)](https://www.json.org/json-en.html).** The local transport performs
a JSON round trip or an equal copy. A local call cannot share mutable data with a presentation.

<details>
<summary><strong>Show the JSON value rules.</strong></summary>

- Allow `null`, booleans, finite numbers, strings, arrays, and objects with string keys.
- Use strings in the
  [International Organization for Standardization (ISO) 8601 format](https://www.iso.org/iso-8601-date-and-time-format.html)
  for dates.
- Use strings for values that can lose number precision.
- Use a documented string format or a blob boundary for binary data.
- Reject `undefined`, `bigint`, symbols, functions, classes, `Date`, `Map`, `Set`, and streams.
- Reject software development kit (SDK) objects, Fastify requests, Drizzle rows, and transactions.

</details>

**Zod schemas define the runtime shape.** TypeScript types come from those schemas. Object schemas
remove unknown fields by default. A strict object must state why extra fields are unsafe.

### Errors

**Each method lists its known errors.** Error codes use stable kebab-case names. Zod checks the detail
shape for each code.

**Presentations map domain errors at the boundary.** Callers receive a transport-owned error with `code`
and checked `details`. They never import a producer error class.

**Unknown failures stay private.** The transport hides source details. These include the message,
stack, cause, [Structured Query Language (SQL)](https://www.postgresql.org/docs/current/tutorial-sql.html),
and SDK response. The transport also hides secrets and raw data. Logs and traces hold the diagnostic
facts.

**Transport types can differ.** Local and HTTP transports promise the same results and known errors.
They do not promise the same internal error class or text.

### Versions

**Module and method names stay stable.** An added method gets a new name. A safe optional field can
extend an existing method when old code can ignore it.

**Breaking changes use a new method name.** For example, a producer can add
`getDefinitionSnapshotV2`. Both names stay live while callers move.

**A new known error is a breaking change.** A caller may use an exhaustive code check. Add the error
through a new method or a major contract release.

**Stored data carries its own schema version.** A producer treats an unknown version as a private
compatibility failure unless the contract lists it as a known caller error.

### Traces

**The transport creates a client span and a presentation span.** It passes the active trace through
transport metadata, not business data.

**Trace fields stay small and safe.** They can include module, method, transport, result, and known
error code. They cannot include inputs, outputs, secrets, tokens, messages, or record keys.

**A future HTTP transport continues the same trace.** It does not start a new root trace.

### Retries and cancellation

**Queries do not change state.** Commands can change state.

**Retryable commands carry a stable key.** The producer checks that key at the same data boundary as
the state change. [Temporal](https://temporal.io/) activities reuse the same key on a retry.

**Cancellation can stop waiting.** An
[`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal) or deadline is a
transport option. It is not a business field. It cannot prove that a command rolled back.

**Some failures leave an unknown result.** Cancellation, timeout, or connection loss may happen after
a commit. The caller retries with the same key or reads producer state. Error text must not claim a
rollback when the transport cannot prove one.

## Choose the right boundary

**The caller's need selects the boundary.** Use this table:

| Boundary | Use it when | Key rule |
| --- | --- | --- |
| Inter-module API | The caller needs a result now. | The work fits in one request or Temporal activity. |
| Outbox event | The producer reports a fact after commit. | The state change and event commit together. |
| Temporal | Work needs retries, timers, waits, or recovery. | Workflow code stays deterministic. |

**Outbox events support later work.** They can have many independent listeners. The producer puts the
event schema in its DTO package.

**Temporal supports durable work.** An activity can use an injected inter-module client. Workflow code
does not receive a transport, registry, database handle, or producer module.

**Transactions never cross contexts.** One producer must own any operation that needs one atomic
transaction. If no producer can own it, the context split is wrong.

## Dependency policy

### Allowed dependencies

**Every exception has one reason and a narrow limit.**

| Dependency | Reason | Limit |
| --- | --- | --- |
| Producer `/inter-module` export | Synchronous contract. | JSON-safe Zod schemas and types only. |
| Producer DTO and event exports | HTTP data and committed facts. | No code, database, or config types. |
| `@shipfox/node-temporal` and producer DTOs | Durable work. | No peer workflow, activity, or database code. |
| Pure shared utility | Context-free behavior. | No state, config, domain entity, or domain error. |
| `@shipfox/api-auth-context` | Request facts from checked claims. | No business database lookup. |
| Integrations SPI | One context spans core and providers. | Only mapped Integrations packages. |
| `@shipfox/api-server` | The root must build the graph. | Wiring only. No reusable business API. |
| Shared platform package | Common module, outbox, trace, database, or HTTP support. | It cannot expose one context to another. |

**A shared package does not erase ownership.** A helper is pure only when its words and behavior do
not belong to a business context.

### Forbidden dependencies

**A context cannot import another context's code.** This ban includes value and type-only imports:

- Package roots and subpaths.
- Domain functions, entities, errors, provider objects, and callback-based resolvers.
- Database schemas, rows, queries, transactions, and migrations.
- Config schemas, parsed config, and secrets.
- Module values and module factories.
- Global setters, service locators, and test replacement hooks.

**Re-exports cannot bypass the rule.** A DTO or shared package cannot re-export a producer code type.

## Dependency Cruiser enforcement

**The final migration adds a repository gate.** It reads the context map from this record. It checks
production imports, including relative paths and dynamic imports. Caller tests use fake presentations
instead of importing peer implementations.

<details>
<summary><strong>Show the planned rule set.</strong></summary>

1. `api-no-cross-context-implementation-imports` blocks peer code roots and subpaths.
2. `api-inter-module-contract-location` accepts sync contracts only from `/inter-module`.
3. `api-no-peer-config-imports` gives config leaks a clear error.
4. `api-integrations-provider-spi` limits the Integrations exception to mapped packages.
5. `api-composition-root-only` allows factories and modules only in the application root.

**Tests use fake presentations instead of peer code.** Cross-context integration tests live at the
application or end-to-end (E2E) layer.

</details>

**The gate has no broad temporary list.** A blocked move gets one exact path, one owner, one reason,
and one tracking issue. The final move removes that path or records a new decision.

## Adding a context or method

**Add a context to the map before adding its code.** List every implementation package in
`.dependency-cruiser.cjs`. The rule then blocks imports from every other mapped context. The
application root remains the only package that imports multiple implementations to compose them.
Provider packages belong to Integrations unless this record changes the boundary.
DTO-only packages, the shared auth context, Email Challenges, and dispatcher infrastructure are not
bounded contexts. Email Challenges is provider-neutral infrastructure consumed directly by Auth.

**Keep the inventory complete.** `pnpm check:api-context-inventory` scans every non-DTO API package
and requires exactly one classification in `api-contexts.cjs`: a bounded context, shared
infrastructure, or the composition root. It also rejects stale registry paths. CI runs this check
before Dependency Cruiser, so a new package cannot bypass the boundary by omission.

**Add a method at the producer boundary.** Put its Zod input, output, and known-error schemas in
the producer DTO package's `/inter-module` export. Add the method to the contract, implement it in
the producer presentation, create the typed client in `libs/api/server/src/modules.ts`, and inject
only that client into its callers. Register the presentation through the producer's
`ShipfoxModule` declaration. Do not add a root compatibility export, callback, global setter, or
test replacement hook.

**Prove the whole path.** Add contract-schema, producer-presentation, and fake-client caller tests.
Update the API server composition test to prove every client has one presentation and that the
transport seals. Run the producer and consumer package checks, Dependency Cruiser, and the packed
consumer check before publishing a contract change.

## Testing model

**The shared test kit accepts fake presentations.** It does not depend on
[Vitest](https://vitest.dev/) or global state.

<details>
<summary><strong>Show the required checks.</strong></summary>

| Check | Proof |
| --- | --- |
| Contract schemas | Valid data and every known error shape. |
| Producer presentation | Domain mapping and real [PostgreSQL](https://www.postgresql.org/) behavior where needed. |
| Transport suite | Bad input, bad output, errors, cancellation, traces, and JSON copy. |
| Caller | Caller behavior against a fake presentation. |
| Application graph | Missing presentations, duplicates, early calls, and late changes. |
| Packed caller | Runtime and type imports work outside the monorepo. |

</details>

**Local and HTTP transports run the same behavior suite.** Results and known errors must match.
Internal error types and text can differ.

## Release and migration policy

**Published contracts follow [semantic versioning](https://semver.org/).**

| Change | Package change |
| --- | --- |
| Add a method or a safe optional field. | Minor. |
| Fix a compatible check or diagnostic. | Patch. |
| Remove a method or code. | Major. |
| Add a required field or tighter input. | Major. |
| Change output, side effects, retry rules, or access rules. | Major. |

**Published module factories follow the same rule.** A required client, removed module value, or
removed code export is a major change. The change includes migration notes.

**Each move finishes one producer boundary.** The contract, presentation, and all callers land together.
Old code exports do not become a permanent bridge.

**Release checks cover the public package.** Each move runs package, type, test, and dependency
checks. It also checks the lockfile, published files, and packed caller. The application release must
include each runtime package.

## Consequences

**Local calls gain a visible boundary.** The extra schemas, presentations, and wiring make each dependency
clear. They also find network data problems before a service split.

**The application root becomes the only full-graph owner.** Callers can test with fake presentations. They
do not need producer databases or config.

**This design does not create separate services.** It keeps that option open through JSON data,
stable errors, traces, cancellation rules, and versions.

## Rejected alternatives

### Keep direct code calls

**Direct calls are small but leak internal code.** They allow deep imports, shared database access,
and values that cannot cross a network.

### Adopt oRPC now

**oRPC adds more than the current boundary needs.** Plain TypeScript and Zod fit the current module,
error, and package rules with fewer dependencies.

**A later service split can reopen this choice.** Revisit it only if the shared contract and HTTP
transport would have to rebuild framework features.

### Use a dependency injection container

**A container hides the graph behind runtime lookup.** A global registry also joins test and
application state. Typed clients and module factories keep the graph visible.

### Create one contract package per producer

**The DTO package already owns public data and events.** A second package would split one contract
between two owners. The `/inter-module` export gives it a clear home.
