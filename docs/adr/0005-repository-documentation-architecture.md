# Architecture decision record 0005: Repository documentation architecture

- **Status:** Accepted.
- **Date:** 2026-07-22.
- **Decision owners:** Repository documentation.

## Context

**Humans and coding agents enter the repository through different files.** Human contributors start
with `CONTRIBUTING.md`. Coding agents start with `AGENTS.md`. Both audiences need the same
architecture, policy, testing, and package context after that first step.

**The entrypoints have grown into parallel handbooks.** `AGENTS.md` repeats setup, testing,
architecture, security, and visual regression guidance from `CONTRIBUTING.md` and local READMEs. It
also tells agents to read the entire `CONTRIBUTING.md`. A task in one area therefore loads unrelated
context, while a rule copied into several files can drift.

**The repository already has useful local documentation.** Architecture decision records (ADRs),
repository policies, subsystem READMEs, package READMEs, `DESIGN.md`, and writing guides each own
valuable context. The missing part is a shared map that explains when to read them and which source
is canonical.

**Readers must decide whether a document is relevant before they load it.** A scope statement inside
the destination helps a reader who arrives directly, but it comes too late for progressive
disclosure. The source that links to deeper context must state the condition that makes the link
relevant.

**Shared rules must be available to both audiences.** An agent skill or `AGENTS.md` can own
agent-specific execution behavior. It cannot be the only source for architecture, coding, testing,
or documentation rules that human contributors must follow.

**Product documentation has a separate reader and structure.** Pages under `apps/docs/content/`
follow the product documentation rules in `apps/docs/WRITING.md`, including its page types and
templates. Repository engineering documentation needs a structure based on authority, scope, and
code ownership. It does not replace the product documentation system.

## Decision

**Shipfox uses routed, progressively disclosed repository documentation.** Thin audience-specific
entrypoints route readers to shared canonical documents. Cross-cutting knowledge lives in the
repository documentation tree. Narrow knowledge stays beside the subsystem or package that owns it.

**`docs/README.md` is the living engineering documentation map.** It defines the current
documentation contract, indexes canonical sources by task, explains the document types, and tells
authors where new information belongs. It is the fallback discovery surface, not a mandatory hop
for every task.

**Common tasks link directly to their canonical context.** `AGENTS.md` and `CONTRIBUTING.md` link
straight to the relevant policy, guide, subsystem README, or package README. They also link to
`docs/README.md` for topics that their short task maps do not list.

**One fact has one canonical owner.** Other documents can repeat a title, link, or short routing
summary. They do not copy procedures, configuration tables, architectural rationale, or detailed
rules. A repeated summary names or links to its canonical source before it grows into a second
explanation.

**Documentation placement follows scope and purpose.** Repository-wide current architecture,
decisions, policies, and guides use separate document types. Subsystem and package details remain
close to their code. Executable sources remain canonical for facts that code can expose or generate.

**Adoption is incremental.** The repository creates the map before moving existing content. Later
changes select one topic at a time, establish its canonical owner, replace duplicates with contextual
links, and preserve useful local detail.

## Entry points

### Root `README.md`

**The root README introduces the product and the repository.** It helps a visitor understand what
Shipfox is, find product documentation, and reach the contributor entrypoint. It does not carry the
engineering handbook.

### `CONTRIBUTING.md`

**`CONTRIBUTING.md` starts a human contribution.** It owns prerequisites, initial setup, the normal
change workflow, essential validation, and contribution expectations. Its task map states when a
human needs deeper context and links directly to it.

### `AGENTS.md`

**`AGENTS.md` starts an agent contribution.** It owns repository-specific agent execution rules,
baseline commands, change hygiene, validation expectations, and conditional reading instructions.
It does not restate shared engineering guidance.

**Nested `AGENTS.md` files are exceptional.** A subtree adds one only when agents need special
execution behavior or restrictions there. Ordinary technical context belongs in a README that both
humans and agents can read.

### `docs/README.md`

**The documentation map supports discovery and maintenance.** It lists context by task before it
lists files by category. It also defines the placement and linking rules from this decision in an
operational form.

## Context link contract

**A required-context link states its trigger before the link.** The reader sees why the destination
matters before deciding whether to open it. The same sentence or table row briefly states what the
destination owns.

Use this shape:

```md
If you add, update, or exempt a dependency, read the
[dependency version policy](docs/policies/dependency-versions.md). It defines
allowed ranges, exceptions, coordinated package families, and required checks.
```

Do not use a bare link when relevance is conditional:

```md
See [dependency version policy](docs/policies/dependency-versions.md).
```

**Task maps put the trigger first.** Their columns use this order:

| Read when the task... | Canonical source | It owns |
| --- | --- | --- |
| Adds or updates a dependency. | Dependency version policy. | Version rules, exceptions, package families, and validation. |
| Adds or changes E2E coverage. | E2E subsystem README. | Suite placement, setup boundaries, screens, and dependencies. |
| Mints, verifies, or carries an auth token. | Auth security model. | Authority, lifetime, trust boundaries, and logging constraints. |

**A destination also confirms its scope.** A deep document opens with a short statement of what it
owns and when it applies. This supports direct arrivals from search or a saved link. It does not
replace the trigger at the earlier navigation point.

**Related links stay conditional.** A deep document links onward when another source becomes
relevant at a specific boundary. It does not end with an unqualified list of every nearby document.

## Document types and authority

| Type | Location | Canonical for | Not canonical for |
| --- | --- | --- | --- |
| Product overview | `README.md` | Product orientation and repository navigation. | Contributor rules or internal architecture. |
| Human entrypoint | `CONTRIBUTING.md` | Setup and the contribution workflow. | Detailed subsystem or package rules. |
| Agent entrypoint | `AGENTS.md` | Agent execution and conditional context loading. | Shared engineering knowledge. |
| Documentation map | `docs/README.md` | Discovery, placement, and the current documentation contract. | Detailed subject matter. |
| Living architecture | `docs/architecture/` | How a cross-cutting system works today. | Historical decision rationale or task steps. |
| Architecture decision | `docs/adr/` | A decision, its context, alternatives, and consequences. | The complete current operating guide. |
| Policy | `docs/policies/` | Repository-wide rules a change must satisfy. | A tutorial or system history. |
| Guide | `docs/guides/` | A cross-cutting task and its verification. | Stable reference facts or decision history. |
| Subsystem README | Nearest common subsystem directory. | Structure and rules shared by that subtree. | Unrelated repository areas. |
| Package README | Package directory. | Package purpose, public use, configuration, and local constraints. | Repository-wide policy. |
| Product documentation | `apps/docs/content/` | End-user and self-hosting product documentation. | Repository contribution rules. |
| Executable source | Code, schemas, manifests, or generated reference. | Fast-changing values and machine-checkable contracts. | Rationale that code cannot express. |

**The primary purpose selects the type.** A document can include enough explanation to make a rule
or task understandable. It does not split one coherent subject only to keep every sentence in a
pure category. It does split when one part has a different owner, update trigger, or canonical
audience.

**ADRs and living architecture have different lifecycles.** An ADR records why the repository chose
a design. A living architecture document states the design contributors must work with now and
links to the ADR for rationale. A later decision supersedes an ADR instead of silently rewriting its
historical context.

**The product documentation page types remain local to the docs app.** Tutorials, explanations,
how-to guides, and references under `apps/docs/content/` continue to follow
`apps/docs/WRITING.md`. The repository document types in this record do not change that system.

## Placement rules

| Information scope | Place it in |
| --- | --- |
| Product users or self-hosters. | `apps/docs/content/`. |
| Human setup or contribution workflow. | `CONTRIBUTING.md`. |
| Agent-only execution behavior. | `AGENTS.md` or a justified nested `AGENTS.md`. |
| Cross-package current system design. | `docs/architecture/`. |
| A durable architectural choice and its tradeoffs. | `docs/adr/`. |
| A repository-wide rule. | `docs/policies/`. |
| A repository-wide procedure. | `docs/guides/`. |
| One subsystem that spans packages. | The subsystem README at their nearest common directory. |
| One package's use, configuration, or constraints. | The package README. |
| One implementation detail. | Code, a focused local README, or a comment that explains why. |

**The narrowest owning scope wins.** A package rule does not move to the root only to make it easier
to find. The root map and contextual links make local ownership discoverable.

**Documentation does not copy executable inventories by default.** Scripts, accepted values,
environment defaults, and schema fields stay in their executable source when practical. Reference
content is generated from that source or links to it. Authored prose explains how to use the facts
and why they matter.

## Writing and agent skills

**`WRITING.md` owns repository-wide prose style.** It defines structure for skimming, sentence and
word choices, punctuation, and readability. It links to the documentation map for placement and
ownership instead of repeating those rules.

**Surface-specific writing guides extend the root guide.** `apps/docs/WRITING.md` owns product docs
page types and templates. A package README standard can similarly extend the root guide, but its
shared requirements must live in a normal repository document that humans can discover.

**Agent skills consume shared standards.** A skill can add a workflow, checks, or automation for an
agent. When it applies a shared rule, it reads and links to the same canonical document a human uses.
The skill does not become the sole owner of that rule.

## Adoption

1. Create `docs/README.md` with the documentation contract and a task-oriented index of existing
   sources.
2. Add direct contextual links for common tasks in `AGENTS.md` and `CONTRIBUTING.md`.
3. Link `WRITING.md` to the documentation map for placement and ownership.
4. Select a canonical owner for each duplicated topic before moving or deleting text.
5. Replace duplicate detail with a trigger, a short scope summary, and a canonical link.
6. Move shared rules out of agent-only sources, then update the relevant skills to consume them.
7. Add link and orphan-document checks after the structure and paths stabilize.

**The first index describes the repository as it exists.** It does not require empty directories or
placeholder documents for every category. A category gains its own index when its size makes the
root map hard to scan.

**Existing links remain stable where practical.** A move must update repository links in the same
change. Frequently referenced root documents can stay at the root when moving them would add churn
without clearer ownership.

## Consequences

**Readers load less unrelated context.** A task begins with a small entrypoint and follows only the
links whose triggers match the work.

**Humans and agents share the same technical sources.** Audience-specific instructions can differ,
but architecture, policy, testing, and package facts do not develop separate versions.

**Local ownership stays visible.** Contributors can update package or subsystem documentation in
the same change as the code it describes. The central map provides discovery without pulling all
detail into one handbook.

**Navigation contains deliberate repetition.** Several entrypoints can repeat a short trigger and
link. This duplication is accepted because it routes different audiences without duplicating the
knowledge behind the link.

**Links and indexes require maintenance.** A canonical document move can affect several routing
surfaces. Link checks and an orphan-document check can catch mechanical failures, but reviewers
must still check that triggers and ownership descriptions remain accurate.

**Some existing documents must be split or narrowed.** Large entrypoints and mixed-purpose guides
will shrink over time. The migration cost is accepted because it replaces continuing drift with
explicit ownership.

## Rejected alternatives

### Keep one central engineering handbook

**A central handbook makes discovery easy but ownership weak.** It accumulates unrelated context,
loads too much for narrow tasks, and drifts away from the code that changes it.

### Keep all documentation beside code

**Full colocation makes cross-cutting knowledge hard to discover.** Repository-wide architecture and
policy would either fragment across packages or require readers to know the implementation layout
before they can find the right context.

### Maintain separate human and agent handbooks

**Parallel handbooks duplicate shared facts.** They can use different entrypoints and execution
instructions, but copying technical knowledge creates inconsistent rules and review work.

### Put the documentation structure in `WRITING.md`

**Writing style and knowledge ownership change for different reasons.** Combining them would make
the writing guide a second documentation map and make routine prose guidance harder to scan.

### Require all navigation through `docs/README.md`

**A mandatory index adds a hop to known tasks.** Direct contextual links serve common tasks. The
complete index remains available for discovery.

## Updating this decision

**A new documentation surface must preserve shared access and canonical ownership.** Update this
record or supersede it before introducing a second shared handbook, a separate agent copy of human
rules, or a documentation type with overlapping authority.

**A repeated placement exception signals a missing category or boundary.** Update the living
documentation contract first. Add or supersede an ADR when the underlying ownership model changes.
