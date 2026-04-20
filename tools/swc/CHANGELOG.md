# @shipfox/swc

## 1.2.4

### Patch Changes

- 3b22b93: Support wildcard paths as baseUrl substitute in tsc-alias

  When a tsconfig uses `"*": ["./src/*"]` in paths instead of `baseUrl` (the TypeScript 6
  migration pattern), the build and type tools now derive the effective baseUrl from that
  entry and pass it to tsc-alias via a temporary config. This ensures bare intra-package
  imports are resolved to their correct output paths in both tools.

## 1.2.3

### Patch Changes

- f3b2a31: Ensure parser.js is exported

## 1.2.2

### Patch Changes

- 6984ba1: Update SWC dependency

## 1.2.1

### Patch Changes

- 674ecbb: Add README for all packages
- Updated dependencies [674ecbb]
  - @shipfox/tool-utils@1.1.2

## 1.2.0

### Minor Changes

- 0e6a02c: Allow passign extra args to SWC
- fe126a6: Update package dependencies for vite and SWC

### Patch Changes

- f8c8018: Handle spaces in paths
- 9bd640b: Modify repository structure
- Updated dependencies [9bd640b]
  - @shipfox/tool-utils@1.1.1

## 1.1.0

### Minor Changes

- bdf8ff5: Move libs in open source repo

### Patch Changes

- Updated dependencies [bdf8ff5]
  - @shipfox/tool-utils@1.1.0

## 1.0.2

### Patch Changes

- 7bb1804: Remove unsued publishing scripts
- Updated dependencies [7bb1804]
  - @shipfox/tool-utils@1.0.1

## 1.0.1

### Patch Changes

- 4f1e0d5: Make tools utils a direct prod dependency

## 1.0.0

### Major Changes

- 5688c3e: Initial public release of tools

### Patch Changes

- a6ebd5c: Add MIT license to packages
