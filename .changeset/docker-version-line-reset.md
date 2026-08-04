---
"@shipfox/docker": major
---

Moves `@shipfox/docker` onto a version line that is free on the public registry.

This package carries the same split lineage as `@shipfox/react-ui`. An earlier lineage
published `1.0.0` through `1.2.1` between 2025-06-27 and 2026-03-04. The current lineage
restarted at `0.1.0` on 2026-07-11 and has reached `0.1.5`, so every remaining version up
to `1.2.1` is a version that `changeset publish` would skip without reporting a failure.

Nothing is broken today, because the current lineage has not yet reached the taken range.
The release moves the package to `2.0.0` so it cannot walk into the collision later.
Every workspace consumer depends on this package through `workspace:*`, so no dependency
range changes. No source or exported behaviour changed.
