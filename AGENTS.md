# Agent guidelines

Read [CONTRIBUTING.md](CONTRIBUTING.md) before working on this project.

## Running tasks locally

This project uses [mise](https://mise.jdx.dev/) to manage tool versions. `node`, `pnpm`, and `turbo` are all available in the shell — no `npx` needed.

```sh
# Install dependencies
pnpm install

# Build all packages
turbo build

# Check (lint + format + import sorting) / type-check / test
turbo check
turbo type
turbo type:emit
turbo test

# Scope to a specific package
turbo build --filter=@shipfox/api...

# Start local services (Docker required)
docker compose up -d

# Dev mode with hot-reload (apps only)
pnpm --filter=@shipfox/api dev
```

## Module exports and imports

Avoid broad barrel files inside modules. Prefer importing from the file that owns the
symbol, such as `#core/auth.js` or `#presentation/dto/user.js`, rather than
`#core/index.js` or another catch-all index.

Package root exports should stay intentionally small: export only shared entities and
functions that are part of the package's public API. Do not export internal DB helpers,
routes, auth wiring, or test-only utilities from a package root unless another package
is meant to depend on them directly.

## Codebase conventions

### Backend modules

Backend feature packages are composed as declarative modules. A feature package
typically exports a `ShipfoxModule` that declares its `database`, `routes`,
`auth`, `e2eRoutes`, `publishers`, `subscribers`, and/or `workers`; apps should
compose those module declarations rather than wiring feature internals directly.
Module initialization runs in array order, so list modules with shared database
dependencies before dependents.

API feature packages usually follow a layered shape:

```text
src/
  core/          Domain behavior, entities, providers, and typed errors
  db/            Drizzle schema, migrations, persistence functions, row mappers
  presentation/  Fastify routes, auth adapters, and DTO conversion
```

### HTTP routes and errors

Domain and persistence code should throw typed domain errors. Translate those
errors to `ClientError` only at the Fastify route edge with stable client-facing
error codes and HTTP statuses. Unexpected errors should be allowed to reach the
shared error handler.

Define HTTP endpoints with `defineRoute`, Zod schemas, and named auth methods
from `@shipfox/node-fastify` / `@shipfox/api-auth-context`. Prefer route groups
for shared prefixes, plugins, and inherited auth instead of repeating those
concerns in each route.

### DTOs and API contracts

Public HTTP contracts live in sibling `*-dto` packages. Put Zod request/response
schemas, inferred DTO types, and public event names/payload types there so the
backend, client, and E2E helpers all share the same contract.

Use camelCase for internal domain objects and snake_case for external HTTP DTOs.
Keep the conversion centralized in `presentation/dto/*` files; route handlers
should call a mapper like `toProjectDto()` rather than manually shaping response
objects inline.

### Persistence and events

Drizzle schema files own row-to-domain mapping. A table file should define the
table, infer DB types, and export `toX()` mappers; higher layers should work with
domain objects rather than raw Drizzle rows where possible.

Outbox events are part of a module's public contract. Define event names and
payload maps in the module's `*-dto` package, write outbox events in the same
transaction as the state change, and register publisher tables on the module
declaration.

### Client packages

Client feature packages should expose both transport functions and React Query
hooks. Use `@shipfox/client-api` for JSON requests, auth refresh, and `ApiError`
handling; colocate query keys, raw request functions, and hooks in the feature's
`hooks/api/*` module.

### E2E setup

E2E setup must stay HTTP-first. Add module-owned setup routes under
`/__e2e/<module>` and wrap them in `@shipfox/e2e-helper-*` helpers; do not create
E2E data through direct database access.

## Unit Testing Strategy (Node Apps)

Tests use **Vitest** and run against a real PostgreSQL database, not mocks. The philosophy is to test against real infrastructure where possible and only mock external dependencies (feature flags, cloud provider APIs, etc.).

Each app has two databases: one for the app itself (named after the app, e.g. `api`) and a dedicated test database (named `<app>_test`, e.g. `api_test`). The test database is selected via `process.env` overrides in `test/env.ts`.

### Test infrastructure per package

```
test/
  globalSetup.ts   # Truncates all DB tables once before the suite runs
  setup.ts         # Opens/closes the PG connection per file; calls vi.restoreAllMocks() in afterEach
  env.ts           # Overrides process.env with test values (fake credentials, TZ=UTC, etc.)
  index.ts         # Re-exports all factories
  factories/       # One file per entity, using Fishery
```

`vitest.config.ts` points `globalSetup` at `test/globalSetup.ts` and `setupFiles` at `test/setup.ts`.

### Factories (Fishery)

Factories live in `test/factories/` and use **Fishery**. They provide sensible faker-based defaults and persist to the DB via their `onCreate` handler:

```typescript
// build in memory only
const runner = runnerFactory.build({ organizationId: "org-123" });

// persist to DB
const runner = await runnerFactory.create({ organizationId: "org-123" });

// build a list
const jobs = jobFactory.buildList(3);
```

Use `build()` for pure unit tests on `core/` logic; use `create()` when the code under test queries the DB.

### Test structure — Arrange / Act / Assert

Each test is written in three clearly separated phases, in order:

1. **Arrange** — declare all data and preconditions needed for the test.
2. **Act** — call the function or trigger the behaviour under test.
3. **Assert** — verify the outcome.

Keep a blank line between each phase so the boundary is immediately visible:

```typescript
it("marks the runner as terminated", async () => {
  const runner = await runnerFactory.create({ organizationId });

  await terminateRunner(runner.id);

  const updated = await getRunner(runner.id);
  expect(updated.latestEvent?.type).toBe("terminated");
});
```

Never interleave assertions with setup, fold the act into the arrange line, or inline the act inside an assertion. The act must always be assigned to a variable first:

```typescript
// bad — act collapsed into assert (AAA violation)
expect(await terminateRunner(runner.id)).toBeDefined();

// good
const result = await terminateRunner(runner.id);
expect(result).toBeDefined();
```

If a test needs assertions in multiple places it is likely testing more than one thing — split it.

### Test isolation

- Each `describe` block generates a fresh `organizationId` (or other scope key) via `faker` in `beforeEach` so tests don't share data.
- `vi.restoreAllMocks()` is called automatically in `afterEach` — no need to do it manually.
- DB state is cleaned by truncating tables in `globalSetup`, not between individual tests, so avoid relying on an empty DB mid-suite.

### Mocking

Keep mocking minimal. Only mock what cannot run in the test environment (external HTTP APIs, GCP clients, feature flag SDKs):

```typescript
vi.mock("@shipfox/node-feature-flag", () => ({
  getStringFeatureFlag: vi.fn().mockResolvedValue("gcp"),
}));
```

### Testing Fastify routes

Create a fresh `fastify()` instance per `describe` block, register only the route under test, and use `.inject()`:

```typescript
describe("listRunners", () => {
  const app = fastify();
  beforeAll(() => {
    app.register(listRunnersRoute);
  });

  it("returns runners for an organization", async () => {
    const runner = await runnerFactory.create({ organizationId });

    const res = await app.inject({
      method: "GET",
      path: "/",
      query: { organizationId },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().runners).toHaveLength(1);
  });
});
```

### Parameterised tests

Use `describe.each` / `it.each` for exhaustive coverage over enum values or similar sets:

```typescript
describe.each(runnerEventTypeEnum.enumValues)('createRunnerEvent "%s"', (eventType) => {
  it('persists the event', async () => { ... });
});
```
