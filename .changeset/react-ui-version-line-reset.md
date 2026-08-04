---
"@shipfox/react-ui": major
---

Moves `@shipfox/react-ui` onto a version line that is free on the public registry.

An earlier lineage of this package already occupies every version from `0.1.0` up to
`0.33.1` on npm. The current lineage restarted at `0.1.1` and reached `0.3.7`, so the
`0.4.0` and `0.5.0` releases resolved to versions that were already taken. `changeset
publish` treats an already-published version as a no-op and skips it, so those two
releases never reached the registry and no error was reported.

The practical failure is that consumers resolve a stale tarball. `@shipfox/client-ui`
pins `@shipfox/react-ui: 0.5.0`, but the `0.5.0` on npm predates the `callout` and
`markdown` components and predates the `exports` map entirely. Any consumer importing
`@shipfox/react-ui/callout` or `@shipfox/react-ui/markdown` fails to resolve the
subpath under Node, Vitest, and Vite.

This release moves the package to `1.0.0`, which is above the whole abandoned lineage
and cannot collide again. Consumers must repin to `^1.0.0`. No source, component, or
export changed; the subpath export map is the one already shipped in `0.3.7`.
