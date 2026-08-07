# Architecture decision record 0011: Semantic spacing layer

- **Status:** Accepted.
- **Date:** 2026-08-07.
- **Decision owners:** Design system and client architecture.
- **Linear issue:** [ENG-1465](https://linear.app/shipfox/issue/ENG-1465/record-the-adr-for-the-semantic-spacing-layer).
- **Implementation evidence:** [ENG-1462](https://linear.app/shipfox/issue/ENG-1462/add-semantic-spacing-tokens-to-the-shared-css), [ENG-1464](https://linear.app/shipfox/issue/ENG-1464/migrate-appsdocs-to-semantic-spacing-first-conversion-decides-the-p), and [ENG-1469](https://linear.app/shipfox/issue/ENG-1469/migrate-libsclientworkflows-to-semantic-spacing).

## Context

**Raw numeric spacing hides composition intent.** `gap-16` says how much space exists. It does not say why the space exists.

The repository sets `--spacing: 1px`. Numeric Tailwind utilities therefore equal pixel values. The same relationship already appears at several unrelated sizes.

The migration measured 666 in-scope uses across `libs/client` and `apps/docs`. The migration excluded stories.

| Population | Uses |
| --- | ---: |
| Gap | 370 |
| Padding | 242 |
| Margin | 54 |
| **Total** | **666** |

The evidence supports separate axes. Seventeen of eighteen sites that set both padding axes use different values. By contrast, `gap-x` and `gap-y` account for 14 of 370 gap uses.

The first migration was intentionally delayed until a real surface could test the taxonomy. The `apps/docs` conversion answered the two open questions that the spec could not answer in advance.

## Decision

**Product composition uses semantic spacing roles.** The role names describe relationships and surfaces. Converted call sites normalize to one value per role, even when that moves pixels.

### Gap uses the relationship axis

Gap roles describe how two things relate. The core roles are:

| Role | Default value | Meaning |
| --- | ---: | --- |
| `gap-tight` | 4px | Two things that read as one object. |
| `gap-inline` | 8px | Distinct items on one line that belong together. |
| `gap-cluster` | 12px | Control groups and compact chrome. |
| `gap-group` | 16px | Rows within a block or fields within a form. |
| `gap-section` | 24px | Blocks within a page. |
| `gap-region` | 32px | Top-level page regions. |

`gap-x-*` and `gap-y-*` variants use the same role values when a grid needs different column and row rhythm. They remain explicit axis variants instead of making a container read as two relationships.

### Padding uses the container axis

Padding roles describe the surface that owns the inset. The initial core roles are:

| Role | Default value | Meaning |
| --- | ---: | --- |
| `p-tight` | 8px | Small surfaces, chips, menu items, and dense inline containers. |
| `px-row` / `py-row` | 16px / 12px | Table rows, list rows, and log rows. |
| `p-panel-compact` | 16px | Dense cards and nested panels. |
| `p-panel` | 24px | Default card and panel padding. |
| `px-frame` / `py-frame` | 24px / 32px | The application shell content frame. |

Padding and gap have separate role families. Their values overlap on day one by design. Padding tokens are value aliases of the gap scale, not shared relationship names.

The families can diverge under compact density. Padding compounds with nesting depth, while a gap adds once.

The migration can add a role for a stable surface contract. `p-menu-surface`, `pb-panel`, and `px-tight` are examples of this extension. Such roles remain explicit and semantic.

### Bounded composition roles

Numeric margins are not a third general-purpose scale. A migration moves spacing to the parent gap or removes it when the margin has no independent meaning.

Some composition contracts cannot move to the parent without changing ownership or alignment. Those contracts use bounded roles:

- `my-region`, `mt-page`, and `ms-inline` express named composition relationships.
- The repository reserves `-mt-inline`, `-mr-inline`, and `-mx-inline` for optical touch-target alignment.

These roles do not reopen a raw numeric margin vocabulary.

### The implementation is density-capable

The shared CSS stores real spacing values in root custom properties. Explicit `@utility` rules reference those properties.

The standalone docs app keeps matching role definitions in its stylesheet.

An ancestor with `data-density="compact"` overrides the custom properties. Utility regeneration is not required. The runtime can swap density from day one.

No density toggle, persistence, or user setting ships with this decision. Density capability is an implementation seam, not a product feature.

### `react-ui` internals are a permanent boundary

`libs/shared/react/ui` component internals remain numeric. They are Layer 3 component tokens, not composition roles.

The boundary is deliberate:

- Consuming `react-ui` means using semantic roles.
- Editing `react-ui` internals means defining the numeric component scale.

This exclusion is permanent for this decision. It is not an unfinished migration. Ordinary component stories and internal implementation details remain outside the composition-role migration. The dedicated semantic-spacing preview exercises the token layer.

### Sizing is a separate design problem

Sizing utilities such as `w-`, `h-`, `min-h-`, and `size-` remain numeric. The 763 in-scope sizing uses share `--spacing`, but they describe component dimensions rather than composition relationships.

Button heights and row heights need their own size scale. Spacing migration does not decide that scale or change those utilities.

### Enforcement follows package boundaries

The `no-raw-spacing` Biome plugin rejects numeric spacing utilities and the asymmetric `p-row` and `p-frame` forms in direct `className` string literals. Each migrated package adds its own include glob in the same change as its conversion.

Zero values and arbitrary values remain legal. Use zero for explicit resets. Reserve arbitrary values for a fixed optical offset, control-space reservation, or asymmetric contract without a semantic role.

Stories, tests, generated files, and other documented exclusions do not participate in the migration. The file-by-file migration and an independent raw-spacing audit cover dynamic class construction that the plugin cannot inspect.

## Evidence from the first conversion

The `apps/docs` visual review kept `p-tight` at 8px. The 14 sites that used 4px did not justify a new `p-control` role.

The review also kept `gap-cluster` at 12px and `gap-group` at 16px. The markup made compact control relationships distinct from rows within cards and form blocks.

The real markup required the bounded composition roles listed above. This record therefore captures the landed boundary instead of the pre-migration prediction.

## Consequences

- Reviewers can judge spacing from the role and its owner instead of measuring a raw number.
- Normalization intentionally moves pixels. Each package needs its own visual review.
- Gap and padding can take different compact-density values without changing call-site intent.
- The numeric and semantic vocabularies coexist across a deliberate package boundary.
- A future density feature must include component sizing and row padding. It must reopen both the `react-ui` and sizing exclusions before it ships.
- The lint is strongest for direct class literals. Migration reviews still need a raw-spacing audit for dynamic expressions and fixed optical exceptions.

## Rejected alternatives

### Rename the numeric scale

Renaming `gap-8` to a size label would preserve the numeric vocabulary and add no role meaning. It would create churn without a density or drift benefit.

### Share one scale between gap and padding

One scale would force asymmetric surfaces to use names such as `px-group py-cluster`. That wording describes two relationships instead of one container.

### Migrate `react-ui` internals with product call sites

Component internals own button, row, and control dimensions. Mixing them with composition roles would erase the boundary between consuming a component and editing its implementation.

### Migrate sizing with spacing

The shared `--spacing` primitive does not make component height a spacing decision. Combining the migrations would create a size scale without its own design review.

### Split `p-tight` or collapse the gap pair

The first real visual review did not justify `p-control` at 8px and `p-tight` at 4px. It also found `gap-cluster` and `gap-group` readable from markup, so the six-role gap taxonomy remains.

### Ship a density feature now

The token layer can support a future density mode without shipping a setting. A feature that changes gaps but not button or row sizes would provide an incomplete density model.
