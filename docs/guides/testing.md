# Testing guide

This guide owns repository-wide unit-test, Storybook, and visual-regression authoring rules. Read it when adding or changing unit tests, Storybook stories, or Argos coverage. For E2E suite architecture, setup, screen, driver, and workflow-flow rules, read the [E2E guide](../../e2e/README.md) instead.

## Choose the lowest test level

Use the cheapest environment that proves the behavior:

| Need to prove | Test level | Canonical rules |
| --- | --- | --- |
| A pure client decision, such as parsing, mapping, formatting, cache-key generation, or request shaping. | Vitest `node` test. | [Client unit tests](#client-unit-tests) |
| Rendered React behavior, such as provider wiring, hook behavior, focus, portals, menus, or StrictMode idempotency. | Vitest `jsdom` test with React Testing Library. | [Client unit tests](#client-unit-tests) |
| A Node domain, persistence, route, or module behavior. | Vitest against the package's real test infrastructure. | [Node unit tests](#node-unit-tests) |
| A public HTTP contract, browser journey, or full platform loop. | API, client, or flow E2E suite. | [E2E guide](../../e2e/README.md) |
| A component's visual states. | Storybook story captured by the package's `storybook` Vitest project. | [Storybook](#storybook) |
| A user-visible page state. | Screenshot in the behavior E2E spec that already reaches the state. | [E2E visual regression](../../e2e/README.md#visual-regression) |

Do not reproduce an API contract in a browser test or a browser journey in a unit test. Keep a test at the lowest altitude that proves its behavior.

## Client unit tests

Put pure behavior in plain TypeScript helpers and test it in Vitest's `node` environment. React Testing Library is for behavior that needs rendered React state. Full user journeys belong in Playwright E2E, not a page test assembled from a memory router, auth provider, query client, API mocks, and toast container.

Avoid real timer sleeps. Use immediate promises, fake timers, or controlled promises. Use `fireEvent.change` for simple final-value form setup and `userEvent.type` when keyboard interaction itself is under test.

Packages that have both pure and DOM tests split Vitest projects: `*.test.ts` normally runs in `node`, while `*.test.tsx` and browser-storage tests run in `jsdom` with the package's `test/setup.ts`. Use [`@shipfox/client-test-setup`](../../libs/client/test-setup/README.md) from a DOM project's setup file when its shared cleanup and API-client reset apply.

Render at the lowest altitude that proves the behavior:

| Tier | Use it for | How |
| --- | --- | --- |
| `node` | Pure filtering, formatting, URL/search-parameter shaping, and status mapping. | Extract a helper and use a `*.test.ts` file without DOM. |
| `render()` | A presentational component with prop-driven data and no router-aware child. | Render it without providers. |
| Router-only render helper | A component that needs router context but does not fetch. | Use a package-local memory-router helper without a query client or API client. |
| Page harness | A page or component that genuinely fetches and navigates. | Use the package's `test/pages.tsx` harness. |

Page harnesses are intentionally expensive. Keep only a small number of harness-based smoke tests and move branch-heavy assertions to a lower tier. When a package guards page-harness importers, update its allowlist only after review confirms that page wiring is required.

## Node unit tests

Node packages use Vitest and real PostgreSQL where persistence behavior is under test. Start the local services before a package suite that needs them. The package owns its concrete database name, environment values, and factories; follow its `test/` directory and README for those local details.

Use this test layout where the package owns database-backed behavior:

```text
test/
  globalSetup.ts   Truncates module-owned tables once before the suite.
  setup.ts         Opens and closes the database per file; restores mocks after each test.
  env.ts           Supplies test-only environment values.
  index.ts         Re-exports factories.
  factories/       One Fishery factory per entity.
```

Factories use Fishery. Call `build()` for in-memory unit tests and `create()` when the behavior queries the database. Give each test a fresh organization, workspace, project, or equivalent scope key. Do not truncate tables from an individual test; global setup may truncate only tables owned by its module.

Write tests in Arrange, Act, Assert order, with a blank line between phases. Assign the act result before asserting it. If a test needs several independent assertion phases, split it by behavior.

Mock only boundaries that cannot run in the test environment, such as external HTTP APIs, cloud clients, or feature-flag SDKs. Do not mock the database or internal module behavior merely for convenience.

For a Fastify route, create a fresh `fastify()` instance per `describe` block, register only the route under test, and exercise it with `.inject()`. Use `describe.each` or `it.each` for exhaustive enum-like cases.

## Storybook

Stories are visual coverage, not a second test suite. Order each story file for exploration first, broad visual coverage second, composition third, and interaction tests last:

1. Start with `Playground` when the component has a basic interactive example. It shows the neutral default and exposes meaningful controls. Rename an old `Default` story when it serves that role.
2. Group variant axes into a small number of matrix stories, such as `Variants`, `Sizes`, `States`, `Content`, `Errors`, or `DataStates`. Do not create one screenshot-producing story for each enum value.
3. Put composition stories after matrices. Name them `Compositions` or a focused scenario name, grouping related complex states when that keeps Argos coverage clear.
4. Put pure test stories last. Use `play` for assertions or interactions, not visual states that args or fixtures can render directly. Prefix test-only exports with `Test` or give them a `Tests / ...` display name.

## Visual regression

Argos runs one named build per source package. A package name without the `@shipfox/` scope is its build name. Storybook captures run in the standard cached `turbo test` task; do not create a separate `test:visual` task. E2E page capture follows the E2E guide.

`@shipfox/react-ui` is the theming source of truth, so its stories capture in light and dark. Feature `client-*` packages capture the product's primary dark theme only unless they render theme-specific markup that `react-ui` does not already prove. A source surface that has both Storybook and E2E coverage keeps two standalone Argos builds. Do not combine them through parallel or sharded builds.

Existing Storybook build names are `react-ui`, `client-agent`, `client-auth`, `client-integrations`, `client-logs`, `client-onboarding`, `client-projects`, `client-runners`, `client-secrets`, `client-triggers`, and `client-workflows`. Existing client E2E build names are `e2e-client-agent`, `e2e-client-auth`, `e2e-client-integrations`, `e2e-client-runners`, `e2e-client-secrets`, and `e2e-client-workspaces`. The package Vitest and Playwright configuration files are the executable source of truth for this inventory.

Add a component snapshot by adding a story. To add a page snapshot, add an `argosScreenshot` or `stableScreenshot` call to the existing behavior spec after assertions prove the state. Name it `<surface>/<state>` and keep visible data deterministic. `stableScreenshot` normalizes volatile UI, but neither helper can wait for content the test has not asserted.

On a non-trivial visual change, review each Argos check. Accept intentional drift and reject regressions. An accepted build updates its baseline when the PR merges to `main`.

`ARGOS_TOKEN` and `CI` pass through Turbo via `globalPassThroughEnv` in [`turbo.jsonc`](../../turbo.jsonc). Add any new visual-flow environment variable there so Turbo passes it to the Storybook plugin or Playwright reporter.

## Enforcement and local verification

Vitest configuration, package scripts, test setup, and factory code are the executable source of truth. Run the affected package's focused test task first, then the relevant repository check. Common commands are:

```sh
turbo test --filter=@shipfox/<package>
turbo test:e2e --filter=@shipfox/e2e-<level>-<surface>
turbo check type build depcruise
```

For E2E environment setup, harness use, diagnostics, and the workflow-flow runbook, follow the [E2E guide](../../e2e/README.md) and its linked suite README rather than duplicating those mechanics here.
