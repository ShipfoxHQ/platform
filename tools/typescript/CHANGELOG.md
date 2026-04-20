# @shipfox/typescript

## 1.1.4

### Patch Changes

- 3b22b93: Support wildcard paths as baseUrl substitute in tsc-alias

  When a tsconfig uses `"*": ["./src/*"]` in paths instead of `baseUrl` (the TypeScript 6
  migration pattern), the build and type tools now derive the effective baseUrl from that
  entry and pass it to tsc-alias via a temporary config. This ensures bare intra-package
  imports are resolved to their correct output paths in both tools.

## 1.1.3

### Patch Changes

- 734a74c: Fix tsc-emit to resolve full paths in tsc-alias

  Add `resolveFullPaths: true` to the `replaceTscAliasPaths` call in `tsc-emit`. Without this flag, `tsc-alias` resolves baseUrl directory imports to `./path/to/dir` but omits the `/index.js` suffix, producing imports that fail under Node.js ESM (`ERR_UNSUPPORTED_DIR_IMPORT`).

  The `build` task (via `@shipfox/swc`) already uses `resolveFullPaths: true`. Because `build` and `type` run concurrently in Turborepo and both invoke `tsc-alias` on the same `dist/` directory, the `type` task's invocation (without `resolveFullPaths`) can race and overwrite correctly resolved `.js` imports with partially resolved ones. This caused intermittent production crashes in the API container.

## 1.1.2

### Patch Changes

- 674ecbb: Add README for all packages
- Updated dependencies [674ecbb]
  - @shipfox/tool-utils@1.1.2

## 1.1.1

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
