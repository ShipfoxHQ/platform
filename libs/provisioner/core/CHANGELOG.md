# @shipfox/provisioner-core

## 1.2.1

### Patch Changes

- Updated dependencies [af6b31e]
  - @shipfox/api-runners-dto@13.0.0

## 1.2.0

### Minor Changes

- d747f6a: Expose provider adapter demand snapshots for provider-specific observation.

## 1.1.1

### Patch Changes

- Updated dependencies [9e16946]
- Updated dependencies [4fa8526]
  - @shipfox/api-runners-dto@12.4.0

## 1.1.0

### Minor Changes

- a9bbce4: Let provisioner adapters request provider-specific reservation TTLs during demand polling. `startProvisioner` rejects an adapter whose `reservationTtlSeconds` is not a positive integer.

### Patch Changes

- Updated dependencies [3e7fe76]
  - @shipfox/expression@2.2.0

## 1.0.10

### Patch Changes

- Updated dependencies [78b771c]
- Updated dependencies [ce0984d]
  - @shipfox/api-runners-dto@12.2.0
  - @shipfox/expression@2.1.0
  - @shipfox/node-opentelemetry@0.6.4

## 1.0.9

### Patch Changes

- Updated dependencies [7c4116e]
- Updated dependencies [3d91d1d]
- Updated dependencies [045895c]
- Updated dependencies [dea1ffd]
- Updated dependencies [adf07e7]
- Updated dependencies [3f781ee]
- Updated dependencies [285fff2]
- Updated dependencies [4d246d4]
- Updated dependencies [4444079]
- Updated dependencies [d77baaa]
- Updated dependencies [41d558c]
- Updated dependencies [c2a8e54]
- Updated dependencies [cb0abfa]
- Updated dependencies [ee2ce67]
  - @shipfox/expression@2.0.0
  - @shipfox/api-runners-dto@12.0.0

## 1.0.8

### Patch Changes

- Updated dependencies [71d9ba4]
  - @shipfox/expression@1.2.1

## 1.0.7

### Patch Changes

- 1300a54: Splits provisioner demand polling from provider convergence and makes shutdown cleanup resilient.
- Updated dependencies [c9a188d]
- Updated dependencies [8678943]
- Updated dependencies [6be5a54]
  - @shipfox/api-runners-dto@10.2.0

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
