# @shipfox/client-test-setup

## 0.0.8

### Patch Changes

- @shipfox/vitest@1.2.6
- @shipfox/client-api@6.0.1

## 0.0.7

### Patch Changes

- Updated dependencies [6b0fb90]
  - @shipfox/vitest@1.2.5
  - @shipfox/client-api@6.0.1

## 0.0.6

### Patch Changes

- Updated dependencies [475ce59]
- Updated dependencies [4d6be08]
  - @shipfox/client-api@6.0.1
  - @shipfox/vitest@1.2.4

## 0.0.5

### Patch Changes

- Updated dependencies [24be269]
- Updated dependencies [c02ac42]
  - @shipfox/client-api@6.0.0

## 0.0.4

### Patch Changes

- Updated dependencies [6b4a575]
- Updated dependencies [781a45b]
  - @shipfox/client-api@4.0.0

## 0.0.3

### Patch Changes

- Updated dependencies [bb037af]
  - @shipfox/client-api@1.0.0
  - @shipfox/vitest@1.2.3

## 0.0.2

### Patch Changes

- Updated dependencies [3d064b8]
  - @shipfox/client-api@0.2.0

## 0.0.1

### Patch Changes

- 5d0676a: Add `resetApiClient()` and a shared `@shipfox/client-test-setup` package whose `installClientDomTestEnv()` makes client `dom` Vitest projects isolation-safe: it registers per-test DOM cleanup and API-client reset and installs the jsdom stubs, so a package can run its `dom` project with `isolate: false` without state leaking across files.
- Updated dependencies [5d0676a]
- Updated dependencies [166d90b]
- Updated dependencies [c73370c]
- Updated dependencies [c93fa59]
  - @shipfox/client-api@0.0.1
  - @shipfox/vitest@1.2.2
