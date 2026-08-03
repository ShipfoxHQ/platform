# Client architecture

This guide owns the current client feature model and form rules. Read it when
you add or change a client feature, API adapter, query, route state, form, atom,
browser storage, or cross-feature client flow. Package READMEs own public APIs
and package-specific usage. [ADR 0003](../adr/0003-client-state-and-domain-architecture.md)
records the decision, alternatives, and consequences behind these rules.

## Feature ownership

A client feature owns its routes, API adapters, domain models, policies, pages,
components, and client-owned state. Keep the package vertical. Do not create a
central package that imports feature internals because it happens to compose a
screen.

Use the folders that the feature needs. Empty layers add no value.

```text
src/
  feature.ts       Node-safe composition manifest
  core/            Domain models, policies, reducers, and pure transforms
  hooks/api/       HTTP transport, DTO mapping, query options, and mutations
  routes/          Router adapters and checked search parameters
  pages/           Screen orchestration
  components/      Domain UI and local interaction state
  state/           Cross-route or persisted client state only
```

Presentation imports `core/`. API adapters import `core/`. `core/` imports
neither client frameworks nor API DTO packages. Put business rules, meaningful
transforms, reducers, and command building in `core/`. Keep layout, focus,
animation, navigation, cache invalidation, and feedback in presentation or API
code.

When changing a client composition seam, read
[ADR 0001](../adr/0001-client-composition-contract.md). It owns feature
manifests, routes, shell providers, navigation, settings sections, and runtime
configuration composition.

## API adapters and React Query

DTOs stop at the API adapter. The adapter parses an untrusted response with the
DTO package's Zod response schema, maps it to a package-owned domain model, and
stores that model in React Query. Pages and components do not consume response
DTOs as their main model.

```text
HTTP response -> response schema -> DTO -> mapper -> domain model -> query cache
```

Write adapters map a domain command or feature input to a request DTO.
Components do not build snake_case transport payloads. Empty responses,
redirect URLs, health checks, and opaque acknowledgements can remain transport
values when they have no domain meaning.

## Resource identity and client URLs

Client route params use `workspaceSlug` and `projectSlug` for workspace and
project navigation. The shell resolves those slugs at the workspace and project
anchor boundaries. Feature pages receive the resolved resource context before
they build requests.

Adapters keep using `workspaceId` and `projectId` UUIDs. Query keys also use the
UUID identity, not the URL slug. A rename therefore changes navigation without
creating a second cache entry or changing the API authorization input. Run and
job routes keep their UUID params below the `runs` page segment. The displayed
run number is not a route identifier.

Settings contributions declare an optional `scope` of `workspace` or `project`.
Entries without a scope remain workspace settings; project-scoped entries render
under the `projectSettings` anchor.

This split is the client side of [ADR 0009](../adr/0009-client-urls-resource-identity.md).
The API remains slug-free in resource identity positions, so
`requireWorkspaceAccess` continues to authorize the UUID selected by the client.

Each server-backed resource exposes a package-owned named
`*QueryOptions` or `*InfiniteQueryOptions` factory from `hooks/api/`. The
factory owns its key, request, mapping, cache policy, and pagination. Hooks,
loaders, and coordinators reuse that factory; hooks do not build an inline raw
`queryOptions` policy. A mutation hook owns the cache updates for the
same-feature resource it changes. Components report user intent and handle
presentation effects such as closing a dialog or navigating. A named page or
application coordinator owns a journey that must update more than one
feature's cache.

Use `checkedApiRequest` from `@shipfox/client-api` for business responses. It
validates the response at the transport boundary. The raw request primitive is
private to `@shipfox/client-api`. Use `emptyResponseSchema` for a response with
no domain value.

## Choose state by its source of truth

| State | Owner | Use it for |
| --- | --- | --- |
| Server state | React Query | Resources, request status, polling, pagination, and cache updates. |
| Route state | TanStack Router | Resource identity, shareable filters, deep links, tabs, and history. |
| Form state | TanStack Form | Draft values, field state, submission state, and validation. |
| Local UI state | `useState` | Short-lived independent visual state. |
| Complex workflow | Pure reducer | Coupled states, mutually exclusive modes, and named transitions. |
| Cross-route client state | Jotai | Small synchronous client-owned values shared across distant routes. |
| Persisted browser state | Typed storage adapter | Preferences, recovery hints, and best-effort dismissals. |

Put a value in checked route parameters or search parameters when refresh,
browser history, copied links, or another tab should preserve it. Keep private
visual state local. Do not copy query data into local state only to filter or
format it. Do not copy route state into Jotai.

Use a discriminated reducer in `core/` when several values describe one
workflow and invalid combinations are possible. Effects perform requests,
focus changes, and navigation outside the reducer.

Add a Jotai atom only after React Query, Router, Form, and local state do not
fit. API resources stay in React Query. Authentication is shell-owned session
state. Browser storage is a typed adapter with checked reads, explicit key
scope and lifetime, and safe fallbacks. It never grants authority.

## Forms

TanStack Form owns an active draft. Use the matching request `*BodySchema` from
the DTO package for field validation when its rules match the form. Zod 3.24+
implements Standard Schema, so pass the schema directly to TanStack Form. Do
not add `@tanstack/zod-form-adapter` or a custom adapter.

```tsx
const form = useForm({
  defaultValues,
  onSubmit: async ({value}) => saveProject(value),
});

<form.Field
  name="name"
  validators={{
    onBlur: createProjectBodySchema.shape.name,
    onSubmit: createProjectBodySchema.shape.name,
  }}
>
  {(field) => (
    <FormField label="Name" id="project-name" error={fieldError(field)}>
      <FormFieldInput
        value={field.state.value}
        onChange={(event) => field.handleChange(event.target.value)}
        onBlur={field.handleBlur}
      />
    </FormField>
  )}
</form.Field>
```

Render every labeled input with `FormField` and its matching field control from
[`@shipfox/react-ui`](../../libs/shared/react/ui/README.md). The control
inherits the field id, `aria-invalid`, and `aria-describedby`. Its package
README owns the public components and API.

Validate fields on blur and the complete form on submit. Show an error after a
field has blurred or after a submit attempt. `fieldError(field)` extracts the
first TanStack Form error for `FormField`.

Map known server failures in a feature-owned pure `form-errors.ts` function.
It returns either a field error or a form error. Apply a field error through
the `onServer` error-map slot. Render a form error in an `Alert`. Never render
an unknown error message directly.

```ts
form.setFieldMeta('name', (previous) => ({
  ...previous,
  errorMap: {...previous.errorMap, onServer: 'A project with this name exists.'},
}));
```

TanStack Form derives visible errors from `errorMap`. A direct write to
`errors` is overwritten on the next derived read. TanStack Form clears
`onServer` on the next field validation, which removes a stale server error
when the user edits the field. Add a Vitest node test for every handled
`ApiError` code and the unknown-error fallback.

A cross-route draft is an exception. Persist only the required fields in a
feature-owned Jotai atom. Sync on blur and unmount, never each keystroke. Clear
the draft after a successful completion. Filter the saved shape so fields from
one form cannot leak into another form's draft.

## Composition and feature boundaries

Features own their route, navigation, and settings contributions. A settings
layout owns the layout and workspace-wide settings concepts. It does not own
every domain settings page.

Cross-feature journeys use a named application or page coordinator. Features
depend on another feature's public domain surface only. Do not deep-import a
feature's components, query internals, or storage helpers.

## Tests and enforcement

Test pure domain models, policies, reducers, commands, and transforms without
React. Test an adapter with representative DTOs and its mapped domain model.
Test query keys, cache effects, polling, and optimistic updates at the query
boundary. Component tests prove rendered behavior. E2E tests prove journeys.

Read the [architecture validation guide](../guides/architecture-validation.md)
when adding, moving, or debugging an enforcement rule. It owns the boundary
between Biome, Dependency Cruiser, executable contract tests, and repository
policy.

Each invariant has one enforcement owner:

| Owner | What it checks | Where to fix it |
| --- | --- | --- |
| Biome plugins | Local source shape: DTO and framework imports in `core/`, response DTOs in pages and components, raw `apiRequest`, leaf-component query-cache writes, raw route inputs, and direct browser storage. | Fix the import or call at the diagnostic location. Do not add `biome-ignore`. |
| `@shipfox/client-architecture-policy` | Semantic and repository facts: checked requests outside adapters, raw responses inside adapters, DTO-to-domain mapping, reusable query policies, query-hook placement, cache-operation ownership, private feature imports, and feature contributions. | Move the code to its adapter, domain, or coordinator boundary; add an exact tested exception only when the boundary is intentional. |
| Focused tests | Composition, cache effects, principal isolation, persistence, retries, and user journeys. | Update the owning contract or runtime test. |

Package checks run the local Biome rules and report source locations. The
repository verifier inventories production adapters and query hooks under
`libs/client/**` and `libs/shared/react/ui/**`. Both checks require zero
production violations. Neither check has a migration baseline or broad
allowlist.

A shell/runtime or cross-feature coordinator that needs a direct query-client
operation must be recorded in the
[`cacheOperation` registry](../../tools/client-architecture-policy/src/audit-client-architecture.ts)
with its exact source file, owner, reason, and focused test. The verifier
rejects unregistered operations and stale registry records. The step-log query
is the only narrow query-policy exception. Its per-view cursor and retry
lifecycle is recorded in the same
[`clientArchitectureExceptions`](../../tools/client-architecture-policy/src/audit-client-architecture.ts)
registry. Every exception must name one owner, one reason, one owning boundary,
and one focused test. Never use a baseline, package-wide allowlist,
or unowned suppression.

Run the affected package and its dependents after a client boundary change:

```sh
mise exec -- turbo check --filter=@shipfox/<package>...
mise exec -- pnpm check:client-architecture
```

When changing a Biome plugin or the semantic verifier, also run the focused
fixtures and packed external-consumer checks:

```sh
mise exec -- turbo test type --filter=@shipfox/biome --filter=@shipfox/client-architecture-policy
mise exec -- pnpm check:client-architecture
```

The `no-raw-route-inputs` and `no-direct-browser-storage` Biome plugins in
`tools/biome/plugins/client-architecture/` own those source-shape boundaries.

A completed feature package has `core/` domain models and policies with no UI
or transport imports; checked adapter functions that parse and map every
business response; reusable package-owned query options for each server
resource; mutation-owned cache effects; route, settings, and navigation
contributions in its own `feature.ts`; and typed browser-storage definitions
that declare `lifetime` and `principalScope`. Components and pages consume the
domain surface and coordinate UI only. A narrow shell/runtime or cross-feature
coordinator exception must be named and tested at its owner rather than copied
into a leaf component.

Update this guide when the current operating model changes. Update ADR 0003,
or add a new ADR, when the durable decision, ownership model, or accepted
tradeoff changes.
