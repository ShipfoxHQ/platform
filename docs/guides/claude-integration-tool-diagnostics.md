# Claude integration-tool diagnostics

This guide explains how to investigate a Claude agent step that finishes
without the expected integration call. It applies to runner logs, integration
gateway audit logs, and the workflow step-attempt response.

## Find the runner records

Open the Dash0 Query Builder and select the Logging view. Add these filters to
find the manifest and outcome records for one failed attempt:

| Record | Filters |
| --- | --- |
| Effective manifest | `event` = `runner.agent_claude_tool_manifest`, `jobExecutionId` = `<job execution ID>`, `stepId` = `<step ID>`, `attempt` = `<attempt>` |
| Invocation outcome | `event` = `runner.agent_claude_tool_outcome`, `jobExecutionId` = `<job execution ID>`, `stepId` = `<step ID>`, `attempt` = `<attempt>` |

The manifest records the materialized integration tool IDs, authorized catalog
names, expected Claude SDK names, and any omission reason. The outcome records
the exact Claude SDK names observed at init, plus the integration names Claude
advertised, attempted, or returned as failed.

The runner uses these bounded failure phases:

| `failurePhase` | Meaning |
| --- | --- |
| `requested_tool_omitted` | A requested tool was omitted before the model could call it. Inspect `omissions[].reason`. |
| `advertised_tool_not_invoked` | Claude received the tool name but emitted no call for it. |
| `integration_tool_invocation_failed` | Claude attempted the tool and the tool result failed, or the harness failed after the attempt. |
| `output_gate_failed` | The harness completed without all declared structured outputs. |

The omission reasons identify the boundary that dropped a requested tool:
`catalog_resolution`, `runner_capability`, `allowlist`, `connection_policy`,
or `sdk_registration`.

## Join the gateway audit

Search for the `integration tool call audited` log using the same
`jobExecutionId`. The gateway audit uses `currentStepId` and
`currentStepAttempt` for the step fields. Compare its `toolId`, `outcome`, and
`errorCode` with `attemptedIntegrationToolNames` and
`failedIntegrationToolNames` in the runner outcome.

No gateway audit record means the model did not reach the authorized gateway
call. A gateway record with `outcome` `tool-error` or `exception` means the
model did call the tool, so investigate the integration result or provider
boundary.

## Check the persisted step result

Open the workflow run detail for the same job execution, step, and attempt.
Check these fields together:

- `error.code` contains the runner failure phase when the runner returned a
  classified invocation failure.
- `gate_result` is the server-evaluated workflow gate result.
- `response` and `outputs` show the safe harness result fields returned to the
  workflow API.

`outputGate` in the runner outcome describes the declared structured-output
contract. `gate_result` is the separate server-side workflow gate. Read both
when a step exits with code zero but the workflow still fails its gate.

Do not use these records to retrieve tool schemas, arguments, responses, or
credentials. The runner diagnostic fields contain only bounded counts, names,
IDs, omission reasons, and gate status.

For Dash0's filter-based log queries, see the [Query Builder log analysis
guide](https://www.dash0.com/docs/dash0/telemetry/query-data/query-builder/analyze-logs).
