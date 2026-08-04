# @shipfox/client-logs

## 14.0.1

### Patch Changes

- 88bf8e8: Migrates the shell, auth, secrets, logs, workspace-settings, config, and invitations
  surfaces to semantic spacing roles and brings them under the `no-raw-spacing` Biome
  plugin. Adds shared menu-surface and edge-specific panel roles for existing spacing
  contracts.
- Updated dependencies [88bf8e8]
- Updated dependencies [6aa6c7a]
- Updated dependencies [5c56ba6]
  - @shipfox/react-ui@1.0.0

## 14.0.0

### Patch Changes

- Updated dependencies [baa7594]
- Updated dependencies [f8a98cb]
- Updated dependencies [1267eb3]
- Updated dependencies [b2d4550]
  - @shipfox/react-ui@0.5.0

## 13.0.0

### Patch Changes

- f78740d: Remove Unicode dash punctuation from package prose and source comments.
- Updated dependencies [f78740d]
- Updated dependencies [9969937]
- Updated dependencies [6adc228]
  - @shipfox/api-logs-dto@12.0.0
  - @shipfox/react-ui@0.4.0

## 12.0.1

### Patch Changes

- 57e69d8: Preserve and display Claude tool-use summaries on their matching tool-call rows.
- Updated dependencies [57e69d8]
  - @shipfox/api-logs-dto@10.2.0

## 11.0.0

### Patch Changes

- 38a4635: Names Claude tool-result rows from their matching tool calls and marks unmatched results explicitly.
  - @shipfox/api-logs-dto@9.0.2
  - @shipfox/client-api@6.0.1
  - @shipfox/react-ui@0.3.7

## 6.0.2

### Patch Changes

- Updated dependencies [4b85404]
- Updated dependencies [102c5f4]
  - @shipfox/api-logs-dto@9.0.2
  - @shipfox/react-ui@0.3.7

## 6.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
- Updated dependencies [3f8f1cb]
  - @shipfox/api-logs-dto@9.0.1
  - @shipfox/client-api@6.0.1
  - @shipfox/react-ui@0.3.6

## 6.0.0

### Patch Changes

- Updated dependencies [24be269]
- Updated dependencies [c02ac42]
  - @shipfox/client-api@6.0.0
  - @shipfox/api-logs-dto@5.0.0
  - @shipfox/react-ui@0.3.5

## 5.0.0

### Major Changes

- ee9d641: Converges step-log snapshots on package-owned camelCase records validated at the transport boundary.

## 4.0.0

### Patch Changes

- Updated dependencies [6b4a575]
- Updated dependencies [781a45b]
  - @shipfox/client-api@4.0.0

## 3.0.1

### Patch Changes

- ffc7fc9: Republishes the affected release set after recovering package publication.
- Updated dependencies [ffc7fc9]
  - @shipfox/react-ui@0.3.5

## 3.0.0

### Patch Changes

- Updated dependencies [cb58afe]
  - @shipfox/react-ui@0.3.4

## 2.0.0

### Patch Changes

- Updated dependencies [1820feb]
  - @shipfox/react-ui@0.3.3

## 1.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/api-logs-dto@5.0.0
  - @shipfox/client-api@1.0.0
  - @shipfox/react-ui@0.3.2

## 0.2.0

### Minor Changes

- 3d064b8: Publishes the client runtime closure with shell, feature, route, Vite, and testing contracts.

### Patch Changes

- Updated dependencies [3d064b8]
  - @shipfox/client-api@0.2.0

## 0.1.2

### Patch Changes

- Updated dependencies [c18d624]
  - @shipfox/react-ui@0.3.1

## 0.1.1

### Patch Changes

- Updated dependencies [1b0d344]
  - @shipfox/api-logs-dto@2.0.0
  - @shipfox/client-api@0.0.1
  - @shipfox/react-ui@0.3.0

## 0.1.0

### Minor Changes

- b83d31a: Renders agent session log records inline with process output so agent steps show prompts, assistant messages, thinking, tool activity, and failure anchors.
- f104ff2: Add `@shipfox/client-logs`: the record components for the step-log read stream, composing the `@shipfox/react-ui` log primitives. This covers every process and system record (`output`, `group_start`/`group_end`, `end`, `gap`, `capped`, `runner_lost`); `agent_session` is rendered by the agent-sessions surface.
  - `buildLogTree(records)` is a pure transform that reconstructs the group tree from the flat record list. `group_end` closes the matching `group_id` (so a `group_start` dropped under gap/backlog pressure does not mis-nest), record dispatch is an exhaustive switch, and each group node carries a precomputed `hasError` (a `runner_lost` in its subtree, a genuine failure; `stderr` is a channel, not an error) and subtree line count.
  - `OutputLogRow` renders stdout/stderr (stderr gets a subtle left channel rule, not a background tint), `LogGroup` is a collapsible disclosure with running/duration/incomplete affordances and an inset error bar, the system markers render as timeline rows, and `LogView` is the top-level dispatcher with an empty state. Reviewed in a package-local Storybook captured by Argos (`client-logs`).
  - `@shipfox/api-logs-dto` now measures UTF-8 byte length with `TextEncoder` instead of `node:buffer`, so this shared record contract is browser-safe for the client log viewer. Behavior is identical.
  - `@shipfox/react-ui` gains two shared formatters in `utils`: `formatBytes` (new) and `formatDuration` (an ms-span, sub-second sibling to the existing `humanDuration`), so `client-logs` and future packages share one implementation instead of re-rolling them.

- 0c6373a: Adds a React Query data layer for step logs that maps inline and presigned reads into one polling snapshot.

### Patch Changes

- dc3e434: Show logs inline under the active or selected workflow step attempt, including missing-stream retry for running attempts and stale-log retry states.
- Updated dependencies [43d7996]
- Updated dependencies [14e0bea]
- Updated dependencies [a56748d]
- Updated dependencies [9018f0b]
- Updated dependencies [7fdfd72]
- Updated dependencies [2a3193f]
- Updated dependencies [f104ff2]
- Updated dependencies [7341569]
- Updated dependencies [68e4022]
- Updated dependencies [f92122b]
- Updated dependencies [4207772]
- Updated dependencies [d49ee4c]
- Updated dependencies [e4c6abf]
- Updated dependencies [2883ab4]
- Updated dependencies [5d0676a]
- Updated dependencies [a35c2dc]
- Updated dependencies [58f7aef]
- Updated dependencies [5264a22]
- Updated dependencies [9674879]
- Updated dependencies [225c9a5]
- Updated dependencies [bf8319f]
- Updated dependencies [24f131b]
- Updated dependencies [bb2a7bc]
- Updated dependencies [5eb06d0]
- Updated dependencies [4e13e5f]
- Updated dependencies [e92150d]
- Updated dependencies [8037501]
- Updated dependencies [0fb6018]
- Updated dependencies [c27a1ed]
- Updated dependencies [b8e49ff]
- Updated dependencies [8037501]
- Updated dependencies [6c0da64]
- Updated dependencies [07f8ff8]
- Updated dependencies [e457582]
- Updated dependencies [8b5c905]
- Updated dependencies [f849131]
- Updated dependencies [94bdcc5]
- Updated dependencies [a34c8ea]
- Updated dependencies [2933c33]
- Updated dependencies [8ac4bf4]
- Updated dependencies [3a0be6b]
- Updated dependencies [d42baf4]
- Updated dependencies [8037501]
- Updated dependencies [54bb8a3]
- Updated dependencies [f711e18]
  - @shipfox/react-ui@0.3.0
  - @shipfox/api-logs-dto@0.1.0
  - @shipfox/client-api@0.0.1
