---
'@shipfox/client-workflows': patch
'@shipfox/client-ui': major
---

Remove the `?annotation=<id>` deep link and its selected-row scroll and focus behaviour from the
workflow run page. No surface ever produced that URL, so the state was unreachable.

`AnnotationCard` no longer accepts an `id` prop, which existed only as that deep link's scroll
target.
