---
"@shipfox/runner-agent": patch
---

Builds the Claude SDK thinking and effort options from the selected model's capabilities instead of always sending adaptive thinking with an effort level. Haiku 4.5 and Sonnet 4.5 steps use budget-based extended thinking without effort, capped at the 31,999-token ceiling those models accept. Opus 4.5 keeps budget thinking with a supported effort. Adaptive models keep adaptive thinking. Unsupported effort levels now fall back to the nearest supported level at or below the request, and dotted managed-catalog model IDs resolve to their family capabilities. Legacy models now reserve a thinking-token budget per turn, so steps on those models can cost more and take longer than before.
