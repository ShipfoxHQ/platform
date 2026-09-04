# @shipfox/provisioner-ec2-provider

## 1.1.5

### Patch Changes

- Updated dependencies [be1c862]
- Updated dependencies [f534da6]
  - @shipfox/api-runners-dto@21.1.0
  - @shipfox/provisioner-core@1.2.12

## 1.1.4

### Patch Changes

- Updated dependencies [b5d02d1]
  - @shipfox/api-runners-dto@21.0.0
  - @shipfox/provisioner-core@1.2.11

## 1.1.3

### Patch Changes

- @shipfox/provisioner-core@1.2.10

## 1.1.2

### Patch Changes

- @shipfox/provisioner-core@1.2.9

## 1.1.1

### Patch Changes

- Updated dependencies [794f834]
  - @shipfox/api-runners-dto@20.0.0
  - @shipfox/provisioner-core@1.2.8

## 1.1.0

### Minor Changes

- b2e6556: Retry authorized EC2 runner instances that remain in stopping after the bounded stopping timeout.

### Patch Changes

- Updated dependencies [b416c4c]
- Updated dependencies [461e3a0]
- Updated dependencies [b2e6556]
- Updated dependencies [cd5fb8f]
  - @shipfox/runner-labels@0.2.1
  - @shipfox/api-runners-dto@19.0.0
  - @shipfox/provisioner-core@1.2.7
  - @shipfox/config@1.2.4
  - @shipfox/node-opentelemetry@0.6.5

## 1.0.19

### Patch Changes

- Updated dependencies [fff528a]
- Updated dependencies [60061fb]
- Updated dependencies [a50e2dc]
- Updated dependencies [defc3e6]
  - @shipfox/api-runners-dto@18.0.0
  - @shipfox/provisioner-core@1.2.6

## 1.0.18

### Patch Changes

- @shipfox/provisioner-core@1.2.5

## 1.0.17

### Patch Changes

- Updated dependencies [8eda9d4]
  - @shipfox/api-runners-dto@16.0.0
  - @shipfox/provisioner-core@1.2.4

## 1.0.16

### Patch Changes

- @shipfox/provisioner-core@1.2.3
- @shipfox/node-opentelemetry@0.6.5

## 1.0.15

### Patch Changes

- Updated dependencies [69a92c4]
  - @shipfox/api-runners-dto@14.0.0
  - @shipfox/provisioner-core@1.2.2

## 1.0.14

### Patch Changes

- Updated dependencies [af6b31e]
  - @shipfox/api-runners-dto@13.0.0
  - @shipfox/provisioner-core@1.2.1

## 1.0.13

### Patch Changes

- 3578bb5: Attribute EC2 lifecycle metrics and termination diagnostics to template pools.
- Updated dependencies [d747f6a]
  - @shipfox/provisioner-core@1.2.0

## 1.0.12

### Patch Changes

- Updated dependencies [9e16946]
- Updated dependencies [4fa8526]
  - @shipfox/api-runners-dto@12.4.0
  - @shipfox/provisioner-core@1.1.1

## 1.0.11

### Patch Changes

- 03625c8: Reports each EC2 runner termination once instead of on every observation, using AWS instance IDs and a one-hour listing-gap grace period.
- Updated dependencies [a9bbce4]
  - @shipfox/provisioner-core@1.1.0

## 1.0.10

### Patch Changes

- Updated dependencies [78b771c]
- Updated dependencies [df2ed79]
  - @shipfox/api-runners-dto@12.2.0
  - @shipfox/runner-labels@0.2.0
  - @shipfox/provisioner-core@1.0.10
  - @shipfox/node-opentelemetry@0.6.4

## 1.0.9

### Patch Changes

- @shipfox/provisioner-core@1.0.9
- @shipfox/api-runners-dto@12.0.0

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
