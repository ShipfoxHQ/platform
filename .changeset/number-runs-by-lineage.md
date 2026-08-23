---
"@shipfox/api-workflows": patch
---

Numbers workflow runs by the workflow lineage id. `runWorkflow` passes the definition's `workflowId` as the run's `definition_id`, so counters and the `(definition_id, number)` uniqueness key index on the lineage. Existing run values stay the same because lineage ids equal row ids for every existing definition.
