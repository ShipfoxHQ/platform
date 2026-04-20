# @shipfox/tool-utils

Small utilities shared by Shipfox CLI tools for path resolution, shell command building, and logging. It should be used with other packages from [Shipfox](https://www.shipfox.io/).

## What it does

- **`@shipfox/tool-utils/path`**: Resolve project root, workspace root, binary paths, and file paths within the monorepo.
- **`@shipfox/tool-utils/shell`**: Build properly quoted and escaped shell commands cross-platform.
- **`@shipfox/tool-utils/log`**: Structured logging (`info`, `warning`, `error`, `debug`) via `@actions/core`.

## Installation

```bash
pnpm add -D @shipfox/tool-utils
```

## Usage

```ts
import {
  getProjectRootPath,
  getWorkspaceRootPath,
  getProjectBinaryPath,
} from "@shipfox/tool-utils/path";
import { buildShellCommand } from "@shipfox/tool-utils/shell";
import { log } from "@shipfox/tool-utils/log";

// Resolve paths
const projectRoot = getProjectRootPath(import.meta.url);
const workspaceRoot = getWorkspaceRootPath();
const swcBin = getProjectBinaryPath("swc", import.meta.url);

// Build a safe shell command
const cmd = buildShellCommand([swcBin, "-d", "dist", "src"]);

// Log
log.info("Build started");
```
