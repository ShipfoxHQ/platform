# @shipfox/provisioner-ec2-provider

## 1.0.8

### Patch Changes

- @shipfox/provisioner-core@1.0.8

## 1.0.7

### Patch Changes

- Updated dependencies [c9a188d]
- Updated dependencies [8678943]
- Updated dependencies [6be5a54]
- Updated dependencies [1300a54]
  - @shipfox/api-runners-dto@10.2.0
  - @shipfox/provisioner-core@1.0.7

## 1.0.6

### Patch Changes

- Updated dependencies [e9280fc]
- Updated dependencies [837bf5d]
- Updated dependencies [3f5610b]
  - @shipfox/api-runners-dto@10.0.0
  - @shipfox/provisioner-core@1.0.6
  - @shipfox/config@1.2.4
  - @shipfox/runner-labels@0.1.3
  - @shipfox/node-opentelemetry@0.6.3

## 1.0.5

### Patch Changes

- Updated dependencies [4425c6d]
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/provisioner-core@1.0.5

## 1.0.4

### Patch Changes

- Updated dependencies [4b85404]
  - @shipfox/api-runners-dto@9.0.2
  - @shipfox/config@1.2.4
  - @shipfox/node-opentelemetry@0.6.2
  - @shipfox/runner-labels@0.1.3
  - @shipfox/provisioner-core@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies [8436596]
- Updated dependencies [475ce59]
  - @shipfox/runner-labels@0.1.2
  - @shipfox/api-runners-dto@9.0.1
  - @shipfox/config@1.2.3
  - @shipfox/node-opentelemetry@0.6.1
  - @shipfox/provisioner-core@1.0.3

## 1.0.2

### Patch Changes

- Updated dependencies [6ce08c0]
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/provisioner-core@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies [ffc7fc9]
  - @shipfox/api-runners-dto@7.0.1
  - @shipfox/provisioner-core@1.0.1

## 1.0.0

### Major Changes

- bc7cfdc: Migrates provisioners to bootstrap runner instances with explicit reservation assignment.

### Minor Changes

- 52fa4b5: Adds the EC2 provisioner lifecycle: launches runner instances, observes and reports their state to the backend, and reconciles AWS reality with tracked capacity.
- aa53e13: Adds EC2 reconcile, periodic tick, and backend-driven terminate to the runner lifecycle, and reaps instances stuck past the registration deadline.

### Patch Changes

- Updated dependencies [bc7cfdc]
  - @shipfox/api-runners-dto@7.0.0
  - @shipfox/provisioner-core@1.0.0

## 0.1.2

### Patch Changes

- @shipfox/provisioner-core@0.0.5

## 0.1.1

### Patch Changes

- Updated dependencies [bb037af]
  - @shipfox/config@1.2.2
  - @shipfox/runner-labels@0.1.1
  - @shipfox/provisioner-core@0.0.4

## 0.1.0

### Minor Changes

- 9436399: Adds the internal EC2 provisioner provider scaffold: config, the EC2 template spec, and a fail-fast template loader.
