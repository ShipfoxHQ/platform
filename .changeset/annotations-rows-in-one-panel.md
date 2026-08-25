---
'@shipfox/client-workflows': patch
'@shipfox/client-ui': minor
---

Render run annotations as rows of the annotations panel rather than bordered cards inside it.

Each annotation was a `Callout` inside the panel body: a second hairline, a second radius, a
second shadow stack, and a fill one ramp step lighter than the panel behind it. Inline code in a
body painted the same token as that fill, so a code chip was invisible against the card holding
it, and the nested padding put the first character of a code fence 66px from the panel edge.

Annotations are now cells of one panel, divided by the panel's own hairlines. `AnnotationCard`
renders content and no frame, and exports the style glyph and tone maps it uses so counts and
summaries name severity from one source. The clamp fade is a mask rather than a painted gradient,
so it no longer assumes the color behind it.

The row heading is now the block the emitting step named, falling back to the job when the server
minted the key from a failure, so a `failure:step:<uuid>` is never the loudest text on the row.
The provenance line is held to one line with the full value in its title, and job diagnostics with
no execution record render in the same row as everything else and count toward the list total.
