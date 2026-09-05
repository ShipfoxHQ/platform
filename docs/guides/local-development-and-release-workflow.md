# Local development and release workflow

This guide owns detailed local-tooling recovery, validation selection, and
package release procedures. It applies after a contributor has completed the
initial setup in [CONTRIBUTING.md](../../CONTRIBUTING.md).

Scripts and task descriptions change with the repository. Read
[mise.toml](../../mise.toml), [package.json](../../package.json), and
[turbo.jsonc](../../turbo.jsonc) for the executable source of truth.

## Choose a local workflow

| When you need to... | Use... |
| --- | --- |
| See available project tasks. | `mise tasks` |
| Run a Node, pnpm, or Turbo command from a non-interactive shell. | `mise exec -- <command>` |
| Run the normal checks for one package and its dependencies. | `mise exec -- turbo <task> --filter=@shipfox/<package>...` |
| Run all affected tasks before a broad change. | `mise exec -- turbo <task> --affected` |
| Start local services in a normal checkout. | `docker compose up -d` |
| Run browser end-to-end coverage. | The [E2E guide](../../e2e/README.md) |

Use the narrowest task that proves the change. A package change normally needs
its package checks, types, and tests. Run broader verification when a changed
contract, shared tool, or dependency can affect other packages.

## Mise and dependencies

`mise.toml` pins the repository toolchain. Run `mise install` after cloning or
when the tool versions change. Use `mise exec --` in scripts and automation so
the command uses the pinned tools.

Install workspace dependencies with:

```sh
mise exec -- pnpm install
```

Use `pnpm install --frozen-lockfile` when the committed lockfile must be
verified without updating it.

If you add, update, or exempt a dependency, read the
[dependency version policy](../policies/dependency-versions.md). It defines
catalog rules, exceptions, package families, and the required dependency
checks.

## Prepare an agent workspace

Agent workspaces use two stable repository entrypoints after the host installs
`mise`. [mise.toml](../../mise.toml) and
[dev/workspace-setup.sh](../../dev/workspace-setup.sh) own their executable
behavior.

| Need | Command | Result |
| --- | --- | --- |
| Build, run, or test the code. | `mise run --yes workspace:setup` | Installs pinned tools, frozen dependencies, repository context, the test browser, and profile-required services. |
| Run a read-only job, such as PR review. | `mise run --yes workspace:setup:context` | Installs pinned tools, frozen dependencies, and repository context. It starts no service or shared Ollama. |

The full command depends on the context command. Both commands are
non-interactive. A rerun normally reconciles the prepared state. The
[Shared Ollama](#shared-ollama) section documents the manual recovery exception.

Profile selection uses the first matching signal:

1. `SHIPFOX_SETUP_PROFILE` explicitly selects `conductor-local`,
   `conductor-cloud`, `workflow`, or `developer`.
2. `CONDUCTOR_IS_LOCAL=1` selects `conductor-local`.
   `CONDUCTOR_IS_LOCAL=0` selects `conductor-cloud`.
3. `SHIPFOX_WORKSPACE` selects `workflow`.
4. No matching signal selects `developer`.

Conductor supplies `CONDUCTOR_IS_LOCAL`. Workflow hosts supply
`SHIPFOX_WORKSPACE`. Use the explicit override only to emulate a supported
profile.

| Environment | Full setup behavior |
| --- | --- |
| Local Conductor workspace | Starts worktree services and the shared Shipfox Ollama service. |
| Conductor cloud workspace | Prepares dependencies and context without starting services. |
| Ephemeral workflow | Starts worktree services without starting shared Ollama. |
| Direct developer invocation | Starts worktree services and the shared Shipfox Ollama service. |

The host must provide `mise` 2026.5.18 or newer, matching the minimum in
`mise.toml`. Service-starting profiles also require Docker, Docker Compose, and
a running Docker daemon. Workflow host provisioning stays outside these
repository commands.

These commands execute branch-controlled mise tasks, setup scripts, and
dependency lifecycle scripts. Treat a checked-out review branch as executable
code. Run read-only PR jobs in an isolated sandbox without mounted credentials,
copied secrets, or access to trusted host state.

Setup does not copy secrets, certificates, or static ignored files. Use
Conductor Files to Copy, `.worktreeinclude`, or the existing environment
provisioning mechanism only for trusted, non-review workspaces.

Local profiles share one Ollama state directory under the repository root.
Avoid concurrent cold starts or stop operations until one setup reports the
shared service as healthy.

Service cleanup also stays outside setup. Conductor archive hooks run
`mise exec -- pnpm dev:services:destroy` for local workspaces. A workflow must
use a disposable host or run the same destroy command at the end of its job.
Persistent hosts can use the status and stop commands below before cleanup.

## Docker services and Conductor worktrees

A normal checkout uses the repository Docker Compose stack:

```sh
docker compose up -d
```

Conductor workspaces use isolated services. Workspace setup normally starts
them. If setup did not finish or the services need recovery, run:

```sh
mise exec -- pnpm dev:services:up
```

The command leases a worktree-specific 20-port block, starts PostgreSQL,
Temporal, Garage, and Gitea, and writes the app environment to
`.context/local-services/env`. Mise loads that file for later commands.

The repository-level port pool is configured with
`SHIPFOX_PORT_RANGE_START` and `SHIPFOX_PORT_RANGE_END` in `mise.toml`. This
checkout reserves `20000 to 24999`; another repository sharing the same machine
should reserve a different range. This checkout supports 250 worktree leases;
another repository can start at `25000`. All ranges still use 20-port blocks, and
the shared `~/.shipfox/shipfox-port-leases.json` registry rejects overlapping
allocations. Conductor leases use the stable workspace ID, scoped to this
repository; their recorded paths are refreshed when services start. Archive or
destroy a Conductor workspace to release its lease. Cleanup only reclaims
missing path-identified checkouts, because a missing historical Conductor path
may mean that the workspace was renamed.

| Need | Command |
| --- | --- |
| Inspect workspace services. | `mise exec -- pnpm dev:services:status` |
| Stop services but keep their data. | `mise exec -- pnpm dev:services:stop` |
| Remove services, volumes, generated state, and the port lease. | `mise exec -- pnpm dev:services:destroy` |
| List stale port leases. | `mise exec -- pnpm dev:services:cleanup` |
| Remove listed stale port leases. | `mise exec -- pnpm dev:services:cleanup -- --apply` |

`destroy` is destructive. It removes the worktree Docker volumes and generated
local-service state. It does not stop shared Ollama.

## Shared Ollama

Ollama is a shared service rooted at the main checkout. A Conductor workspace
delegates these tasks to `CONDUCTOR_ROOT_PATH`, so run the same commands from
the workspace or the root checkout.

| Need | Command |
| --- | --- |
| Start the server, pull the configured model, and warm it. | `mise run ollama:up` |
| Show endpoint, root, process, and health. | `mise run ollama:status` |
| Stop a server started by this repository. | `mise run ollama:stop` |

The default endpoint is `http://127.0.0.1:11434`. The default model and
keep-alive period come from `dev/shared-ollama.mjs`. Set
`SHIPFOX_OLLAMA_BASE_URL`, `SHIPFOX_OLLAMA_MODEL`, or
`SHIPFOX_OLLAMA_KEEP_ALIVE` only when the local environment requires an
override. Managed state and logs live under
`$CONDUCTOR_ROOT_PATH/.context/shared-ollama/`.

If `ollama:up` reports a live unverified process, stop that process manually
before running the task again. The task will reuse a healthy server and only
stops processes that it can verify as repository-managed.

## Publish packages with Changesets

Published packages live under `libs/` and `tools/`. Apps, end-to-end suites,
and the workspace root are private.

Add a Changeset for a non-trivial pull request that changes a published
package. Documentation-only, formatting-only, and comment-only changes do not
need one. Create it with:

```sh
pnpm exec changeset
```

Choose `patch` for fixes and internal refactors, `minor` for additive public
API, and `major` for breaking public API. Commit the `.changeset/*.md` file
with the change.

Write one concise present-tense summary for each logical change. Keep unrelated
release changes in separate Changesets.

`update-release-pr` runs on `main` and opens or updates the generated release
pull request only when unreleased changesets exist. Its cancelable concurrency
means a newer `main` push supersedes an older pending update; it has no npm
publication authority. `publish-packages` runs only after a merged,
deterministically verified `changeset-release/main` pull request, then checks
out that exact merge revision and publishes under a separate non-cancelable
concurrency group. Do not run `release:publish` as a normal contributor
workflow. It is the workflow command and requires its release environment.

If an npm operation is interrupted or only partly succeeds, use the
`publish-packages` **Run workflow** control with the exact merged release
revision. The publisher re-verifies the generated tree before retrying and its
closure publisher skips versions already present in npm; do not create a new
release PR merely to retry publication.

If a release or package-publishing incident needs tool-specific diagnosis, read
the relevant package documentation under `tools/` and the workflow definition
in [`.github/workflows/publish-packages.yml`](../../.github/workflows/publish-packages.yml).
