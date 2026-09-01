# @shipfox/vite

## 1.2.8

### Patch Changes

- b416c4c: Preserves existing package behavior while simplifying internal control flow.

## 1.2.7

### Patch Changes

- Updated dependencies [59a552c]
  - @shipfox/tool-utils@1.2.2

## 1.2.6

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- 4d6be08: Shares workspace-source package-import resolution between the Vite and Vitest tooling wrappers.
- Updated dependencies [475ce59]
  - @shipfox/tool-utils@1.2.1

## 1.2.5

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [9038afb]
  - @shipfox/tool-utils@1.2.0

## 1.2.4

### Patch Changes

- a9b0698: Replaces the `vite-tsconfig-paths` plugin with Vite's native `resolve.tsconfigPaths` option, dropping the dependency.

## 1.2.3

### Patch Changes

- 2311e15: Moves the @shipfox tools packages to a dedicated repository — future versions will be published from there.
- Updated dependencies [2311e15]
  - @shipfox/tool-utils@1.1.3
