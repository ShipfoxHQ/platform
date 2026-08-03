# E2E Testing

This subtree owns Shipfox end-to-end tests and their shared authoring tools. Use
this guide to decide where a test belongs, how setup is allowed to work, and what
reviewers should enforce.

For repository-wide unit-test, Storybook, and visual-regression rules, read the
[testing guide](../docs/guides/testing.md). This README owns the E2E-specific
suite architecture, setup model, screens, drivers, and review constraints.

## Directory Map

E2E code has two axes: layer and suite level.

Layers flow downward only:

```text
suites -> kit / screens -> setup / observe / drivers -> core
```

What lives where:

| Directory | Package shape | Purpose |
| --- | --- | --- |
| `core/` | `@shipfox/e2e-core` | Transport, environment config, preflight checks, `pollUntil`, API clients, and the shared Playwright re-export. |
| `setup/` | `@shipfox/e2e-setup-<module>` | Data setup helpers backed by module-owned `/__e2e/<module>` HTTP routes. |
| `observe/` | `@shipfox/e2e-observe-<module>` | Public API pollers and readers used to wait for platform-visible state. |
| `drivers/` | `@shipfox/e2e-driver-<name>` | Sanctioned HTTP bypasses for external systems or local processes, such as Gitea and runner processes. |
| `kit/` | `@shipfox/e2e-kit` | Authoring ergonomics: config factories, shared setup, fixture presets, app-shell page objects, and stable screenshots. |
| `screens/` | `@shipfox/e2e-screens-<domain>` | Per-domain browser page objects, typed against Playwright but emitted without Playwright runtime imports. |
| `suites/` | `@shipfox/e2e-<level>-<surface>` | The actual Playwright specs. Suites consume the lower layers; they do not provide reusable helpers to other suites. |

Suite levels are independent from layers:

| Level | Use it for |
| --- | --- |
| `suites/client/*` | Browser tests that drive the UI or assert user-visible page state. |
| `suites/api/*` | HTTP-only tests that assert API contracts without a browser. |
| `suites/flow/*` | Full platform loops that need VCS push, webhook delivery, definition sync, Temporal, runner capacity, step execution, and logs. |

Driver-specific docs live with their drivers:

- [`drivers/gitea/README.md`](drivers/gitea/README.md) explains direct Gitea admin/API usage.
- [`drivers/runner-process/README.md`](drivers/runner-process/README.md) explains local runner and provisioner processes.
- [`suites/flow/workflows/README.md`](suites/flow/workflows/README.md) is the deep runbook for the workflow flow suite.

## Pick the Right Level

Use this decision tree before adding a spec:

1. Does the test need to drive a browser or assert user-visible UI?
   Put it in `suites/client/<surface>`.
2. Does it only need to assert an HTTP contract, validation result, auth behavior, or API response?
   Put it in `suites/api/<surface>`.
3. Does it need the full product loop: VCS push, org webhook, definition sync, trigger dispatch, Temporal orchestration, a runner, step execution, and log capture?
   Put it in `suites/flow/<surface>`.
4. Can the full-loop case be expressed as data?
   Prefer one scenario directory with `workflow.yml` plus `expect.yaml` or `reject.yaml`. Add a bespoke Playwright spec only when the case must orchestrate from outside the run, such as cancellation or listener behavior.

Do not use a browser test to prove a pure HTTP contract. Do not use a flow test
when a browser or API test proves the behavior at a lower cost.

## Setup Is HTTP-First

Tests create product data through module-owned setup routes:

```text
/__e2e/<module>
```

Each setup route is mounted only when `E2E_ENABLED=true` and
`E2E_ADMIN_API_KEY` is set. Test code reaches those routes through an
`@shipfox/e2e-setup-<module>` helper. Do not create E2E data through direct
database access.

Add a new setup helper only when the owning product module exposes the matching
`/__e2e/<module>` route. Keep route DTOs shared through the module's public DTO
package when the helper needs typed request or response contracts.

`drivers/*` is the only sanctioned bypass from product HTTP:

- `drivers/gitea` talks directly to the local Gitea instance because Gitea is the external system under integration.
- `drivers/runner-process` starts local runner/provisioner processes because runner capacity is process infrastructure, not product data.

A new driver is justified only for an external system, host process, or local
infrastructure boundary that cannot be represented as product HTTP setup. If the
helper creates app-owned rows, it belongs under `setup/`, not `drivers/`.

## Config And Fixtures

Suites use config factories from `@shipfox/e2e-kit/config`:

```ts
import {defineClientE2eConfig} from '@shipfox/e2e-kit/config';

export default defineClientE2eConfig({buildName: 'e2e-client-secrets'});
```

Use `defineClientE2eConfig` for browser suites and `defineApiE2eConfig` for
HTTP-only suites. Do not hand-roll a Playwright config unless the factory cannot
express a real suite requirement; prefer adding a typed option to the factory.

Client suites compose the kit fixture presets instead of re-declaring the common
fixture union:

```ts
import {workspaceFixtures, type WorkspaceFixtures} from '@shipfox/e2e-kit/fixtures';
import {type SecretsScreenFixtures, secretsScreens} from '@shipfox/e2e-screens-secrets';

export const test = base.extend<WorkspaceFixtures & SecretsScreenFixtures>({
  ...workspaceFixtures,
  ...secretsScreens,
});
```

Use `createReadyWorkspace` from `@shipfox/e2e-kit/fixtures` for the standard
user, workspace, and project arrangement. Specs should add only the
domain-specific fixtures and setup their behavior needs.

## Screens And App Shell

Screens are browser page objects. Each browser domain gets one
`@shipfox/e2e-screens-<domain>` package under `screens/<domain>`.

A screens package exports:

- a screen class, such as `SecretsSettingsScreen`;
- a `Fixtures` type, such as `SecretsScreenFixtures`;
- a fixture object, such as `secretsScreens`.

Screens are type-only against Playwright:

```ts
import type {Locator, Page} from '@shipfox/playwright';
```

The emitted JavaScript must not import Playwright. Screens may use `kit/ui`
primitives, `e2e-core`, and relevant DTO types. They do not import suites, other
screen packages, or runtime `@shipfox/client-*` packages.

Cross-cutting shell UI lives in `@shipfox/e2e-kit/ui`: top navigation,
workspace switcher, settings shell, dialogs, toasts, table rows, and
`stableScreenshot`. A domain screen owns product-domain navigation and actions.
For example, workspace switching shell behavior belongs in `kit/ui`; the
workspaces suite's route-specific settings and invitation screens belong in
`e2e-screens-workspaces`.

Specs should not contain raw locators for product UI. Put locators, waits,
navigation, and visual normalization behind named screen or kit UI methods so
the spec body reads as user intent.

## Granularity

One test proves one behavior:

- Keep Arrange, Act, and Assert visually separated.
- Keep tests independent and order-free.
- Assert the user-visible outcome that names the behavior.
- Use `test.step(...)` for a genuine multi-stage journey instead of splitting a journey into order-dependent tests.

One file covers one surface or one journey:

- Name files `<surface>.e2e.ts` or `<surface>-<aspect>.e2e.ts`.
- Use `test.describe('<surface or state>')` to group related behavior.
- Name tests in present tense.
- Keep setup, locators, navigation, visual normalization, and workflow templates out of spec files.
- Split by concern when a file grows beyond roughly 8 tests or roughly 150 lines of intent.

There is no line-count lint. Granularity is review-enforced because a useful
split depends on the surface, journey, and fixture shape.

Flow suites keep the same rule through data-driven scenarios: one scenario
directory is one behavior. Use `workflow.yml` plus `expect.yaml` or `reject.yaml`
by default.

## Dependencies And Enforcement

Every suite declares what it verifies so Turbo reruns the suite when the verified
surface changes.

Client suites declare:

- the runtime client packages they verify, such as `@shipfox/client-auth`;
- their screen package, such as `@shipfox/e2e-screens-auth`;
- relevant DTO packages for types and public contracts;
- `@shipfox/e2e-kit`, `@shipfox/e2e-core`, `@shipfox/playwright`;
- the `@shipfox/e2e-setup-*`, `@shipfox/e2e-observe-*`, and `@shipfox/e2e-driver-*` packages they use.

API suites declare:

- the API DTO package whose contract they verify;
- `@shipfox/e2e-kit` when using API config/setup;
- `@shipfox/e2e-core`, `@shipfox/playwright`;
- the setup or observe packages they use.

Flow suites declare:

- every API DTO package whose public response or payload they assert;
- every setup, observe, and driver package used by the scenario engine;
- `@shipfox/e2e-core`, `@shipfox/e2e-kit` when needed, and `@shipfox/playwright`;
- only the runtime app packages needed for the full loop.

E2E code depends on API DTO packages, never server API implementation packages.
Use `@shipfox/api-<module>-dto`, not `@shipfox/api-<module>`.

Dependency Cruiser enforces the structural rules:

- E2E code cannot import non-DTO `@shipfox/api-*` packages.
- Dependencies flow down the layer stack only.
- Suites cannot import other suites.
- Screens are leaf page-object packages.
- Screens may import Playwright only as type-only imports.

The root CI static verification job runs:

```sh
turbo check type build depcruise --concurrency="$SHIPFOX_TURBO_CONCURRENCY"
```

Each E2E package has its own `depcruise` task, so these rules run in the same
Turbo and CI gate as the rest of the repo.

## Visual Regression

Client E2E suites can add Argos page snapshots at user-visible checkpoints.
Prefer `stableScreenshot` from `@shipfox/e2e-kit/ui` when the page contains
dynamic text, generated IDs, volatile attributes, or toasts that need
normalization. It wraps `argosScreenshot` and restores the DOM after capture.

Capture after assertions prove the page reached the expected state:

```ts
await expect(page.getByRole('heading', {name: 'No projects yet'})).toBeVisible();
await stableScreenshot(page, 'projects/empty-state');
```

`stableScreenshot` and `argosScreenshot` wait for fonts and stable layout, but
they cannot wait for content the test has not asserted. Keep visible generated
data deterministic or normalize it before capture so Argos reports UI drift, not
random IDs or names.

Name snapshots `<surface>/<state>`, such as `auth/login` or
`projects/empty-state`. Add a snapshot to the existing test that already drives
the page to that state; do not write screenshot-only specs.

Each E2E client package sets its Argos `buildName` through
`defineClientE2eConfig`. The value must match the package name without the
`@shipfox/` scope, such as `@shipfox/e2e-client-auth` ->
`e2e-client-auth`, so each surface gets its own PR check and baseline.

## Running And Debugging

Run a suite through the repo E2E harness when it needs the API/client dev servers:

```sh
docker compose up -d
mise run e2e -- --filter=@shipfox/e2e-client-auth
```

In a Conductor worktree, local services are normally started by workspace setup.
The equivalent service command is:

```sh
pnpm dev:services:up
```

If the API and client are already running, run the package directly:

```sh
turbo test:e2e --filter=@shipfox/e2e-client-auth
```

Run pure helper or evaluator tests with `turbo test`:

```sh
turbo test --filter=@shipfox/e2e-flow-workflows
```

The harness reads Conductor worktree ports from `.context/local-services/env`,
starts the API with E2E routes enabled, starts the client with the test VCS
provider enabled, waits for both to become ready, and then runs
`turbo test:e2e`.

Diagnostics land in `.context/shipfox-e2e-logs/` locally. In CI, failed E2E runs
upload the same logs as the `e2e-diagnostics` artifact. Runner logs from the Flow workflow
are written under `e2e/suites/flow/workflows/.e2e-run/runners/` and attached to
failed scenario results.

For workflow flow details, including `expect.yaml`, `reject.yaml`, scenario
files, and runner logs, use
[`suites/flow/workflows/README.md`](suites/flow/workflows/README.md).

## Review Checklist

For PRs that add or change E2E coverage, check:

- The test is at the lowest level that proves the behavior: `client`, `api`, or `flow`.
- Data setup goes through `/__e2e/<module>` via `@shipfox/e2e-setup-*`; only true external/process boundaries use `drivers/*`.
- Browser specs use screen or kit UI methods instead of raw product locators.
- Specs follow the granularity rule: one test per behavior, one file per surface or journey, present-tense names, and setup outside the spec body.
- Visual snapshots come after assertions, use the package-name `buildName`, and live in behavior specs rather than screenshot-only specs.
- Package dependencies declare the verified surface and use DTO packages instead of server API implementation packages.
- `depcruise` remains green when layer or dependency boundaries change.
