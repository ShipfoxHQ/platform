---
"@shipfox/react-ui": minor
"@shipfox/client-ui": minor
"@shipfox/client-workflows": minor
---

Render run annotations in the run workspace. `AnnotationCard` gains an optional context title, provenance, and action, and bounds a long body behind a disclosure. The run's Annotations section is now the only surface that renders an annotation body, ranked by severity and then emission order, with the job page linking to it through a bounded count chip.

`Markdown` tables now size to their content instead of stretching to the container, so a two-column table no longer puts a cell the width of the page away from its row header.
