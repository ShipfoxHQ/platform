# ADR 0001: Public client composition contract

- **Status:** Accepted
- **Date:** 2026-07-17
- **Decision owners:** E1 platform composition seams
- **Linear issue:** [ENG-959](https://linear.app/shipfox/issue/ENG-959/author-the-client-composition-adr)
- **Implementation issue:** [ENG-938](https://linear.app/shipfox/issue/ENG-938/implement-and-publish-the-client-composition-seam)

## Context

Applications need to compose the Shipfox client from published packages. They must be able to add
or replace routes, append providers, add navigation tabs and settings sections, and extend runtime
configuration. The default Shipfox client uses the same public contract.

The phase-0 record fixes these semantics:

- Routes use normalized full paths as collision keys.
- A duplicate path fails composition unless one contribution sets `override: true`.
- Feature array order never resolves collisions.
- The shell owns the router, React Query client, Jotai store, theme, shared tooltip and toast
  infrastructure, navigation rendering, and runtime-config loading.
- Feature providers mount inside shell providers and nest in declared order.
- Features contribute navigation and settings data through registries.
- The shell merges and checks one runtime-config contract.

Before this cutover, the upstream client was hard-wired. `apps/client/src/main.tsx` mounted the
provider stack and router, while `@shipfox/client-router` owned the generated TanStack route tree.
Project tabs and workspace settings navigation were hardcoded. Config shapes merged with object
spread, so duplicate keys resolved silently.

## Repository ownership

This ADR lives beside `@shipfox/client-shell` because it defines that package's public API and build
behavior. Changes to the contract, implementation, and decision can therefore stay in one review.
Composing applications own only their explicit feature arrays and application-specific features.

## Decision

Shipfox exposes a compile-time feature composition contract. A Vite application supplies an explicit
ordered feature array. A Vite plugin evaluates Node-safe feature manifests, checks every
contribution, and generates a consumer-local TanStack route tree.

The contract does not include runtime discovery, a service registry, or environment-selected
feature modules.

## Public contract

### Stable identifiers

Every feature has a stable namespaced slug such as `shipfox.workflows` or `acme.sso`. Feature ids are
part of the public compatibility surface. Applications must not derive them from display names or
package versions.

Provider, navigation, and settings contributions also have stable ids. Their ids stay stable when
labels, icons, routes, or implementations change. Checks compare ids within each contribution kind
across the full feature array.

Every composition error names the invalid path, key, or contribution id. It also names every feature
involved in the error. Feature position may appear in diagnostic details, but it is not an identifier
and never grants precedence.

### Authoring entry point

The `@shipfox/client-shell` package root exports only the feature-authoring contract and
`defineClientFeature()`. It is safe to evaluate in Node.js. It does not import browser runtime code,
CSS, or route implementation modules.

```ts
import type {IconName} from '@shipfox/react-ui/icon';
import type {ComponentType, PropsWithChildren} from 'react';
import type {z} from 'zod';

export type AnchorId =
  | 'root'
  | 'workspaceLayout'
  | 'projectLayout'
  | 'workspaceSettings';

export type RouteParentId = AnchorId | (string & {});

export interface LayoutContribution {
  id: string;
  path: string;
  parent: RouteParentId;
  impl: string;
}

export interface RouteContribution {
  path: string;
  parent: RouteParentId;
  override?: boolean;
  impl: string;
}

export interface FeatureProvider {
  id: string;
  Component: ComponentType<PropsWithChildren>;
}

interface NavTabEntryBase {
  id: string;
  label: string;
  to: string;
  exact?: boolean;
  order?: number;
}

export type NavTabEntry =
  | (NavTabEntryBase & {scope: 'workspace' | 'project'; layout?: never})
  | (NavTabEntryBase & {
      scope: 'layout';
      layout: string;
      minimumRole?: string;
    });

export interface SettingsSectionEntry {
  id: string;
  pathSegment: string;
  label: string;
  icon: IconName;
  order?: number;
}

export interface ClientFeature<S extends z.ZodRawShape = z.ZodRawShape> {
  id: string;
  layouts?: readonly LayoutContribution[];
  routes?: readonly RouteContribution[];
  providers?: readonly FeatureProvider[];
  navigation?: readonly NavTabEntry[];
  settingsSections?: readonly SettingsSectionEntry[];
  configShape?: S;
}

export function defineClientFeature<const T extends ClientFeature>(feature: T): T;
```

`defineClientFeature()` is an identity function with const-generic inference. It has no registration
side effect.

Feature manifests and all modules they import eagerly must be Node-safe because jiti evaluates them
during Vite startup. They must not read `window`, `document`, storage, or other browser-only state at
module scope. A provider component may use browser APIs during render or in an effect. Route
implementation modules are not evaluated by jiti; the generated file imports them for Vite.

### Runtime entry point

`@shipfox/client-shell/runtime` exports browser composition, `defineRoute()`, the anchor builders,
registry helpers, and the pure composition checks. This split prevents Node manifest evaluation from
loading the browser runtime by accident.

Route implementation modules export one `defineRoute()` result. The manifest owns `path` and
`parent`, so an implementation cannot redefine them.

```ts
import {defineRoute} from '@shipfox/client-shell/runtime';

export default defineRoute({
  component: WorkflowsPage,
  loader: loadWorkflows,
  validateSearch: workflowsSearchSchema,
});
```

The route options support the TanStack behavior used by the current client: `component`, `loader`,
`beforeLoad`, `validateSearch`, `staticData`, `pendingComponent`, and `errorComponent`. The generated
route supplies its path, parent, and router context.

### Paths and anchors

Route manifests use full paths. Composition removes trailing slashes from non-root paths before any
comparison. `/` remains `/`. Navigation targets use the same normalization.

The client URL prefixes are part of the composition contract, not an implementation detail of the
default application. Workspace-scoped routes start with `/w/$workspaceSlug`, project-scoped routes
nest below it at `/p/$projectSlug`, and workspace settings routes nest below
`/w/$workspaceSlug/settings`. The prefix registry maps `w` to the workspace slug and `p` to the
project slug. A registered prefix must be followed immediately by its dynamic slug parameter, and
the corresponding slug parameter may not appear outside its registered prefix. Other dynamic
parameters must follow a page segment rather than being placed directly after an entity prefix.

Composition validates these path invariants for every feature-owned layout and route before it
builds the generated route tree. A feature contribution that uses the legacy `/workspaces/...`
shape, or otherwise puts a registered slug outside its prefix, fails at composition time with a
route-path diagnostic. External feature authors should therefore use the anchor paths below as the
source of truth when declaring routes and navigation targets.

The shell owns four anchors:

| Anchor | Purpose |
| --- | --- |
| `root` | Root document and global error boundary |
| `workspaceLayout` | Routes scoped to a workspace |
| `projectLayout` | Routes scoped to a project |
| `workspaceSettings` | Routes rendered inside workspace settings |

Features may also declare layout contributions. A layout has a stable id, a full path, a parent, and
a public route implementation. A route from any composed feature can name that layout id as its
parent. Layout ids are unique across the composition and cannot replace shell anchors.

The generator injects the matching parent route. A route must be below the path represented by its
anchor or feature-owned layout. An override must keep the base route's normalized path and parent.

A route may also own the exact anchor path when it names that anchor directly. Root-parented routes
and layouts cannot use a path equal to or below a protected shell anchor; this prevents a sibling
route from bypassing the anchor's guards. The generator represents an exact-anchor contribution as
an index route below the anchor.

An accepted override replaces the whole route options object. It replaces the component, loader,
`beforeLoad`, search check, static data, pending component, and error component together. Children
attach to the replacement from the manifest graph.

A replacement layout must render an `Outlet` if it owns child routes. This is an author obligation.
The shell does not promise a warning because static checks cannot prove arbitrary React behavior.
An overriding search check must also accept all upstream-reachable navigation. New parameters must
be optional or have defaults.

Navigation targets remain full paths after an override. They never point to implementation ids.

Feature-owned layouts may expose local navigation. A layout-scoped entry sets `scope: 'layout'`,
names its layout with `layout`, and may carry opaque `minimumRole` metadata. `minimumRole` is not
part of workspace- or project-scoped entries. The shell keeps these entries as data and exposes them through `useLayoutNavigation(layoutId)` from
`@shipfox/client-shell/runtime`. The layout owns rendering and role policy. Child features can add
entries without importing the layout feature or its route implementation.

## Generated route tree

`shipfoxClientComposition()` is exported from `@shipfox/client-shell/vite`. It generates
`src/shipfox-app.gen.ts` by default.

The generated file:

- starts with a generated-file warning;
- statically imports every route implementation;
- creates code-based routes below the four anchors;
- exports `routeTree` and `router`;
- augments TanStack Router's `Register` with the consumer's router type; and
- checks that each implementation is a `defineRoute()` result.

Consumer-local generation preserves typed `Link`, `useParams`, and `useSearch` for upstream and
external routes. The published shell must not augment `Register`, because different applications
have different route trees.

The composing application commits the generated file. The Vite plugin generates it during
`buildStart`, watches the feature manifest graph, and regenerates on a manifest change. It writes the
file only when content changes. Type-check jobs must run the generator before `tsc` when a clean
checkout has no generated file. After a merge conflict, resolve the feature array and manifests,
then rerun Vite generation instead of hand-merging generated code.

The generated router enables scroll restoration. Its initial context includes the shell auth state,
query client, and an optional workspace setup gate.

## Shell chrome seams

The shell owns the root not-found page, workspace guard, navigation chrome, settings chrome, and
the shared workspace setup loading and error states. The workspace anchor validates authentication
and workspace membership, remembers the active workspace, then invokes an application-provided
`workspaceSetup` gate from router context.

The gate remains outside the shell because it queries project, integration, and agent data owned by
features. A composition that contains workspace routes but omits the gate fails loudly.

The shell receives browser-only `ChromeSlots` through `composeClientApp()`. They provide the
project breadcrumb and project/workspace consistency guard. An application may also provide one
`AccountMenuEntry` component. The shell renders that optional component inside `UserMenu` before
the shell-owned logout action; the component may return nothing based on the current session. The
slot cannot replace the user identity, theme controls, logout action, or authentication runtime.
These slots are not feature providers or manifest data, so Node-safe manifest evaluation never
imports browser chrome or creates a shell-to-feature dependency.

## Composition rules

### Routes

1. One contribution at a normalized path is accepted.
2. Two non-override contributions at the same path fail.
3. One `override: true` contribution must match one earlier non-override contribution.
4. An override without a matching base fails.
5. Two overrides at the same path fail.
6. An override cannot change the base anchor.
7. Feature order never resolves a collision.

The base contribution must appear before its override so the single composition pass can identify
the target. This ordering identifies the base; it does not grant implicit precedence.

### Providers

The shell owns this stack:

```text
StrictMode
  ThemeProvider
    TooltipProvider
      QueryClientProvider
        JotaiProvider
          AuthRuntime
            FeatureProvider 1
              FeatureProvider 2
                RouterProvider
                Toaster
```

Feature providers nest by feature-array order and declaration order. They mount outside
`RouterProvider`, so they cannot use router hooks. They persist across route navigation.

Provider ids must be unique. The shell reserves `theme`, `tooltip`, `query-client`, `jotai-store`,
`auth`, `router`, and `toaster`. TypeScript cannot detect whether an arbitrary provider mounts a
second copy of a shell-owned context. Documentation and review remain part of remount prevention.

### Navigation and settings

Navigation and settings entries are data. They do not carry JSX. The default `order` is 500. Entries
sort by numeric order, feature-array position, then declaration position.

Navigation ids must be unique. Each normalized `to` target must exist in the route tree. A
layout-scoped target must be the layout root or a descendant of that layout, including routes below
nested feature-owned layouts. `to` stays a string because a feature package cannot see the
consumer's generated route union.

`minimumRole` is available only on layout-scoped entries. It is data for the owning layout. The
composition check accepts non-empty strings and rejects malformed role metadata. It does not import
or define a role policy.

A settings section adds navigation data only. The feature contributes its page as a normal route. A
section with `pathSegment: 'sso'` requires `/w/$workspaceSlug/settings/sso`. Section ids must be
unique. The settings index redirects to the first sorted section.

### Runtime configuration

Each feature may contribute one Zod raw shape. The shell adds its base shape, merges the fragments,
and calls the existing `loadConfig()` once.

Two different schema instances for the same key fail composition. The same schema object may appear
through more than one feature and deduplicates by reference. This supports a shared exported schema
constant. Config keys keep their deployment-facing names and are not automatically namespaced.

## Diagnostics

These message templates are part of the contract. Quoted values are replaced with the real path,
id, key, or feature id.

| Failure | Exact message template |
| --- | --- |
| Route collision | `Route "<path>" is contributed by both features "<first>" and "<second>". Set override: true to replace it explicitly.` |
| Duplicate layout id | `Layout id "<id>" is contributed by both features "<first>" and "<second>".` |
| Reserved layout id | `Layout id "<id>" in feature "<feature>" is reserved by the shell.` |
| Reserved layout path | `Layout "<id>" in feature "<feature>" targets path "<path>" which is reserved by a shell anchor.` |
| Missing layout parent | `Layout "<id>" in feature "<feature>" targets missing layout parent "<parent>".` |
| Cyclic layout parent | `Layout "<id>" in feature "<feature>" has a cyclic parent reference.` |
| Missing route parent | `Route "<path>" in feature "<feature>" targets missing layout parent "<parent>".` |
| Layout replaces route | `Route override for "<path>" from feature "<feature>" cannot replace layout "<id>" contributed by feature "<layout-feature>".` |
| Missing override base | `Route override for "<path>" from feature "<feature>" has no route to replace.` |
| Competing overrides | `Route "<path>" has competing overrides from features "<first>" and "<second>".` |
| Override changes anchor | `Route override for "<path>" from feature "<override>" cannot change anchor from "<base-anchor>" in feature "<base>" to "<override-anchor>".` |
| Reserved provider | `Provider id "<id>" in feature "<feature>" is reserved by the shell.` |
| Duplicate provider | `Provider id "<id>" is contributed by both features "<first>" and "<second>".` |
| Duplicate navigation | `Navigation entry "<id>" is contributed by both features "<first>" and "<second>".` |
| Missing navigation target | `Navigation entry "<id>" in feature "<feature>" targets missing route "<path>".` |
| Invalid navigation layout | `Navigation entry "<id>" in feature "<feature>" has invalid layout metadata. Expected a non-empty layout id.` |
| Missing navigation layout | `Navigation entry "<id>" in feature "<feature>" targets missing layout "<layout>".` |
| Navigation outside layout | `Navigation entry "<id>" in feature "<feature>" targets route "<path>" outside layout "<layout>".` |
| Invalid role metadata | `Navigation entry "<id>" in feature "<feature>" has invalid minimum role metadata. Expected a non-empty string.` |
| Role metadata outside layout | `Navigation entry "<id>" in feature "<feature>" has minimum role metadata but is not layout-scoped.` |
| Duplicate settings section | `Settings section "<id>" is contributed by both features "<first>" and "<second>".` |
| Missing settings route | `Settings section "<id>" in feature "<feature>" requires route "<path>".` |
| Duplicate config key | `Config key "<key>" is contributed by both features "<first>" and "<second>". Reuse the same schema instance to intentionally share it.` |
| Invalid anchor nesting | `Route "<path>" must be nested under anchor "<anchor>" (<anchor-path>).` |
| Invalid layout nesting | `Route "<path>" must be nested under layout "<layout>" (<layout-path>).` |
| Root parent inside protected anchor | `Route "<path>" in feature "<feature>" cannot use root parent inside reserved anchor "<anchor>" (<anchor-path>). Use parent "<anchor>".` |
| Route module not found | `Could not resolve route implementation "<specifier>" for "<path>".` |
| Invalid route export | `Route implementation "<specifier>" for "<path>" must export default defineRoute(...).` |
| Feature evaluation | `Failed to evaluate features module "<file>". Features modules must be Node-safe: <cause>` |
| Invalid feature export | `Features module "<file>" must export a features array.` |

The external collision proof produced this message and a non-zero build status:

```text
Route "/auth/login" is contributed by both features "shipfox.auth" and "fixture.unapproved-collision". Set override: true to replace it explicitly.
```

## Package boundaries

### `@shipfox/client-shell`

The package uses explicit exports:

- `@shipfox/client-shell`: Node-safe authoring types and `defineClientFeature()`;
- `@shipfox/client-shell/runtime`: browser composition, route helpers, anchors, layout navigation,
  and checks;
- `@shipfox/client-shell/vite`: the codegen Vite plugin; and
- `@shipfox/client-shell/testing`: test and Storybook construction helpers.

Public consumers do not import internal files.

### `@shipfox/client-features`

This package exports `defaultFeatures(): ClientFeature[]`. It is the upstream composition and
replaces the removed `@shipfox/client-router`. Each feature package exports its stable feature and
every route implementation subpath named by its manifest.

### Dependencies and package conditions

Singleton-sensitive libraries are peers of the public client packages: `react`, `react-dom`,
`@tanstack/react-router`, `@tanstack/react-query`, `jotai`, and `zod`. Vite is a peer because the
package exports a Vite plugin. `@tanstack/router-core` is a direct runtime dependency because emitted
anchor declarations name its types.

`@shipfox/client-features` also lists the default route packages as peers. Those peers are
`@shipfox/client-auth`, `@shipfox/client-invitations`, `@shipfox/client-integrations`,
`@shipfox/client-projects`, `@shipfox/client-workflows`, `@shipfox/client-agent`, and
`@shipfox/client-workspace-settings`.

This exposes the app requirement at install time. The generated router lives in the app, not in
`client-features`. It imports each route by package name.

Packages keep the repository export conditions:

- `workspace-source` resolves `src` for repository work;
- `default` resolves JavaScript and declarations under `dist`;
- SWC emits JavaScript;
- `shipfox-tsc-emit` emits declarations; and
- ESM export maps define the public surface.

The packed-consumer gate verifies default, `development`, and `types` resolution against
productionized tarballs with no source targets. Changesets link the public client packages as one
release group. `@shipfox/react-ui` stays outside that linked group.

## Composition roots

Every composing application uses the same feature-array API.

```ts
import {defaultFeatures} from '@shipfox/client-features';
import {composeClientApp} from '@shipfox/client-shell/runtime';
import {acmeSsoFeature} from '@acme/shipfox-sso-client';

const app = composeClientApp({
  features: [...defaultFeatures(), acmeSsoFeature],
});

app.mount(document.getElementById('root')!);
```

`defaultFeatures()` returns a new array. A distribution may append features, omit defaults, or build
an explicit array. It does not mutate a global registry.

The Vite config reads the same feature module:

```ts
import {shipfoxClientComposition} from '@shipfox/client-shell/vite';

export default defineConfig({
  plugins: [
    shipfoxClientComposition({features: './src/features.ts'}),
    react(),
  ],
});
```

Apps must declare `@shipfox/client-shell`, `@shipfox/client-features`, and every route package they
use. The default route packages are:

- `@shipfox/client-agent`
- `@shipfox/client-auth`
- `@shipfox/client-integrations`
- `@shipfox/client-invitations`
- `@shipfox/client-projects`
- `@shipfox/client-workflows`
- `@shipfox/client-workspace-settings`

The generated `shipfox-app.gen.ts` lives in the app. It imports those routes by package name. With
pnpm's isolated linker, the app cannot resolve those imports through `client-features` as transitive
dependencies. `apps/client/package.json` shows the pattern.

## Worked examples

### Upstream workflows

```ts
import {defineClientFeature} from '@shipfox/client-shell';

export const workflowsFeature = defineClientFeature({
  id: 'shipfox.workflows',
  routes: [
    {
      path: '/w/$workspaceSlug/p/$projectSlug/workflows',
      parent: 'projectLayout',
      impl: '@shipfox/client-workflows/routes/workflows-index',
    },
    {
      path: '/w/$workspaceSlug/p/$projectSlug/workflows/$workflowId',
      parent: 'projectLayout',
      impl: '@shipfox/client-workflows/routes/workflow-detail',
    },
  ],
  navigation: [
    {
      id: 'workflows',
      scope: 'project',
      label: 'Workflows',
      to: '/w/$workspaceSlug/p/$projectSlug/workflows',
      order: 200,
    },
  ],
});
```

### Optional SSO settings extension

```ts
import {defineClientFeature} from '@shipfox/client-shell';
import {z} from 'zod';

export const ssoFeature = defineClientFeature({
  id: 'acme.sso',
  routes: [
    {
      path: '/w/$workspaceSlug/settings/sso',
      parent: 'workspaceSettings',
      impl: '@acme/shipfox-sso-client/routes/settings',
    },
  ],
  settingsSections: [
    {
      id: 'sso',
      pathSegment: 'sso',
      label: 'Single sign-on',
      icon: 'keyLine',
      order: 450,
    },
  ],
  configShape: {
    ssoEnabled: z.boolean().default(false),
  },
});
```

This feature uses the settings registry. It does not replace authentication.

### Feature-owned layout

The layout feature declares the parent. Child features contribute routes and local navigation by
using the stable layout id.

```ts
export const adminLayoutFeature = defineClientFeature({
  id: 'acme.admin-layout',
  layouts: [
    {
      id: 'acme.admin-layout',
      path: '/admin',
      parent: 'root',
      impl: '@acme/admin/routes/layout',
    },
  ],
});

export const adminUsersFeature = defineClientFeature({
  id: 'acme.admin-users',
  routes: [
    {
      path: '/admin/users',
      parent: 'acme.admin-layout',
      impl: '@acme/admin-users/routes/users',
    },
  ],
  navigation: [
    {
      id: 'admin.users',
      scope: 'layout',
      layout: 'acme.admin-layout',
      label: 'Users',
      to: '/admin/users',
      minimumRole: 'observer',
    },
  ],
});
```

## Tests and Storybook

`@shipfox/client-shell/testing` owns the test provider stack.

```ts
import {
  ShellProviders,
  createShellDecorator,
  shellDecorator,
} from '@shipfox/client-shell/testing';
```

`ShellProviders` mounts theme, tooltip, a query client, a Jotai store, and feature providers. It does
not mount a router or start network work. Tests may supply `features`, `config`, `queryClient`, and
`store`. Omitted state gets local defaults. `shellDecorator` is the zero-config Storybook helper.
`createShellDecorator(options)` creates a configured decorator.

The shell-owned `AuthRuntime` configures token refresh and API client access. Test providers disable
those effects while keeping the same provider ownership.

Router and end-to-end fixtures use the generated application file. They do not hand-build a second
route tree.

## Prototype findings

ENG-960, ENG-961, and ENG-962 are complete. Their results changed both the final contract and the
prototype code.

### Manifest evaluation

The plugin uses jiti. It loads TypeScript manifests, honors tsconfig paths, and lets the plugin track
the local import graph. The Vite module runner was not selected because the generator needs the same
evaluation path during dev startup and build startup without creating a second Vite environment.

The trade-off is strict Node safety for eager manifest imports. Browser-only initialization belongs
inside components or effects. Route implementation specifiers remain strings, so jiti never loads
those modules.

### Declaration portability

Both the linked iteration gate and packed-tarball gate passed on 2026-07-16. The packed verifier built
and installed a 12-package `@shipfox/*` runtime closure outside the workspace.

The consumer's `tsc --noEmit` accepted typed `Link` and `useSearch` for the added
`/workspaces/$wid/insights` route. It resolved emitted `defineRoute()` declarations, anchor return
types, and the generated `Register` augmentation from `dist`.

The proof found two package issues:

- Internal `#*` imports had to map to `dist` under the default condition.
- Emitted anchor declarations name `@tanstack/router-core`, so the shell needs it directly.

The fixture uses the repository's current `skipLibCheck` setting. A stricter consumer remains a
separate compatibility gate.

### Generated-file workflow

App-local implementation imports stay relative to `shipfox-app.gen.ts`. Package implementations use
public export subpaths. The plugin watches the manifest graph and regenerates without a dev-server
restart. Component-only edits stay in React Fast Refresh.

The external gate proves production builds and default package resolution. It does not start a Vite
development server. Focused plugin tests cover watch and regeneration behavior.

### Behavior matrix

The linked and packed modes proved these behaviors:

1. The added route and explicit override compose in `vite build`.
2. The render probe shows the added route and overriding component.
3. An unapproved collision exits non-zero with the exact path and both feature ids.
4. Feature providers receive the shell query client and store and nest in declared order.
5. Navigation and settings entries render through shell registries in declared order.
6. A contributed config key merges, checks, and remains readable at runtime.

The packed mode also proves consumer type-checking from tarballs with no workspace fallback.

## ENG-938 implementation record

ENG-938 implemented the accepted contract through these slices.

### 1. Graduate the shell

- Make `libs/client/shell` production-owned.
- Keep the pure root and the `/runtime`, `/vite`, and `/testing` exports.
- Move MainLayout, NavBar, project tabs, settings navigation, and provider ownership into the shell.
- Replace the auth stub with shell-owned `AuthRuntime` without changing token wiring.
- Keep the exact validators and committed generator workflow.

### 2. Create the default composition

- Create `libs/client/features` as `@shipfox/client-features`.
- Export `defaultFeatures()` as an explicit array of upstream feature values.
- Keep this package free of application-specific optional feature references.

### 3. Move route ownership

Translate the routes under `libs/client/router/src/routes/**`:

- replace each file-route wrapper with `defineRoute()` options;
- move each implementation to its owning feature package;
- add a Node-safe manifest with full path, anchor, and public implementation specifier; and
- preserve loaders, search, pending, error, and layout behavior.

| Current route family | Target owner |
| --- | --- |
| Auth routes | `@shipfox/client-auth` |
| Invitations | `@shipfox/client-invitations` |
| Workspace, project, and setup layouts | `@shipfox/client-projects` or a shell anchor |
| Runs and workflows | `@shipfox/client-workflows` |
| Workspace settings | `@shipfox/client-workspace-settings` |
| Integration callbacks and settings | `@shipfox/client-integrations` |

The four structural routes become shell anchors. The router package dissolves after the last route
moves.

### 4. Replace hardcoded registries

- Replace ProjectTabs with the navigation registry.
- Replace SettingsNav with the settings registry.
- Preserve params, exact matching, visuals, and order.
- Redirect the settings index to the first sorted section.
- Add parity tests for default entries and targets.

### 5. Move config composition

- Move the root config shape and `loadConfig()` call into the shell.
- Convert feature config shapes into contributions.
- Preserve deployment variable names and the config error screen.
- Add duplicate-key and shared-schema tests.

### 6. Make the app thin

- Reduce `apps/client/src/main.tsx` to styles, app bootstrap, `defaultFeatures()`, and mounting.
- Add the composition plugin to `apps/client/vite.config.ts`.
- Keep app-owned HTML, Vite and Tailwind config, Docker packaging, and static config injection.
- Preserve provider order, loading behavior, errors, and visual output.

### 7. Publish and validate

- Make the shell, default features, and owning feature packages public.
- Add client roots to `publication-closure.json`.
- Add the client Changesets linked group.
- Keep `@shipfox/react-ui` outside the linked group.
- Graduate exact-message, generator, parity, Storybook, browser, linked, and packed-consumer tests.
- Record the client closure and upstream source SHA in the application-release artifact.

## Alternatives rejected

### TanStack virtual file routes

The generator can rewrite routes resolved from `node_modules`, including files in pnpm's store.
Routes also resolve relative to one directory. Competing global `Register` augmentations break
consumer-specific typing.

### Pure type-level route inference

Inferring the composed tree would require custom conditional types over TanStack's route generics.
Build-time collision checks still need tooling, so this removes no required component.

### Runtime-only composition

A boot-time error does not meet the requirement that collisions fail `vite dev` and `vite build`.

### Feature-order precedence

First-wins or last-wins rules hide collisions. Unrelated array edits could change behavior. Every
replacement requires `override: true`.

### Runtime discovery

Runtime loading weakens typing and publication guarantees. Applications use an explicit build-time
feature array.

### JSX registry slots

Arbitrary JSX would move rendering ownership out of the shell and bypass ordering and target checks.

### Namespaced config keys

Config names map to deployment environment variables. Automatic namespacing would break existing
deployment contracts.

## Consequences

### Benefits

- Upstream and external applications use one composition path.
- Route collisions fail before deployment.
- Consumer-local code preserves TanStack typing.
- The shell keeps global providers and navigation behavior consistent.
- Feature packages own route implementations and registry data.
- Packed-consumer checks cover the published surface.

### Costs and limits

- Applications commit generated code and regenerate it after manifest changes.
- Feature manifests and eager provider imports must be Node-safe.
- Navigation targets cannot use the consumer's route union, so the plugin checks strings.
- Provider remount prevention cannot inspect arbitrary React components.
- Overrides carry layout and search compatibility obligations.
- Public client packages must release as a coherent version train.
