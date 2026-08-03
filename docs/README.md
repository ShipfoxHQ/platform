# Engineering documentation

This is the map for Shipfox engineering knowledge. It helps contributors and
agents find the source that owns a topic. It does not repeat that source.

Start with [CONTRIBUTING.md](../CONTRIBUTING.md) for a human contribution or
[AGENTS.md](../AGENTS.md) for an agent task. Use this map when the task is not
listed there or when you need to place, update, or review documentation.

For the durable product record that product and design work preserve (its users,
purpose, positioning, and principles), see [PRODUCT.md](../PRODUCT.md). This map
names it and links to it; it does not restate it.

## Find context by task

| Read when the task... | Canonical source | It owns |
| --- | --- | --- |
| Needs the product overview or a starting point outside engineering work. | [Root README](../README.md) | Product orientation and repository navigation. |
| Starts a human contribution or needs branch, commit, or pull-request guidance. | [Contributing guide](../CONTRIBUTING.md) | Prerequisites, initial setup, contribution workflow, review standards, and essential validation. |
| Needs local tasks, service recovery, shared Ollama, or affected-package checks. | [Local development and release workflow](guides/local-development-and-release-workflow.md) | Mise, local services, Ollama, and affected-package checks. |
| Changes a published package or prepares a release. | [Changesets and publishing workflow](guides/local-development-and-release-workflow.md#publish-packages-with-changesets) | Changeset rules, version bumps, summaries, and publishing. |
| Needs the generated release-PR CI verification path. | [Generated release PR CI](guides/release-pr-ci.md) | The fast-path conditions and fail-closed verification behavior for Changesets release PRs. |
| Needs to configure or review Vercel release-PR previews. | [Vercel release PR previews](vercel-preview-release-prs.md) | The repository-owned Vercel branch configuration and verification workflow. |
| Operates Cloudflare Pages previews or recovers a deployment. | [Cloudflare Pages lifecycle](guides/cloudflare-pages-lifecycle.md) | Config-driven publication, environment deploys, retention ownership, and rollback steps. |
| Changes agent behavior or needs agent execution instructions. | [Agent instructions](../AGENTS.md) | Repository-specific agent execution, change hygiene, and conditional context loading. |
| Adds, updates, or exempts a dependency. | [Dependency version policy](policies/dependency-versions.md) | Version ranges, exceptions, coordinated package families, and dependency checks. |
| Changes a cross-package client composition seam. | [ADR 0001](adr/0001-client-composition-contract.md) | The public client composition contract and its decision rationale. |
| Changes client URL identifiers, route prefixes, or slug and UUID boundaries. | [ADR 0009](adr/0009-client-urls-resource-identity.md) | Client URL prefixes, resource identity, settings scopes, and run-number display semantics. |
| Changes server module boundaries or an inter-module call. | [ADR 0002](adr/0002-api-inter-module-architecture.md) | Producer-owned inter-module contracts and bounded-context crossings. |
| Changes database ownership, cross-module persistence access, or namespace rules. | [ADR 0006](adr/0006-database-ownership-boundaries.md) | The decision and tradeoffs behind owner-only database access. |
| Adds or changes a backend module, DTO, outbox event, HTTP boundary, or server package dependency. | [Backend architecture](architecture/backend-architecture.md) | The current backend module model and package-boundary rules. |
| Maps workflow job-admission paths or changes the workspace suspension gate. | [Job-admission paths](architecture/job-admission-paths.md) | The current admission inventory, owner boundaries, and Workspace operating-state contract. |
| Adds or changes a table, migration, database query, foreign key, or transaction. | [Database boundary policy](policies/database-boundaries.md) | Database ownership, access, naming, migration, and enforcement rules. |
| Adds or changes an environment variable, validator, or environment description. | [Configuration policy](policies/configuration.md) | Repository-wide configuration ownership, validation, and description rules. |
| Adds a domain or provider error, translates a request failure, or reports an unexpected failure. | [Error handling](architecture/error-handling.md) | The current backend error model, client translation, and reporting boundaries. |
| Adds a metric or changes instrumentation startup, naming, units, or labels. | [Observability](architecture/observability.md) | The current backend metrics model and cardinality constraints. |
| Changes client state, API adapters, or feature boundaries. | [Client architecture](architecture/client-architecture.md) | The current client model and architecture checks. |
| Adds or changes a client form. | [Client form guidance](architecture/client-architecture.md#forms) | Form state, validation, fields, server errors, and saved drafts. |
| Introduces a shared package or changes a server dependency boundary. | [ADR 0004](adr/0004-shared-semantic-packages-and-server-dependency-boundaries.md) | Shared semantic package rules and server package classes. |
| Adds, moves, or debugs an architecture validation rule. | [Architecture validation guide](guides/architecture-validation.md) | Tool selection, rule placement, fixtures, exceptions, and local verification. |
| Changes how architecture policy is shared with another repository. | [ADR 0007](adr/0007-cross-repository-architecture-validation.md) | Shared policy distribution, package metadata, versioning, and repository ownership. |
| Adds or changes an administration route, instance-administrator role, administrator audit event, or suspension behavior. | [ADR 0008](adr/0008-administration-controls.md) | Fixed roles, Auth authorization ownership, module-owned administration behavior, audit semantics, and suspension rules. |
| Changes repository documentation structure or adds a shared documentation surface. | [ADR 0005](adr/0005-repository-documentation-architecture.md) | Documentation ownership, routing, and progressive disclosure. |
| Validates repository Markdown links, anchors, or documentation reachability. | [Repository documentation policy](../tools/repository-documentation-policy/README.md) | Deterministic link and orphan checks for engineering documentation. |
| Builds or consumes the published engineering guidance bundle. | [Engineering guidance package](../tools/engineering-guidance/README.md) | The public manifest, locator contract, and deterministic bundle workflow. |
| Changes webhook retry behavior. | [Webhook retry safety](architecture/webhook-retry-safety.md) | The current safety model for webhook retries. |
| Adds or changes unit tests or Storybook stories. | [Testing guide](guides/testing.md) | Unit-test levels and Storybook rules. |
| Adds or changes a visual test. | [Visual regression guidance](guides/testing.md#visual-regression) | Argos builds, screenshots, and review. |
| Adds or changes end-to-end coverage. | [E2E guide](../e2e/README.md) | Suite levels, HTTP-first setup, screens, and E2E package boundaries. |
| Mints, verifies, or carries an authentication token. | [Auth security model](../libs/api/auth/README.md#security-model) | Token authority, lifetime, trust boundaries, and logging constraints. |
| Defines an inter-module contract or transport. | [Inter-module package README](../libs/shared/common/inter-module/README.md) | Contract primitives and transport responsibilities. |
| Needs a package-local API, configuration, fixture, or operational constraint. | [Package README standard](../WRITING.md#package-readmes) | How to find and shape the owning package README; the README beside the package owns the local detail. |
| Creates or changes a visual or interaction decision. | [Design system](../DESIGN.md) | Shared tokens, components, accessibility, motion, status taxonomy, patterns, and review anti-patterns. Code owns exact token and component values. |
| Writes engineering prose or a runbook. | [Writing guide](../WRITING.md) | Repository prose, style, punctuation, and readability. |
| Adds or changes a prose rule. | [ADR 0010](adr/0010-prose-standard-and-enforcement.md) | The rationale, rule sources, enforcement model, and accepted divergences behind the prose standard. |
| Creates or updates a package README. | [Package README standard](../WRITING.md#package-readmes) | Required sections, public API, local checks, and license. |
| Writes or reviews code comments, module exports, or non-trivial control flow. | [Code style policy](policies/code-style.md) | Shared code-comment, import and export, and control-flow rules. |
| Writes product or self-hosting documentation. | [Docs writing guide](../apps/docs/WRITING.md) | Product documentation page types, templates, and local terminology. |

## Documentation contract

Each fact has one canonical owner. Other documents may name the fact and link
to its owner. They do not become a second handbook.

Put a task trigger before every conditional context link. State what the link
owns in the same sentence or table row. A reader can then decide whether to
open the target before loading unrelated detail.

Use the narrowest owner that fits the knowledge. A package or subsystem keeps
its local rules even when the map links to them. Do not move local knowledge to
the repository root only to improve discovery.

Executable sources own values and contracts that code can expose or generate.
Examples include scripts, manifests, schemas, defaults, and accepted values.
Authored documentation explains how to use those facts and why they matter.

## Place new knowledge

| Add this kind of knowledge... | Place it in... | That location owns... |
| --- | --- | --- |
| Product orientation. | [Root README](../README.md) | Product introduction and repository navigation. |
| Human setup or contribution workflow. | [Contributing guide](../CONTRIBUTING.md) | Contributor onboarding and normal change workflow. |
| Agent-only execution behavior. | [Agent instructions](../AGENTS.md) or a justified nested `AGENTS.md`. | Agent instructions that do not apply to human contributors. |
| Current cross-package system design. | `docs/architecture/`. | How a system works now. |
| A durable architectural choice and its tradeoffs. | `docs/adr/`. | Decision context, alternatives, and consequences. |
| A repository-wide rule. | `docs/policies/`. | Rules that changes must satisfy. |
| A repository-wide procedure. | `docs/guides/`. | A cross-cutting task and its verification. |
| Details shared by one subsystem. | Its nearest common README. | Subsystem structure and rules. |
| One package's purpose, configuration, or constraints. | Its package README. | Package-specific use and local constraints. |
| End-user or self-hosting information. | `apps/docs/content/`. | Product documentation for its readers. |
| Fast-changing, machine-checkable facts. | Code, a schema, a manifest, or generated reference. | Executable contracts and values. |

Repository engineering documentation and product documentation serve different
readers. Product pages under `apps/docs/content/` follow the docs-app page
types. They do not replace repository policies, architecture, or contributor
guidance.

## Source types

| Source type | Purpose | Use it instead of |
| --- | --- | --- |
| Architecture document | Describe how a cross-cutting system works today. | A historical decision record. |
| ADR | Record a durable decision, its alternatives, and its consequences. | A complete current operating guide. |
| Policy | State a repository-wide rule that a change must meet. | A tutorial or runbook. |
| Guide | Explain a cross-cutting procedure and how to verify it. | Stable reference facts. |
| Subsystem README | Keep knowledge shared by a code subtree close to that subtree. | Repository-wide policy. |
| Package README | Explain one package's purpose, public use, configuration, and constraints. | Unrelated system rules. |
| Product documentation | Help product users and self-hosters use Shipfox. | Contributor or internal engineering guidance. |
| Executable source | Define code-backed values and machine-checkable contracts. | Rationale that code cannot express. |

## ADRs

[The ADR index](adr/README.md) lists every repository-wide decision and its
status. Read an ADR when your change touches its decision boundary. A later ADR
supersedes an earlier one explicitly. Do not rewrite a historical decision to
describe a newer design.

## Maintain this map

Update this map when a canonical source is added, moved, retired, or changes
scope. Keep entries short: state the trigger, link to the owner, and name what
it owns. Do not create empty category directories or placeholder pages only to
fill a table.

If a new documentation surface would create a second shared handbook or split
shared engineering rules between humans and agents, update or supersede
[ADR 0005](adr/0005-repository-documentation-architecture.md) first.
