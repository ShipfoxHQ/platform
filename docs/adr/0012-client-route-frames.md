# ADR 0012: Client route frames

- **Status:** Accepted.
- **Date:** 2026-08-10.
- **Decision owners:** Client composition maintainers and client architecture.
- **Linear issue:** [ENG-1582](https://linear.app/shipfox/issue/ENG-1582/declare-a-frame-on-every-route).
- **Amends:** [ADR 0001: Public client composition contract](0001-client-composition-contract.md).

## Context

The client shell owns the page canvas, but route implementations previously
left the canvas implicit or used a legacy `layout: 'full-bleed'` value. That
allowed a composed route to silently receive the wrong surface when a page
needed a data or focused layout.

## Decision

Every composed route and feature-owned layout implementation must declare
`staticData.frame` with one of these shell-owned values:

| Frame | Shell surface |
| --- | --- |
| `content` | Centered content up to 1120px. |
| `data` | Full-width data surface with a bounded shell height. |
| `focused` | Centered content up to 640px. |

The generated route module and runtime composition both validate the route
implementation and its frame. Missing or unsupported frames fail with an
actionable diagnostic that names the implementation and composed path.

The legacy `staticData.layout: 'full-bleed'` value is removed. Workflow routes
that need an edge-to-edge surface declare `frame: 'data'` instead.

When matched routes provide more than one frame, the most specific route wins.
An exact layout route can therefore provide a default for its own surface, and
a child route can override that default.

## Consequences

- The route implementation contract is breaking for published shell consumers.
- The shell package requires a major Changeset.
- Generated application files and the shell runtime must be updated together.
- Page-specific canvas and scrolling changes remain owned by the route's
  recomposition work; this decision only makes the shell surface explicit.

## Rejected alternatives

### Default every route to content

An implicit content default hides missing design decisions and can make data
surfaces appear inset or clip their content.

### Keep legacy full-bleed metadata

The legacy value encodes one layout exception instead of the shell's complete
surface vocabulary. Replacing it with `data` keeps the route contract explicit
and leaves room for future frame values.

### Let each page own the canvas

Page-owned canvases duplicate shell behavior and make composition-dependent
navigation and sizing inconsistent across features.
