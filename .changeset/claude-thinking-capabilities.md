---
"@shipfox/runner-agent": patch
---

Claude steps now build their thinking and effort options from the selected model's capabilities instead of always sending adaptive thinking with an effort level. Haiku 4.5 and Sonnet 4.5 steps use budget-based extended thinking without an effort parameter, and Opus 4.5 keeps budget thinking with a supported effort, so these steps no longer fail with an HTTP 400. Legacy models now reserve a thinking-token budget per turn and can cost more and take longer than before.
