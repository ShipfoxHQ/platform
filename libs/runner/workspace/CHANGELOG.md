# @shipfox/runner-workspace

## 0.0.21

### Patch Changes

- Updated dependencies [0d3c2e3]
  - @shipfox/api-workflows-dto@13.1.0

## 0.0.20

### Patch Changes

- Updated dependencies [af6b31e]
  - @shipfox/api-workflows-dto@13.0.0

## 0.0.19

### Patch Changes

- Updated dependencies [4df5e37]
  - @shipfox/api-workflows-dto@12.7.0

## 0.0.18

### Patch Changes

- Updated dependencies [53b87f0]
  - @shipfox/api-workflows-dto@12.6.0

## 0.0.17

### Patch Changes

- Updated dependencies [5b1838c]
  - @shipfox/api-workflows-dto@12.5.0

## 0.0.16

### Patch Changes

- Updated dependencies [4b0731e]
  - @shipfox/api-workflows-dto@12.3.0

## 0.0.15

### Patch Changes

- Updated dependencies [ce0984d]
  - @shipfox/api-workflows-dto@12.2.0
  - @shipfox/node-opentelemetry@0.6.4

## 0.0.14

### Patch Changes

- Updated dependencies [312a137]
  - @shipfox/api-workflows-dto@12.1.0

## 0.0.13

### Patch Changes

- Updated dependencies [ee2ce67]
- Updated dependencies [f7939c7]
- Updated dependencies [dea1ffd]
- Updated dependencies [adf07e7]
- Updated dependencies [285fff2]
- Updated dependencies [e44a279]
- Updated dependencies [54c820e]
- Updated dependencies [35a42bd]
- Updated dependencies [d77baaa]
- Updated dependencies [032d316]
- Updated dependencies [c2a8e54]
- Updated dependencies [cb0abfa]
  - @shipfox/api-workflows-dto@12.0.0

## 0.0.12

### Patch Changes

- Updated dependencies [22bf8a2]
  - @shipfox/api-workflows-dto@10.0.0
  - @shipfox/config@1.2.4
  - @shipfox/regex@0.2.4
  - @shipfox/node-opentelemetry@0.6.3

## 0.0.11

### Patch Changes

- Updated dependencies [4425c6d]
- Updated dependencies [6017e56]
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/api-workflows-dto@9.3.0

## 0.0.10

### Patch Changes

- Updated dependencies [4b85404]
  - @shipfox/api-workflows-dto@9.0.2
  - @shipfox/config@1.2.4
  - @shipfox/node-opentelemetry@0.6.2
  - @shipfox/regex@0.2.4

## 0.0.9

### Patch Changes

- Updated dependencies [8436596]
- Updated dependencies [475ce59]
  - @shipfox/regex@0.2.3
  - @shipfox/api-workflows-dto@9.0.1
  - @shipfox/config@1.2.3
  - @shipfox/node-opentelemetry@0.6.1

## 0.0.8

### Patch Changes

- @shipfox/api-workflows-dto@9.0.0
- @shipfox/config@1.2.2
- @shipfox/regex@0.2.2
- @shipfox/node-opentelemetry@0.6.0

## 0.0.7

### Patch Changes

- @shipfox/api-workflows-dto@8.0.0

## 0.0.6

### Patch Changes

- Updated dependencies [6ce08c0]
  - @shipfox/node-opentelemetry@0.6.0

## 0.0.5

### Patch Changes

- Updated dependencies [23563de]
- Updated dependencies [23a4dc2]
  - @shipfox/api-workflows-dto@6.0.0

## 0.0.4

### Patch Changes

- Updated dependencies [bb037af]
  - @shipfox/api-workflows-dto@5.0.0
  - @shipfox/config@1.2.2
  - @shipfox/node-opentelemetry@0.5.2
  - @shipfox/regex@0.2.2

## 0.0.3

### Patch Changes

- Updated dependencies [7a71e7d]
  - @shipfox/node-opentelemetry@0.5.1

## 0.0.2

### Patch Changes

- Updated dependencies [1b0d344]
- Updated dependencies [521e006]
  - @shipfox/api-workflows-dto@2.0.0
  - @shipfox/config@1.2.1
  - @shipfox/node-opentelemetry@0.5.0
  - @shipfox/regex@0.2.1

## 0.0.1

### Patch Changes

- c7d8b39: Implement the repository checkout inside the runner's "Set up job" step. The setup
  step now ensures `git` is available, exchanges the job lease for short-lived
  read-only checkout credentials via the checkout-token endpoint, and shallow-clones
  the project repository's default branch into the per-job directory. Every failure
  mode (missing `git`, denied credential, unreachable provider, generic clone failure)
  fails the job before any user step runs with a machine-readable `reason`. Credentials
  are injected with a one-shot `http.extraHeader`, never persisted to `.git/config`,
  and redacted from error messages.
- Updated dependencies [eb40964]
- Updated dependencies [5c18360]
- Updated dependencies [7a9943d]
- Updated dependencies [c17dd6e]
- Updated dependencies [e47f8da]
- Updated dependencies [736249b]
- Updated dependencies [2bc5595]
- Updated dependencies [7b175f5]
- Updated dependencies [940696a]
- Updated dependencies [f98c2be]
- Updated dependencies [e9396c9]
- Updated dependencies [b525dcd]
- Updated dependencies [3afb7e3]
- Updated dependencies [c652a68]
- Updated dependencies [795f440]
- Updated dependencies [3dcd751]
- Updated dependencies [c0a883c]
- Updated dependencies [362b3eb]
- Updated dependencies [d69b164]
- Updated dependencies [2fb3e87]
- Updated dependencies [ef1e917]
- Updated dependencies [27770eb]
- Updated dependencies [2933c33]
- Updated dependencies [e699508]
- Updated dependencies [8ecc121]
  - @shipfox/api-workflows-dto@0.1.0
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/regex@0.2.0
  - @shipfox/config@1.2.0
