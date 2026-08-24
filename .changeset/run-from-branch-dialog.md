---
"@shipfox/client-workflows": minor
"@shipfox/client-projects": minor
---

Adds the Run from branch dialog to the project Workflows tab. Pick a branch or tag, a workflow file, and a trigger, then start a dev run from the pinned commit. Invalid files cannot be selected, manual triggers edit inputs prefilled from the trigger's `with` block, and a moved ref re-lists the files for confirmation. Integration-sourced triggers remain disabled until event replay lands.
