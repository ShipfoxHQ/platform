# External composition findings

The graduated fixture uses the production `@shipfox/client-features` default composition and the
complete recursive client runtime closure from `publication-closure.json`. The external feature is
application-local, so route implementations and generated types cross the same package boundary as
a downstream distribution.

## Contract proof

The fixture proves that:

- every default feature contributes its production routes to the generated application module;
- an application-local settings route is added and the default login route is explicitly replaced;
- two application-local providers receive the shell query client and Jotai store, then nest in
  declaration order;
- application navigation and settings data render through the shell-owned registries;
- a feature-owned layout receives deterministic navigation from child feature contributions;
- the external config fragment is required, merged, and readable by both providers and the route;
- the generated router types an application-local `Link` and `useParams` call; and
- the unapproved login collision fails with the exact normative diagnostic.

## Distribution isolation

Packed mode builds declarations and runtime files before creating tarballs, then productionizes a
temporary copy of each package manifest like `release:publish` so source conditions cannot leak into
the consumer artifact or mutate the worktree. The fixture declares only the documented client
composition roots, plus `@shipfox/client-config` for its own config proof, while `file:` overrides
keep every first-party runtime dependency in the full closure on its local tarball. It rejects
registry-resolved Shipfox packages and `workspace:` ranges across every installed closure package,
checks that generated package imports are direct fixture dependencies, and confirms full-closure
runtime imports resolve through `dist` under default and `development` conditions while TypeScript
checks every packed declaration graph. Linked mode keeps the
minimal-consumer, generated-route, behavior, collision, and type checks for faster local iteration;
its workspace packages intentionally resolve `development` to source.

## Collision diagnostic

The rejected build must return this diagnostic and a non-zero status:

```text
Route "/auth/login" is contributed by both features "shipfox.auth" and "fixture.unapproved-collision". Set override: true to replace it explicitly.
```
