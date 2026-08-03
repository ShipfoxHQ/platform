# Contributing

This project and everyone participating in it are governed by the
[Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to
uphold it.

## Prerequisites

- [mise](https://mise.jdx.dev/) manages the pinned Node.js, pnpm, Turbo, and
  Ollama versions.
- [Docker](https://docs.docker.com/get-docker/) runs local service dependencies.

## Get started

Install the pinned tools and workspace dependencies:

```sh
mise install
mise exec -- pnpm install
```

Start local dependencies and build the repository:

```sh
docker compose up -d
mise exec -- turbo build
```

Use `mise exec --` for shell scripts and automation. Run `mise tasks` to find
repository tasks.

## Normal contribution loop

Make a focused change, then run the smallest validation that proves it. Start
with the changed package and its dependents:

```sh
mise exec -- turbo <task> --filter=@shipfox/<package>...
```

Before opening a pull request, run the validation required by the changed
surface and make sure the change is scoped to the contribution. The
[local development and release workflow](docs/guides/local-development-and-release-workflow.md)
owns task selection, affected-package validation, local-service recovery,
Conductor and Ollama recovery, Changesets, and package release procedures.

## Prepare a change for review

Use a focused feature branch. Do not commit or push directly to `main`. Name
the branch after the change. Include the lowercase issue key from Linear when the
work has one.

Keep each commit independently reviewable. Use an imperative subject of about
70 characters or fewer. Do not end it with a period or add a co-author trailer.
Add a body when readers need the motivation or the previous behavior. Add a
footer such as `Refs ENG-123` when the commit needs an issue reference.

Write a pull request title that explains the change at a business level. Prefix
it with the package name in square brackets when one package owns the change.
In the description, explain the change and its motivation. Include alternatives
or review concerns when they matter. Do not add a test-plan checklist or repeat
the diff.

When a pull request completes its Linear issue, use `Closes`, `Fixes`, or
`Resolves` with the issue key. Use `Refs`, `Part of`, or `Related to` only when
the work is partial. Keep each pull request focused on one feature or fix.

## Find the context for your task

Read the linked source before making the matching change. For a task not listed
here, use the full [engineering documentation map](docs/README.md).

| When your task... | Read | It owns |
| --- | --- | --- |
| Needs local tasks, service recovery, shared Ollama, or affected-package checks. | [Local development and release workflow](docs/guides/local-development-and-release-workflow.md) | Shared local-development and validation steps. |
| Changes a published package or prepares a release. | [Changesets and publishing workflow](docs/guides/local-development-and-release-workflow.md#publish-packages-with-changesets) | Changeset rules, version bumps, summaries, and publishing. |
| Adds, updates, or exempts a dependency. | [Dependency version policy](docs/policies/dependency-versions.md) | Version rules, exceptions, package families, and dependency checks. |
| Adds or changes a backend module, DTO, outbox event, HTTP boundary, or server package dependency. | [Backend architecture](docs/architecture/backend-architecture.md) | The current backend module model and package-boundary rules. |
| Adds or changes a table, migration, database query, foreign key, or transaction. | [Database boundary policy](docs/policies/database-boundaries.md) | Database ownership, access, naming, migration, and enforcement rules. Run `mise exec -- pnpm check:api-database-boundaries` locally. |
| Changes client state, API adapters, or feature boundaries. | [Client architecture](docs/architecture/client-architecture.md) | The current client model and architecture checks. |
| Adds or changes a client form. | [Client form guidance](docs/architecture/client-architecture.md#forms) | Form state, validation, fields, server errors, and saved drafts. |
| Adds or changes an environment variable, validator, or environment description. | [Configuration policy](docs/policies/configuration.md) | Configuration ownership, validation, and description rules. |
| Adds a domain or provider error, translates a request failure, or reports an unexpected failure. | [Error handling](docs/architecture/error-handling.md) | The error model, client translation, and reporting boundaries. |
| Adds a metric or changes instrumentation startup, naming, units, or labels. | [Observability](docs/architecture/observability.md) | The metrics model and cardinality constraints. |
| Mints, verifies, or carries an authentication token. | [Auth security model](libs/api/auth/README.md#security-model) | Token authority, lifetime, trust boundaries, and logging constraints. |
| Adds or changes unit tests or Storybook stories. | [Testing guide](docs/guides/testing.md) | Test levels and Storybook rules. |
| Adds or changes a visual test. | [Visual regression guidance](docs/guides/testing.md#visual-regression) | Argos builds, screenshots, and review. |
| Adds or changes end-to-end coverage. | [E2E guide](e2e/README.md) | E2E suite structure, setup, screens, and package boundaries. |
| Creates or changes a visual or interaction decision. | [Design system](DESIGN.md) | Shared design guidance; code owns exact token and component values. |
| Writes engineering prose or a runbook. | [Writing guide](WRITING.md) | Repository prose, style, punctuation, and readability. |
| Creates or updates a package README. | [Package README standard](WRITING.md#package-readmes) | Required sections, public API, local checks, and license. |
| Writes product or self-hosting documentation. | [Docs writing guide](apps/docs/WRITING.md) | Product-documentation page types, templates, and terminology. |
| Writes or reviews code comments, module exports, or non-trivial control flow. | [Code style policy](docs/policies/code-style.md) | Shared code-comment, import and export, and control-flow rules. |
| Adds, moves, or debugs an architecture validation rule. | [Architecture validation guide](docs/guides/architecture-validation.md) | Tool selection, rule placement, cross-repository policy, fixtures, and verification. |
| Changes a cross-package client composition seam, server module boundary, or shared server-package boundary. | [Engineering documentation map](docs/README.md) | The applicable ADR and its decision boundary. |
| Changes repository documentation structure or adds a shared documentation surface. | [ADR 0005](docs/adr/0005-repository-documentation-architecture.md) | Documentation ownership, routing, and progressive disclosure. |
