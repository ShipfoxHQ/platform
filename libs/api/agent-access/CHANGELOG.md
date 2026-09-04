# @shipfox/api-agent-access

## 21.1.0

### Minor Changes

- a0791a3: Adds a `get_step_logs` tool that reads a log tail for one exact workflow step attempt, or the first failed step attempts in a workflow run.
- 661868a: Adds bounded workflow traversal tools to Agent Access.
- 6d94ffc: Preserves structured workflow values in lazy Agent Access diagnostics.

### Patch Changes

- Updated dependencies [a0791a3]
- Updated dependencies [661868a]
- Updated dependencies [01af160]
- Updated dependencies [8a98a87]
- Updated dependencies [6d94ffc]
- Updated dependencies [6fac62f]
  - @shipfox/api-agent-access-dto@21.1.0
  - @shipfox/api-workflows-dto@21.1.0

## 21.0.0

### Minor Changes

- f3df1e5: Add bounded Agent Access trigger-event detail and facet discovery tools.

### Patch Changes

- Updated dependencies [12f7b10]
- Updated dependencies [e225f5e]
- Updated dependencies [879f227]
- Updated dependencies [cffa62d]
- Updated dependencies [5886bf2]
- Updated dependencies [b5d02d1]
- Updated dependencies [32e9fa0]
- Updated dependencies [f3df1e5]
  - @shipfox/api-workflows-dto@21.0.0
  - @shipfox/api-definitions-dto@21.0.0
  - @shipfox/api-projects-dto@21.0.0
  - @shipfox/api-agent-access-dto@21.0.0
  - @shipfox/api-triggers-dto@21.0.0

## 20.4.0

### Minor Changes

- 0b32d1a: Remove personal access token support from agent access.

### Patch Changes

- Updated dependencies [9a66057]
- Updated dependencies [0b32d1a]
  - @shipfox/api-workflows-dto@20.4.0
  - @shipfox/api-auth-context@20.4.0

## 20.3.0

### Minor Changes

- 47f6024: Add bounded paged agent-access tools for project, definition, run, annotation, and trigger-event reads.

### Patch Changes

- Updated dependencies [813a284]
- Updated dependencies [47f6024]
- Updated dependencies [da6fbb8]
  - @shipfox/api-workflows-dto@20.3.0
  - @shipfox/api-agent-access-dto@20.3.0
  - @shipfox/annotations-dto@20.3.0
  - @shipfox/api-definitions-dto@20.3.0

## 20.2.0

### Minor Changes

- ba481d6: Add the dormant agent-access MCP gateway foundation and shared tool response contracts.

### Patch Changes

- Updated dependencies [ba481d6]
  - @shipfox/api-agent-access-dto@20.2.0
  - @shipfox/node-fastify@0.4.4
  - @shipfox/api-auth-context@20.2.0
  - @shipfox/node-module@1.0.9
