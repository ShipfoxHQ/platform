---
'@shipfox/react-ui': minor
---

Truncate a `Select` value instead of letting it wrap out of the trigger.

Selected values are frequently names a user authored, such as a job or a workflow, and nothing
bounds their length. `SelectValue` had no truncation, so a long name wrapped to a second line and
spilled outside the trigger's fixed height. The trigger also now grows to the touch minimum where
the pointer is coarse, matching the buttons it sits beside.

Adds a `pt-panel-compact` utility, so a top padding can follow the density scale rather than
freezing at 16px, and moves the Markdown render-guard fallback onto the code surface the rendered
fences already use.
