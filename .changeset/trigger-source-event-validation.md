---
"@shipfox/api-definitions": minor
---

Validates trigger sources and events at sync: unknown connection slugs and unlisted provider events warn, and wrong Shipfox-minted events make the trigger inert.

Replaces the `invalid-cron-event` diagnostic with `invalid-trigger-event`; consumers matching on the old code must migrate, and existing non-canonical trigger events become inert on their next sync.
