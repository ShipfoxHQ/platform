# @shipfox/provisioner-core

## 1.0.6

### Patch Changes

- Updated dependencies [e9280fc]
- Updated dependencies [837bf5d]
- Updated dependencies [3f5610b]
  - @shipfox/api-runners-dto@10.0.0
  - @shipfox/config@1.2.4
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/node-resilient-loop@0.0.1

## 1.0.5

### Patch Changes

- Updated dependencies [4425c6d]
  - @shipfox/node-opentelemetry@0.6.3

## 1.0.4

### Patch Changes

- Updated dependencies [4b85404]
  - @shipfox/api-runners-dto@9.0.2
  - @shipfox/config@1.2.4
  - @shipfox/node-opentelemetry@0.6.2

## 1.0.3

### Patch Changes

- Updated dependencies [475ce59]
  - @shipfox/api-runners-dto@9.0.1
  - @shipfox/config@1.2.3
  - @shipfox/node-opentelemetry@0.6.1
  - @shipfox/node-resilient-loop@0.0.1

## 1.0.2

### Patch Changes

- Updated dependencies [6ce08c0]
  - @shipfox/node-opentelemetry@0.6.0

## 1.0.1

### Patch Changes

- Updated dependencies [ffc7fc9]
  - @shipfox/api-runners-dto@7.0.1

## 1.0.0

### Major Changes

- bc7cfdc: Migrates provisioners to bootstrap runner instances with explicit reservation assignment.

### Patch Changes

- Updated dependencies [bc7cfdc]
  - @shipfox/api-runners-dto@7.0.0

## 0.0.5

### Patch Changes

- Updated dependencies [e52513c]
- Updated dependencies [b70f920]
- Updated dependencies [9006b75]
- Updated dependencies [3cda0c6]
- Updated dependencies [8bdc149]
- Updated dependencies [795e293]
- Updated dependencies [e10c829]
- Updated dependencies [b00ed29]
- Updated dependencies [6741be8]
  - @shipfox/api-runners-dto@6.0.0

## 0.0.4

### Patch Changes

- Updated dependencies [bb037af]
  - @shipfox/api-runners-dto@5.0.0
  - @shipfox/config@1.2.2
  - @shipfox/node-opentelemetry@0.5.2
  - @shipfox/node-resilient-loop@0.0.1

## 0.0.3

### Patch Changes

- Updated dependencies [7a71e7d]
  - @shipfox/node-opentelemetry@0.5.1

## 0.0.2

### Patch Changes

- Updated dependencies [1b0d344]
- Updated dependencies [521e006]
  - @shipfox/api-runners-dto@2.0.0
  - @shipfox/config@1.2.1
  - @shipfox/node-opentelemetry@0.5.0
  - @shipfox/node-resilient-loop@0.0.1

## 0.0.1

### Patch Changes

- 0b1585b: Adds backend-aware Docker provisioner reconciliation with terminate-intent teardown and buffered lifecycle report retries.
- 2325d76: Adds provisioned-runner terminate intent signals for cancelled bound jobs across runner polling and reconcile responses.
- 2b4e82a: Add the Docker provisioner control loop.
  - New `@shipfox/provisioner-core`: the provider-agnostic control loop a provisioner runs. It authenticates with a provisioner token, long-polls demand while advertising per-template capacity, deterministically selects a local template for each reservation label set (cheapest matching template first, with capacity-aware fan-out), batch-mints one single-use registration token per planned runner, and hands each to a provider launcher. It never reserves more than its templates have free capacity. Template selection and capacity planning are pure and unit-tested.
  - New `@shipfox/provisioner-docker-provider`: the Docker provider. It reads, validates, and canonicalizes the local Docker template YAML (labels, image, cpu, memory, max_concurrency), failing fast with clear, file-scoped errors, and wires `startDockerProvisioner()`. The current launcher logs each planned runner; it does not start containers, report lifecycle, or reconcile on restart.

- 655275f: Extracts shared resilient-loop helpers for runner and provisioner backoff, jitter, interruptible sleep, and graceful shutdown handling.
- 20fd542: Adds Docker provisioner lifecycle management so reserved runners launch as containers, report state, reconcile local Docker resources, and reap stale pre-run containers.
- Updated dependencies [8100b48]
- Updated dependencies [7a9943d]
- Updated dependencies [2325d76]
- Updated dependencies [c0a883c]
- Updated dependencies [e47f8da]
- Updated dependencies [7b175f5]
- Updated dependencies [c47be09]
- Updated dependencies [f9f059e]
- Updated dependencies [3afb7e3]
- Updated dependencies [247cbd6]
- Updated dependencies [fb64f13]
- Updated dependencies [62720ea]
- Updated dependencies [88b9793]
- Updated dependencies [655275f]
- Updated dependencies [2933c33]
- Updated dependencies [03d9eae]
- Updated dependencies [a5c7562]
- Updated dependencies [6181819]
- Updated dependencies [8ecc121]
  - @shipfox/api-runners-dto@0.1.0
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-resilient-loop@0.0.1
  - @shipfox/config@1.2.0
