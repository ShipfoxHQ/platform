# Backend architecture

This guide owns the backend module model and package-boundary rules. Read it
when you add or change an API module, HTTP route, DTO, outbox event,
cross-context dependency, or shared backend package. It links to ADRs for the
reasons and rejected options. Package READMEs own package APIs, config, and
operational details.

## Module composition

Each backend capability exposes a declarative `ShipfoxModule`. It lists the
database, routes, auth adapters, E2E routes, publishers, subscribers, workers,
and metrics it owns. Feature packages do not wire their internals into an app.

The application root puts modules in dependency order and runs each module's
migrations. Migration order does not grant access to another module's tables.
The root alone builds the full inter-module graph:

1. Create the transport for the application instance.
2. Create typed clients from producer contracts.
3. Pass each module only the clients it declares.
4. Collect and register presentations from the returned modules.
5. Seal the transport before migrations, workers, metrics, or listeners start.

Clients may exist before a producer presentation is registered. Modules do not
receive the registry. Do not use global setters, service locators, module-load
hooks, or mutable default clients. The current composition lives in
[`libs/api/server/src/modules.ts`](../../libs/api/server/src/modules.ts).

Read [ADR 0002](../adr/0002-api-inter-module-architecture.md) when changing an
inter-module contract or its setup order. It owns history, transport behavior,
and migration reasons.

Read the [database boundary policy](../policies/database-boundaries.md) when
changing a table, migration, query, foreign key, or transaction. It owns
database access and naming rules.

## Feature package layers

API feature packages usually use this shape:

```text
src/
  core/          Domain behavior, entities, provider ports, and typed errors
  db/            Drizzle tables, migrations, persistence, and row mappers
  presentation/  Fastify routes, auth adapters, and DTO conversion
```

`core/` owns business behavior. `db/` maps database rows to domain objects.
`presentation/` adapts requests and responses. A layer does not leak upward:
routes do not build database rows, domain code does not shape HTTP responses,
and DTO mappers do not hold business rules.

An HTTP route uses `defineRoute`, a Zod schema, and the named auth method it
needs. Keep route groups responsible for a shared prefix, plugin, or auth rule.
Routes call a use case and convert the result with a mapper in
`presentation/dto/`. Internal objects use camelCase. HTTP DTOs use snake_case.

## Contracts, persistence, and events

A producer owns its public contract in its sibling `*-dto` package. The DTO
package holds passive Zod schemas, inferred types, HTTP shapes, event names,
event payloads, protocol constants, and small encoding helpers. It does not
hold producer rules, database helpers, config parsers, providers, or wiring.

Keep synchronous producer operations in the explicit
`<producer-dto>/inter-module` export. Do not re-export that contract from the
DTO root. The producer maps its domain errors to contract-known errors in its
presentation. Callers depend on the client type and known results, never a
producer error class or implementation helper.

Drizzle table files own row-to-domain mapping. Higher layers use domain objects
when practical. An outbox event is a public producer contract. Define its name
and payload in the producer DTO package. Write it in the same transaction as
the state change. Register its publisher table in the module declaration.

For contract primitives and transport-specific behavior, read the
[inter-module package README](../../libs/shared/common/inter-module/README.md).
It owns that package's public API and constraints.

## Choose the boundary

Use the narrowest boundary that matches the caller's need. A shared package is
not a shortcut around a producer-owned decision.

| Caller needs | Use | Owner |
| --- | --- | --- |
| A current decision or current state from another context | A producer `/inter-module` operation | The producer context |
| A fact that a producer committed | A DTO outbox event | The producer context |
| A durable wait, retry, timer, or recovery path | A Temporal workflow and activities | The workflow owner |
| A HTTP, event, or stored-data shape | A DTO schema and versioned codec | The contract owner |
| A deterministic, context-neutral algorithm | A registered shared semantic package | The named shared concept |
| A business rule owned by one context | A producer operation or versioned producer snapshot | The producer context |

If contexts use the same business words, add a named shared product-language
package only when they jointly own the words and the API is small and stable.
Consumer count alone does not make a concept shared. If ownership is unclear,
resolve the context design before adding a generic `utils`, `common`, or
`shared` package.

Read [ADR 0004](../adr/0004-shared-semantic-packages-and-server-dependency-boundaries.md)
before adding a shared package or changing a server dependency boundary. It
owns admission rules, package classes, and decision reasons.

## Imports and package exports

Import the file that owns a symbol. Do not add broad internal barrels such as
`#core/index.js`. Keep package-root exports small. Export only a public contract
or shared entity that another package must use. Do not root-export database
helpers, routes, auth wiring, module factories, or test support.

An implementation package can import its own code, foreign DTOs and events,
foreign `/inter-module` clients, registered shared semantics, and neutral
infrastructure. It cannot import a foreign implementation. The composition
root may import implementations only to build the graph. Integration and E2E
tests can compose real modules. Consumer unit tests use a contract fake.

DTO packages may use only contract-safe foundations and passive contracts. A
DTO root never imports producer code or transport behavior. The Integrations
provider SPI is a same-context exception. It does not allow another context.

## Enforcement and updates

This guide is the canonical current rule set for backend package boundaries.
Read the [architecture validation guide](../guides/architecture-validation.md)
when adding, moving, or debugging an enforcement rule. It owns tool selection,
fixtures, cross-repository policy, and local verification.

These checks enforce the rules:

| Owner | Enforced policy |
| --- | --- |
| Biome | Local import and export syntax, including DTO root and `/inter-module` source shape. |
| Dependency Cruiser | Resolved source dependency graph, including context-aware API package edges. |
| `@shipfox/architecture-policy` through the Platform adapter | Normalized package metadata, class and realm relationships, manifest edges, export intent, diagnostics, and exact exceptions. |
| Package release verification | Packed public entry-point correctness and external-consumer closure. |

The root [API architecture Biome plugins](../../tools/biome/plugins/api-architecture/README.md)
report local DTO import and export violations at the source expression.
`pnpm check:api-context-inventory` discovers the workspace facts and evaluates
them through `@shipfox/architecture-policy`. Its local adapter reads
`api-contexts.cjs` for classifications and bounded contexts, and it does not
copy the class, realm, manifest, export, or exception decision trees. It does
not parse source imports; use Dependency Cruiser for resolved source edges.
`pnpm check:dependencies` checks dependency policy and manifest hygiene.
`pnpm check:published-artifacts` checks packed public entry points.

When adding a bounded context, classify its implementation and DTO packages in
[`api-contexts.cjs`](../../api-contexts.cjs) before adding its dependencies.
Add a synchronous method to the producer DTO's `/inter-module` export and one
producer presentation; the application composition root registers that
presentation before sealing the transport. Admit a shared semantic package only
when it meets ADR 0004's joint-ownership rules. Keep a same-context SPI narrow
and unavailable to other contexts. Consumer tests use DTO fixtures or contract
fakes; only composition and E2E tests may compose real modules.

[`tools/api-architecture-policy`](../../tools/api-architecture-policy) is the
Platform discovery adapter for the shared policy. Update `api-contexts.cjs`
when the local classification or Dependency Cruiser edge matrix changes, and
update the shared package when a reusable policy rule changes. Neither layer
may admit a completed violation with a baseline or broad exception.

Update this guide when the current model changes. Update an ADR, or add one,
when the durable decision, ownership model, or accepted tradeoff changes.
