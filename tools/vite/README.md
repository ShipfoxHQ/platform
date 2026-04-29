# @shipfox/vite

Vite defaults and CLI wrappers for Shipfox frontend packages. It adds TypeScript path support and gives apps shared commands for development and production builds.

## What it does

- **`defineConfig(config?)`**: Wraps Vite `defineConfig` and adds `vite-tsconfig-paths`.
- **`loadEnv`**: Re-export from Vite.
- **`vite-dev`**: Runs the project-local Vite dev server.
- **`vite-build`**: Runs `vite build --outDir dist`.
- **`@shipfox/vite/client`**: Type entry that re-exports `vite/client`.

## Installation

```bash
pnpm add -D @shipfox/vite
```

## Usage

Create a `vite.config.ts`:

```ts
import {defineConfig} from '@shipfox/vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
```

Add scripts:

```json
{
  "scripts": {
    "dev": "vite-dev",
    "build": "vite-build"
  }
}
```

Then run:

```bash
vite-dev
vite-build
```

## Types

Use the client type entry in browser packages:

```ts
/// <reference types="@shipfox/vite/client" />
```

## License

MIT
