# @shipfox/runner-agent

## 0.2.13

### Patch Changes

- Updated dependencies [0d3c2e3]
- Updated dependencies [5c100d6]
- Updated dependencies [ca91dc3]
- Updated dependencies [67aab38]
  - @shipfox/api-agent-dto@13.1.0
  - @shipfox/api-workflows-dto@13.1.0
  - @shipfox/runner-protocol@0.2.19
  - @shipfox/runner-execution@0.1.26

## 0.2.12

### Patch Changes

- Updated dependencies [af6b31e]
  - @shipfox/api-runners-dto@13.0.0
  - @shipfox/api-workflows-dto@13.0.0
  - @shipfox/runner-protocol@0.2.18
  - @shipfox/runner-execution@0.1.25

## 0.2.11

### Patch Changes

- Updated dependencies [7f186cf]
  - @shipfox/runner-execution@0.1.24

## 0.2.10

### Patch Changes

- Updated dependencies [4df5e37]
  - @shipfox/api-workflows-dto@12.7.0
  - @shipfox/runner-execution@0.1.23
  - @shipfox/runner-protocol@0.2.17

## 0.2.9

### Patch Changes

- Updated dependencies [53b87f0]
  - @shipfox/api-workflows-dto@12.6.0
  - @shipfox/runner-execution@0.1.22
  - @shipfox/runner-protocol@0.2.16

## 0.2.8

### Patch Changes

- Updated dependencies [5b1838c]
  - @shipfox/api-workflows-dto@12.5.0
  - @shipfox/runner-execution@0.1.21
  - @shipfox/runner-protocol@0.2.15

## 0.2.7

### Patch Changes

- Updated dependencies [9e16946]
- Updated dependencies [4fa8526]
  - @shipfox/api-runners-dto@12.4.0
  - @shipfox/runner-protocol@0.2.14
  - @shipfox/runner-execution@0.1.20

## 0.2.6

### Patch Changes

- Updated dependencies [4b0731e]
- Updated dependencies [3e7fe76]
  - @shipfox/api-workflows-dto@12.3.0
  - @shipfox/expression@2.2.0
  - @shipfox/runner-execution@0.1.19
  - @shipfox/runner-protocol@0.2.13

## 0.2.5

### Patch Changes

- Updated dependencies [78b771c]
- Updated dependencies [ce0984d]
  - @shipfox/api-runners-dto@12.2.0
  - @shipfox/expression@2.1.0
  - @shipfox/api-workflows-dto@12.2.0
  - @shipfox/runner-protocol@0.2.12
  - @shipfox/node-opentelemetry@0.6.4
  - @shipfox/runner-execution@0.1.18
  - @shipfox/api-agent-dto@12.2.0

## 0.2.4

### Patch Changes

- Updated dependencies [312a137]
  - @shipfox/api-workflows-dto@12.1.0
  - @shipfox/runner-execution@0.1.17
  - @shipfox/runner-protocol@0.2.11

## 0.2.3

### Patch Changes

- Updated dependencies [ee2ce67]
- Updated dependencies [7c4116e]
- Updated dependencies [3d91d1d]
- Updated dependencies [f7939c7]
- Updated dependencies [045895c]
- Updated dependencies [dea1ffd]
- Updated dependencies [adf07e7]
- Updated dependencies [3f781ee]
- Updated dependencies [285fff2]
- Updated dependencies [e44a279]
- Updated dependencies [4d246d4]
- Updated dependencies [28daafe]
- Updated dependencies [4444079]
- Updated dependencies [54c820e]
- Updated dependencies [35a42bd]
- Updated dependencies [d77baaa]
- Updated dependencies [41d558c]
- Updated dependencies [032d316]
- Updated dependencies [c2a8e54]
- Updated dependencies [cb0abfa]
- Updated dependencies [ee2ce67]
  - @shipfox/api-workflows-dto@12.0.0
  - @shipfox/api-agent-dto@12.0.0
  - @shipfox/expression@2.0.0
  - @shipfox/runner-execution@0.1.16
  - @shipfox/runner-protocol@0.2.10
  - @shipfox/api-runners-dto@12.0.0

## 0.2.2

### Patch Changes

- Updated dependencies [71d9ba4]
  - @shipfox/expression@1.2.1

## 0.2.1

### Patch Changes

- Updated dependencies [c9a188d]
- Updated dependencies [8678943]
- Updated dependencies [6be5a54]
  - @shipfox/api-runners-dto@10.2.0
  - @shipfox/runner-protocol@0.2.9
  - @shipfox/runner-execution@0.1.15

## 0.2.0

### Minor Changes

- 35fb890: Adds a `pi-extensions` subpath export so image builds can verify the deployed Pi extension closure without loading the runtime environment.

## 0.1.14

### Patch Changes

- e5f7cfe: Keep Claude agent steps isolated from repository-controlled policy and fail when the requested permission mode is downgraded. Repository settings, hooks, MCP discovery, and automatic memory are no longer loaded; `CLAUDE.md` and `AGENTS.md` are read only from the working directory, capped at 64 KiB, and appended as advisory prompt text without parent walking or `@path` expansion. This intentionally loosens behavior for repositories that used project settings to restrict CI agents.
- Updated dependencies [22bf8a2]
- Updated dependencies [a713231]
- Updated dependencies [43ce975]
- Updated dependencies [e9280fc]
- Updated dependencies [837bf5d]
- Updated dependencies [3f5610b]
  - @shipfox/api-workflows-dto@10.0.0
  - @shipfox/expression@1.2.0
  - @shipfox/api-agent-dto@10.0.0
  - @shipfox/api-runners-dto@10.0.0
  - @shipfox/runner-execution@0.1.14
  - @shipfox/runner-protocol@0.2.8
  - @shipfox/config@1.2.4
  - @shipfox/node-egress-guard@0.1.3
  - @shipfox/node-opentelemetry@0.6.3

## 0.1.13

### Patch Changes

- Updated dependencies [4acf8bc]
- Updated dependencies [4425c6d]
- Updated dependencies [6017e56]
  - @shipfox/runner-protocol@0.2.7
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/api-workflows-dto@9.3.0
  - @shipfox/runner-execution@0.1.13

## 0.1.12

### Patch Changes

- Updated dependencies [4b85404]
  - @shipfox/api-agent-dto@9.0.2
  - @shipfox/api-runners-dto@9.0.2
  - @shipfox/api-workflows-dto@9.0.2
  - @shipfox/config@1.2.4
  - @shipfox/expression@1.1.5
  - @shipfox/node-egress-guard@0.1.3
  - @shipfox/node-opentelemetry@0.6.2
  - @shipfox/runner-execution@0.1.12
  - @shipfox/runner-protocol@0.2.6

## 0.1.11

### Patch Changes

- Updated dependencies [8436596]
- Updated dependencies [475ce59]
  - @shipfox/expression@1.1.4
  - @shipfox/api-agent-dto@9.0.1
  - @shipfox/api-runners-dto@9.0.1
  - @shipfox/api-workflows-dto@9.0.1
  - @shipfox/config@1.2.3
  - @shipfox/node-egress-guard@0.1.2
  - @shipfox/node-opentelemetry@0.6.1
  - @shipfox/runner-execution@0.1.11
  - @shipfox/runner-protocol@0.2.5

## 0.1.10

### Patch Changes

- Updated dependencies [46aa52f]
  - @shipfox/api-agent-dto@9.0.0
  - @shipfox/api-runners-dto@7.0.1
  - @shipfox/api-workflows-dto@9.0.0
  - @shipfox/runner-execution@0.1.10
  - @shipfox/runner-protocol@0.2.4
  - @shipfox/config@1.2.2
  - @shipfox/expression@1.1.3
  - @shipfox/node-egress-guard@0.1.1
  - @shipfox/node-opentelemetry@0.6.0

## 0.1.9

### Patch Changes

- Updated dependencies [de559bb]
  - @shipfox/api-agent-dto@8.0.0
  - @shipfox/api-workflows-dto@8.0.0
  - @shipfox/runner-protocol@0.2.3
  - @shipfox/runner-execution@0.1.9

## 0.1.8

### Patch Changes

- Updated dependencies [6ce08c0]
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/runner-execution@0.1.8
  - @shipfox/runner-protocol@0.2.2

## 0.1.7

### Patch Changes

- Updated dependencies [ffc7fc9]
  - @shipfox/api-runners-dto@7.0.1
  - @shipfox/runner-protocol@0.2.1
  - @shipfox/runner-execution@0.1.7

## 0.1.6

### Patch Changes

- Updated dependencies [ce8fb21]
- Updated dependencies [bc7cfdc]
  - @shipfox/runner-protocol@0.2.0
  - @shipfox/api-runners-dto@7.0.0
  - @shipfox/runner-execution@0.1.6

## 0.1.5

### Patch Changes

- Updated dependencies [e52513c]
- Updated dependencies [0bb82a4]
- Updated dependencies [b70f920]
- Updated dependencies [23563de]
- Updated dependencies [9006b75]
- Updated dependencies [3cda0c6]
- Updated dependencies [8bdc149]
- Updated dependencies [795e293]
- Updated dependencies [e10c829]
- Updated dependencies [23a4dc2]
- Updated dependencies [b00ed29]
- Updated dependencies [6741be8]
  - @shipfox/api-runners-dto@6.0.0
  - @shipfox/api-agent-dto@6.0.0
  - @shipfox/api-workflows-dto@6.0.0
  - @shipfox/runner-protocol@0.1.4
  - @shipfox/runner-execution@0.1.5

## 0.1.4

### Patch Changes

- Updated dependencies [bb037af]
  - @shipfox/api-agent-dto@5.0.0
  - @shipfox/api-runners-dto@5.0.0
  - @shipfox/api-workflows-dto@5.0.0
  - @shipfox/config@1.2.2
  - @shipfox/expression@1.1.3
  - @shipfox/node-egress-guard@0.1.1
  - @shipfox/node-opentelemetry@0.5.2
  - @shipfox/runner-execution@0.1.4
  - @shipfox/runner-protocol@0.1.3

## 0.1.3

### Patch Changes

- Updated dependencies [7a71e7d]
  - @shipfox/expression@1.1.2
  - @shipfox/node-opentelemetry@0.5.1
  - @shipfox/api-agent-dto@3.0.0
  - @shipfox/runner-execution@0.1.3
  - @shipfox/runner-protocol@0.1.2

## 0.1.2

### Patch Changes

- Updated dependencies [1b0d344]
- Updated dependencies [521e006]
  - @shipfox/api-agent-dto@2.0.0
  - @shipfox/api-runners-dto@2.0.0
  - @shipfox/api-workflows-dto@2.0.0
  - @shipfox/node-egress-guard@0.1.0
  - @shipfox/config@1.2.1
  - @shipfox/expression@1.1.1
  - @shipfox/node-opentelemetry@0.5.0
  - @shipfox/runner-execution@0.1.2
  - @shipfox/runner-protocol@0.1.1

## 0.1.1

### Patch Changes

- @shipfox/runner-execution@0.1.1

## 0.1.0

### Minor Changes

- 03d9eae: Adds runner-advertised tool capabilities to registration, heartbeat, persistence, and runner protocol reporting.

### Patch Changes

- eb40964: Add an inline `agent` workflow step that the runner runs with the pi harness. A step is an agent step when it carries `model` + `prompt` and no `run`; it takes a free-text `model`, a single `prompt`, and an optional `thinking` level (default `high`). The step runs to process-success (the agent ran to completion) and reports through the existing step protocol with no runner/backend protocol change, so change quality is judged by a downstream `run` + `gate` step. v1 does not persist the agent's work (no diff, commit, or PR).
- b775474: Adds the runner harness adapter seam and fails unsupported Claude agent steps instead of silently running the pi harness.
- b525dcd: Let an agent workflow step pick its pi provider with an optional free-text `provider` field (default `anthropic`), threaded to the runner's pi model lookup, and split agent-step failures into a user-fixable `agent_config_invalid` reason (unknown provider, missing runner credentials, wrong provider/model pair) versus `agent_invocation_failed` for genuine provider/API errors.
- d49ee4c: Forward agent step session entries into the logs module as opaque `agent_session` records: the runner tails the pi session file and forwards each verbatim entry over a shared log-stream sink, and the write path stores them with a configurable per-line size cap sized for inline base64 content.
- Updated dependencies [eb40964]
- Updated dependencies [7bc7498]
- Updated dependencies [5c18360]
- Updated dependencies [067a260]
- Updated dependencies [26fea4b]
- Updated dependencies [0cf66c4]
- Updated dependencies [8100b48]
- Updated dependencies [8f51daf]
- Updated dependencies [05b61f6]
- Updated dependencies [e689abf]
- Updated dependencies [7a9943d]
- Updated dependencies [ce3e5ca]
- Updated dependencies [2325d76]
- Updated dependencies [c17dd6e]
- Updated dependencies [c0a883c]
- Updated dependencies [cdf8989]
- Updated dependencies [e47f8da]
- Updated dependencies [736249b]
- Updated dependencies [2bc5595]
- Updated dependencies [1127ba2]
- Updated dependencies [36f871d]
- Updated dependencies [e7b01dd]
- Updated dependencies [de54da2]
- Updated dependencies [d546b88]
- Updated dependencies [58c05ed]
- Updated dependencies [7b175f5]
- Updated dependencies [7ca4c65]
- Updated dependencies [68e4022]
- Updated dependencies [5bcdbf4]
- Updated dependencies [c47be09]
- Updated dependencies [f9f059e]
- Updated dependencies [940696a]
- Updated dependencies [c7d8b39]
- Updated dependencies [f98c2be]
- Updated dependencies [e9396c9]
- Updated dependencies [6c80f00]
- Updated dependencies [360d06d]
- Updated dependencies [b525dcd]
- Updated dependencies [2883ab4]
- Updated dependencies [78d0f7f]
- Updated dependencies [aca162b]
- Updated dependencies [998eba3]
- Updated dependencies [3afb7e3]
- Updated dependencies [247cbd6]
- Updated dependencies [5d53ed4]
- Updated dependencies [c652a68]
- Updated dependencies [fb64f13]
- Updated dependencies [62720ea]
- Updated dependencies [795f440]
- Updated dependencies [3dcd751]
- Updated dependencies [5af4907]
- Updated dependencies [c0a883c]
- Updated dependencies [362b3eb]
- Updated dependencies [f0afdf8]
- Updated dependencies [9d3b43a]
- Updated dependencies [d635979]
- Updated dependencies [d69b164]
- Updated dependencies [2fb3e87]
- Updated dependencies [e0fee57]
- Updated dependencies [fa67aa3]
- Updated dependencies [ef1e917]
- Updated dependencies [51eb38a]
- Updated dependencies [88b9793]
- Updated dependencies [e2fbef8]
- Updated dependencies [2933c33]
- Updated dependencies [2ad300c]
- Updated dependencies [a314b05]
- Updated dependencies [950ebef]
- Updated dependencies [03d9eae]
- Updated dependencies [a5c7562]
- Updated dependencies [6181819]
- Updated dependencies [d0cd759]
- Updated dependencies [1ea2f6a]
- Updated dependencies [e699508]
- Updated dependencies [ad6056b]
- Updated dependencies [282e66a]
- Updated dependencies [e1d4972]
- Updated dependencies [a856155]
- Updated dependencies [8ecc121]
  - @shipfox/api-workflows-dto@0.1.0
  - @shipfox/runner-execution@0.1.0
  - @shipfox/expression@1.1.0
  - @shipfox/api-agent-dto@0.1.0
  - @shipfox/api-runners-dto@0.1.0
  - @shipfox/runner-protocol@0.1.0
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/config@1.2.0
  - @shipfox/node-egress-guard@0.0.0
