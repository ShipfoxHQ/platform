# Shipfox Fastify

Fastify setup for Shipfox Node services. It adds Zod validation, CORS, Swagger, auth hooks, health checks, routes, and structured error handling.

## What it does

- **`createApp(config?)`** creates a Fastify app with Shipfox defaults.
- **`app()`** returns the current Fastify app.
- **`listen()`** starts the server on the configured host and port.
- **`closeApp()`** shuts down the server.
- **`defineRoute(route)`** infers request types from Zod schemas.
- **`ClientError`** returns structured client errors from handlers.
- **Health endpoints** are registered at `GET /healthz` and `GET /readyz`.
- **Auth hooks** can be set on routes or route groups.
- **Route groups** support prefixes, inherited auth, and scoped plugins.
- **Swagger** is on by default and serves `GET /openapi.json`.

Environment variables (via `@shipfox/config`):

- `BROWSER_ALLOWED_ORIGIN` (default: `undefined`; comma-separated CORS origins)
- `CLIENT_BASE_URL` (default: `http://localhost:3000`; CORS fallback when `BROWSER_ALLOWED_ORIGIN` is not set)
- `HOST` (default: `0.0.0.0`)
- `PORT` (default: `3000`)

## Installation

```bash
pnpm add @shipfox/node-fastify
# or
yarn add @shipfox/node-fastify
# or
npm install @shipfox/node-fastify
```

## Usage

```ts
import { createApp, listen, closeApp, defineRoute } from "@shipfox/node-fastify";
import { z } from "zod";

const getUser = defineRoute({
  method: "GET",
  path: "/users/:id",
  description: "Get a user by ID.",
  schema: {
    params: z.object({ id: z.string() }),
    response: { 200: z.object({ id: z.string(), name: z.string() }) },
  },
  handler: async (request, reply) => {
    const { id } = request.params;
    return reply.send({ id, name: "Alice" });
  },
});

const app = await createApp({
  routes: [getUser],
  readinessChecks: [{ name: "db", check: () => true }],
});

await listen();

process.on("SIGTERM", async () => {
  await closeApp();
});
```

### Route groups with auth

```ts
import {
  ClientError,
  createApp,
  defineRoute,
  type AuthMethod,
  type RouteGroup,
} from "@shipfox/node-fastify";

const bearerAuth: AuthMethod = {
  name: "bearer",
  authenticate: async (request) => {
    if (!request.headers.authorization) {
      throw new ClientError("Authentication required", "unauthorized", { status: 401 });
    }
  },
};

const adminRoutes: RouteGroup = {
  prefix: "/admin",
  auth: "bearer",
  routes: [
    defineRoute({
      method: "GET",
      path: "/stats",
      description: "Get admin stats.",
      handler: async () => ({ ok: true }),
    }),
  ],
};

await createApp({ auth: [bearerAuth], routes: [adminRoutes] });
```

### Client errors

```ts
import { ClientError } from "@shipfox/node-fastify";

// Returns { "code": "not-found" } with status 404.
throw new ClientError("User not found", "not-found", { status: 404 });
```

## Development

```sh
turbo check --filter=@shipfox/node-fastify
turbo type --filter=@shipfox/node-fastify
turbo test --filter=@shipfox/node-fastify
```

## License

MIT
