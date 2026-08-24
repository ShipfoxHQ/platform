---
"@shipfox/client-workflows": minor
"@shipfox/client-projects": minor
---

Adds the Run from branch dialog on the project Workflows tab: pick a branch or tag, a workflow file at that ref, and a trigger, then start a dev run from the pinned commit. The ref resolves on blur through the at-ref listing, invalid files cannot be selected, manual triggers edit the inputs prefilled from the trigger's `with` block, and a moved ref re-lists the files for confirmation. Integration-sourced triggers are disabled until event replay lands. The source strip gains an actions slot for the button.
