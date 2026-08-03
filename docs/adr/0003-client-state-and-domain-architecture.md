# Architecture decision record 0003: Client state and domain architecture

- **Status:** Accepted.
- **Date:** 2026-07-22.
- **Decision owners:** Client architecture.
- **Related decision:** [ADR 0001: Public client composition contract](0001-client-composition-contract.md).

## Context

**The client uses several state tools for different jobs.** React Query stores server data. TanStack
Router stores route and search state. TanStack Form stores form state. Jotai stores the session and a
small amount of cross-route client state. React stores local component state.

**The tools are not the main problem.** State ownership differs between features. Some mutations own
their cache updates. Other components update the query cache. Some routes keep filters in the URL.
Other pages keep similar filters in local state. Complex flows often use several nullable state
values that can represent invalid combinations.

**Data transfer objects leak into feature code.** Some components read API response fields directly.
This ties rendering and business rules to the wire shape. A change from `snake_case` fields, nullable
transport values, or response envelopes can spread through the feature.

**Business logic has no consistent home.** Workflows and Logs use `core/` modules for models and pure
rules. Other features place parsing, filtering, payload shaping, state transitions, and error rules
beside components or API hooks. The logic is often pure, but the package structure does not show its
role.

**The composition contract defines the global runtime.** ADR 0001 makes `@shipfox/client-shell` own
the router, React Query client, Jotai store, theme, shared providers, and runtime config. This record
defines how feature packages use that runtime.

## Decision

**Shipfox uses vertical client features with an explicit domain boundary.** Each feature owns its
routes, API adapters, domain models, business rules, pages, and components. Application code chooses
a state tool from the source of truth and lifetime of the state.

**API responses become domain models at the HTTP boundary.** Data transfer objects (DTOs) are wire
contracts. They do not flow through pages and components as the feature's main model. The API adapter
checks the response and maps it to a model from `core/` before the data enters the query cache.

**Business logic belongs in `core/` by default.** Domain rules, derived state, transitions, policies,
and meaningful transforms stay independent from React and client infrastructure. UI code renders a
model and reports user intent.

**This record does not choose one global state store.** React Query, Router, Form, Jotai, and local
React state keep separate roles. A feature cannot copy one tool's state into another tool without a
documented reason.

**Adoption is incremental.** New features and material changes follow this record. Existing code can
move one boundary at a time. The repository does not require a single large migration.

## Source of truth

**The source of truth selects the state tool.** Use this table before adding state:

| State | Owner | Use it for | Do not use it for |
| --- | --- | --- | --- |
| Server state | React Query | API resources, request status, polling, pagination, and cache updates. | Modal state, draft input, or copied server data. |
| Route state | TanStack Router | Resource identity, shareable filters, deep links, tabs, and browser history. | Private visual details that have no navigation meaning. |
| Form state | TanStack Form | Draft values, field state, submission state, and form validation. | Server resource caches or unrelated page state. |
| Local UI state | React `useState` | Open state, focus targets, hover state, clipboard feedback, and short-lived selection. | Cross-route state or complex workflows with invalid combinations. |
| Complex UI workflow | A pure reducer with a discriminated state | Multi-step flows, mutually exclusive modes, and event-based transitions. | Simple independent booleans or one-field input. |
| Cross-route client state | Jotai | Synchronous session state and small client-owned values shared across distant routes. | API resources, URL state, or every local component value. |
| Persisted browser state | A typed storage adapter, optionally behind a Jotai atom | User preferences, recovery hints, and best-effort dismissals. | Authoritative server state or security decisions. |
| Boot state | Shell-owned module state | Checked runtime config and process-wide API client wiring. | Feature business state or route state. |

**State has one canonical owner.** Derived values stay derived. A component must not copy query data
into local state only to filter, sort, or rename it. A feature must not copy URL state into Jotai. A
form can start from a domain model, but later server updates do not silently replace an active draft.

## Feature package structure

**A feature package follows one dependency direction.** The exact folders can stay small. Empty
layers are not required.

```text
src/
  feature.ts       Node-safe composition manifest
  core/            Domain models, policies, reducers, and pure transforms
  hooks/api/       HTTP transport, DTO mapping, query options, and mutations
  routes/          Router adapters and search checks
  pages/           Screen orchestration
  components/      Domain UI and local interaction state
  state/           True cross-route or persisted client state only
```

The dependency direction is:

```text
routes/pages/components  -> core
hooks/api                -> core
core                     -> no client framework or API DTO package
```

**`core/` is the normal home for business logic.** A rule belongs there when it can answer yes to
one of these questions:

- Does it express a product or domain concept?
- Could another page, test, command line client, or future application need it?
- Does it interpret status, capability, ownership, or allowed transitions?
- Does it normalize, filter, group, or select data using product meaning?
- Does it build a command from user intent?
- Can invalid state exist when several local values are combined?

**Presentation details stay outside `core/`.** Focus management, animation, modal layout, toast copy,
router calls, query invalidation, and loading placeholders are client concerns. Pure visual formatting
can live in `@shipfox/react-ui` when it is domain-neutral.

## DTO and domain boundary

**Response DTOs end at the API adapter.** A DTO package owns the HTTP shape. It can use `snake_case`,
nullable fields, version fields, and response envelopes. Feature models use domain names and
explicit states.

```text
HTTP response
  -> response schema check
  -> DTO
  -> package-owned mapper
  -> core domain model
  -> React Query cache
  -> page and components
```

**The adapter checks untrusted responses.** It parses a response with the exported Zod response
schema when the DTO package provides one. A new response contract should export a runtime schema.
The adapter must not rely only on a TypeScript generic cast for new boundary code.

**The mapper constructs the domain model.** A domain model can use plain objects and pure functions.
It can use a class when identity, invariants, or behavior make the class clearer. This decision does
not require generated source files or classes for every resource.

**The core does not import its API DTO.** The mapper imports both sides:

```ts
// core/project.ts
export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  source: ProjectSource;
}

export function canRunWorkflows(project: Project): boolean {
  return project.source.connectionStatus === 'active';
}
```

```ts
// hooks/api/project-mapper.ts
import type {ProjectResponseDto} from '@shipfox/api-projects-dto';
import type {Project} from '#core/project.js';

export function toProject(dto: ProjectResponseDto): Project {
  return {
    id: dto.id,
    workspaceId: dto.workspace_id,
    name: dto.name,
    slug: dto.slug,
    source: toProjectSource(dto.source),
  };
}
```

The project model carries both values on purpose. `id` is the stable resource
identity used by API requests and query keys. `slug` is the mutable navigation
and display identifier used by client URLs. The mapper keeps the distinction at
the DTO boundary so pages do not infer identity from a URL segment.

**React Query stores domain models by default.** Mapping in `queryFn` creates one canonical cached
shape. A component-level `select` can create a local projection, but it cannot be the only place that
hides the DTO.

**Mutation responses follow the same rule.** A mutation maps its response before exposing it. A write
adapter maps a domain command or feature input to the request DTO. Components do not build transport
payloads with `snake_case` fields.

**Small transport results can stay transport values.** An empty response, one-time redirect URL,
health result, or opaque acknowledgement does not need a domain model when it has no business
meaning. The feature must not add a pass-through model only to satisfy folder symmetry.

## React Query ownership

**Query definitions own their full policy.** A package-owned query option defines the key, request,
DTO mapping, stale time, pagination, and domain projection. Hooks, route loaders, and coordinators
reuse that option.

**Mutation hooks own cache effects.** The mutation that changes a resource updates or invalidates its
queries. A component should not know the resource's query key. It reports success, closes a surface,
shows presentation feedback, or navigates.

**A coordinator can update more than one feature.** Cross-feature work can invalidate several query
namespaces. That code must live in an explicit page or application coordinator. It cannot make a
leaf component own another feature's cache.

**The query cache belongs to the active principal.** The shell clears private cached data when the
user logs out or the authenticated user changes. Query keys still include workspace and resource
identity. Key scoping does not replace principal isolation.

**Polling and optimistic updates stay near the query.** They are server-state policies. Pure helper
functions can implement filter checks, temporary model construction, and rollback transforms when
those rules need focused tests.

## Router and URL state

**The URL owns navigation state.** Put a value in route params or checked search params when a user
expects refresh, Back, Forward, copying a link, or opening a second tab to preserve it.

Common URL state includes:

- Resource identifiers.
- Selected tabs with product meaning.
- Shareable filters and search terms.
- Deep selection such as a workflow job, step, or attempt.
- Pagination position when returning to the same position matters.

**Routes check search input.** A route uses `validateSearch` and a typed route API. Pages should not
repeat `Record<string, unknown>` casts and ad hoc parsing when the generated router can provide a
checked value.

**Private interaction state stays local.** A tooltip, copied state, pending focus target, or open
menu does not belong in the URL. A feature must decide whether a filter is navigation state before
choosing local state.

## Forms

**TanStack Form owns active drafts.** Request DTO schemas provide field checks when their rules match
the user-facing form. Domain policies provide checks that are not transport concerns.

**Request schemas are a narrow DTO exception.** A form can import a request-body schema for field
validation. It does not use response DTOs as models or build the final transport payload inline.

**Form submission sends a command.** The form maps its values to a domain command or calls an
application function that does so. The API adapter maps that command to the request DTO.

**Known failures become field or form errors.** A feature-owned pure function maps known failures to
safe presentation results. Unknown errors use generic copy. UI code does not render an unknown raw
error message.

**Cross-route drafts are rare.** A Jotai draft is valid when navigation between related routes must
keep input. It syncs on blur or unmount, not every key press. Successful completion clears it.

## Local state and reducers

**`useState` is the default for independent local state.** One modal flag, selected row, search input,
or copy result does not need a reducer.

**A reducer owns coupled state.** Use a discriminated union and named events when a component has
mutually exclusive modes, chained steps, or several nullable values that describe one workflow.

```ts
type SetupState =
  | {kind: 'choosing-harness'}
  | {kind: 'choosing-provider'; harness: Harness}
  | {kind: 'configuring-provider'; harness: Harness; provider: Provider}
  | {kind: 'saving'; harness: Harness; provider: Provider};
```

**The reducer stays pure and lives in `core/`.** Effects observe a transition and perform requests,
focus changes, or navigation outside the reducer.

**Shipfox does not adopt a state-machine library now.** A library becomes useful when several
features need parallel states, cancellation, persisted machines, state charts, or common tooling.
Pure reducers cover the current need with less runtime and API surface.

**Feature components choose one state owner.** Controlled and uncontrolled modes are useful for
shared UI primitives. Product feature components should not support both unless two real consumers
need both modes. Dual modes add synchronization effects and edge cases.

## Jotai and authentication

**Jotai stays narrow.** It stores client-owned state that must be read or changed across distant
routes. A new atom needs a reason that rules out React Query, Router, Form, and local state.

**Authentication is a documented exception.** The shell owns one atomic session snapshot with
loading, guest, and authenticated states. It includes the access token and the data needed by route
guards. The API client needs synchronous token access, and the router needs a consistent session
view.

**Auth hydration has one owner.** Refresh and login flows update the session through shared
transitions. React Query can deduplicate the requests, but it is not a second canonical auth model.
Logout and user changes clear both the session atom and private query data.

**Feature server data does not move into Jotai.** Workspaces, projects, runs, integrations, and other
API resources remain React Query data even when many components use them.

## Browser storage

**Storage is an adapter, not a domain store.** A package provides typed read, write, and clear
functions. Reads check the stored shape. Storage failures return a safe fallback when persistence is
best effort.

**Every key declares its lifetime and scope.** A key name includes the Shipfox namespace. The model
defines whether the value lasts for a page, tab, browser profile, user, or workspace. User-scoped data
must not leak across an account change.

**Storage cannot grant authority.** It can remember a preference, dismissal, or recovery hint. The
server and checked route state remain the source of truth for access and completed work.

**Repeated storage patterns use one helper.** OAuth recovery hints and similar values should share a
small typed adapter instead of repeating `try` and `catch` blocks. Feature-specific validation and
key names remain with the feature.

## Single-flight and module state

**Single-use callbacks need idempotent effects.** OAuth codes and invitation acceptance can be
reached through Strict Mode remounts, browser Back, or repeated clicks. A feature can use a
module-lifetime single-flight registry when the remote operation cannot be safely replayed.

**The registry has an explicit policy.** Its key, eviction, retry, and result lifetime must match the
remote contract. A single-use code can retain a settled result for the document lifetime. A retryable
request removes its entry after settlement.

**Repeated registries use one tested primitive.** Features configure the lifecycle instead of
copying `Map` and `Set` logic. The server still provides idempotency when a command can support it.

**Other feature module state is forbidden.** Features cannot use module-level mutable stores,
service locators, or hidden registration. Static sets used as immutable lookup tables are not state.

## UI boundaries

**`@shipfox/react-ui` owns domain-neutral UI.** It contains visual primitives, accessibility
behavior, controlled and uncontrolled component mechanics, and reusable browser hooks. It cannot
fetch Shipfox resources or import feature DTOs.

**`@shipfox/client-ui` owns stable product-wide presentation.** It can contain shared load states,
safe error copy, and product UI used by more than one feature. It cannot own a business workflow,
route, or feature server cache.

**Feature components render domain models.** They accept meaningful props and report user intent.
Reusable views should not require a full React Query result when a small load-state interface or
domain value is enough.

**Pages orchestrate screens.** A page binds routes, queries, commands, feature state, navigation, and
feedback. It passes domain models and callbacks into components. Small pages can stay in one file;
the boundary matters more than the number of components.

## Cross-feature work

**A feature owns its own route contributions.** A domain package should contribute its settings
route and settings section when it owns the page. The workspace settings package owns the settings
layout and workspace-wide settings concepts. It does not become the default owner of every domain
settings screen.

**Cross-feature journeys use a named coordinator.** Onboarding and other flows can read Projects,
Integrations, and Agent state. The application or a dedicated coordinator owns that policy. A leaf
feature must not become the hidden application root because it happened to add the first journey.

**Features depend on public domain surfaces.** They do not deep-import another feature's components,
query internals, or storage helpers. The composition root can import feature manifests and explicit
application adapters.

## Testing

**Core tests run without React.** They cover DTO-independent models, policies, reducers, commands,
and transforms in Vitest's `node` environment.

**Boundary tests prove mapping.** They parse representative DTOs and check the domain model. They
cover optional fields, unknown values, and response changes that could alter business behavior.

**Query tests prove cache policy.** They cover keys, invalidation, optimistic updates, polling, and
principal changes. Component tests do not repeat those assertions.

**Component tests prove rendered behavior.** Storybook covers visual states. React Testing Library
covers behavior that needs React or browser APIs. Playwright covers full user journeys.

## Consequences

**Features gain a stable internal language.** UI code does not depend on wire field names. Domain
rules become easy to find and test. A transport change usually affects one schema and mapper.

**The query cache becomes safer to consume.** Every consumer sees the same domain model. Route
loaders, pages, and components do not create separate DTO projections.

**Invalid UI states become harder to represent.** Reducers make complex transitions explicit. URL
checks make navigation state explicit. A single owner reduces synchronization effects.

**The design adds mapping code.** A simple resource can need a DTO parser, mapper, and domain type
that look similar at first. This cost is accepted for business resources because the separation
protects later behavior. Transport-only results remain exempt.

**Vertical ownership can add composition entries.** More features may contribute their own settings
routes. This creates a longer feature list, but removes central packages that import every domain
implementation.

**Several tools remain in use.** Developers must learn the source-of-truth table. This is preferred
to one global store that duplicates server, route, and form state.

## Enforcement

**Review checks new state against this record.** A change that adds an atom, module store, direct DTO
use in a component, or component-owned cache invalidation must state why the normal owner does not
fit.

**Repository checks should grow from proven patterns.** Suitable checks include blocked response DTO
imports from pages and components, blocked client-framework imports from `core/`, and package
dependency rules. Request schemas used for field validation remain allowed. Add a check only after at
least one feature follows the target structure and proves the rule is practical.

**ADR 0007 owns enforcement placement and cross-repository distribution.** Use the
[architecture validation guide](../guides/architecture-validation.md) to select the tool and
verification path for a rule derived from this record.

**Exceptions update this record.** A repeated exception is an architecture change, not a local
workaround.
