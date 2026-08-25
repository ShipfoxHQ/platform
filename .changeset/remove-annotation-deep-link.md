---
'@shipfox/client-workflows': patch
'@shipfox/client-ui': minor
---

Remove the annotation deep link and its selected-row state.

`?annotation=<id>` was parsed, carried across navigation, and stripped in three places, but no
surface in the product ever wrote it. No link, no redirect, no server-emitted URL. The only way
to reach the state was to hand-write a URL containing an annotation id the product never shows
you, so the selected row, its scroll-and-focus effect, and the render window it forced open were
unreachable.

Deleting it also removes two side effects that only fired from that unreachable state: synthetic
job diagnostics were hidden while an annotation was selected, and the parameter counted toward
"filters are active", which changed which empty state the reader got.

`AnnotationCard` drops its `id` prop, which existed to be that deep link's scroll target.
