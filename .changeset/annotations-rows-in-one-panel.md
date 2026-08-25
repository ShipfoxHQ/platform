---
'@shipfox/client-workflows': patch
'@shipfox/client-ui': minor
---

Render run annotations as rows of the annotations panel instead of bordered cards inside it.

Each row is headed by the block the emitting step named, or by its job when the server minted
the context from a failure, and its provenance line is bounded rather than sprawling. Job
diagnostics with no execution record lead the list and count toward its total.

`AnnotationCard` draws no frame of its own and exports the style glyph and tone maps it uses.
