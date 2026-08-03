# Agent guidelines

`CLAUDE.md` is a compatibility alias for this file.

## Execution baseline

- Use mise-managed tools. Prefix non-interactive commands with `mise exec --`.
- Inspect the relevant files and local instructions before editing. Preserve
  unrelated user changes.
- Keep changes focused on the requested task. Do not change generated output,
  dependencies, versions, or release metadata unless the task requires it.
- Validate the changed package and its dependents before widening validation:

  ```sh
  turbo <task> --filter=@shipfox/<package>...
  ```

- Report the files changed, validation run, and any skipped checks or remaining
  risks.

## Read before editing

Read the linked source before making the matching change. For a task not listed
here, use the full [engineering documentation map](docs/README.md).

| Before editing when the task... | Read | It owns |
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
| Adds or changes a prose rule. | [ADR 0010](docs/adr/0010-prose-standard-and-enforcement.md) | The rationale, rule sources, enforcement model, and accepted divergences behind the prose standard. |
| Creates or updates a package README. | [Package README standard](WRITING.md#package-readmes) | Required sections, public API, local checks, and license. |
| Writes product or self-hosting documentation. | [Docs writing guide](apps/docs/WRITING.md) | Product-documentation page types, templates, and terminology. |
| Writes or reviews code comments, module exports, or non-trivial control flow. | [Code style policy](docs/policies/code-style.md) | Shared code-comment, import and export, and control-flow rules. |
| Adds, moves, or debugs an architecture validation rule. | [Architecture validation guide](docs/guides/architecture-validation.md) | Tool selection, rule placement, cross-repository policy, fixtures, and verification. |
| Changes a cross-package client composition seam, server module boundary, or shared server-package boundary. | [Engineering documentation map](docs/README.md) | The applicable ADR and its decision boundary. |
| Changes repository documentation structure or adds a shared documentation surface. | [ADR 0005](docs/adr/0005-repository-documentation-architecture.md) | Documentation ownership, routing, and progressive disclosure. |
