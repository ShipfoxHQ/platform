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
