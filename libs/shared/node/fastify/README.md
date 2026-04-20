# Shipfox Fastify

Opinionated Fastify setup for Node services with Zod validation, OpenTelemetry instrumentation, auth hooks, health checks, and structured error handling out of the box. It should be used with other packages from [Shipfox](https://www.shipfox.io/).

## What it does

- **`createApp(config?)`**: Creates a Fastify instance wired with OpenTelemetry, Zod type providers, auth, health endpoints, routes, and error handling.
- **`app()`**: Returns the current Fastify instance; throws if not yet created.
- **`listen()`**: Starts listening on the configured host and port.
- **`closeApp()`**: Gracefully shuts down the server.
- **`defineRoute(route)`**: Type-safe route builder that infers request types from Zod schemas.
- **`ClientError`**: Throw from handlers to return structured client-facing error responses.
- **Health endpoints**: `GET /healthz` (liveness) and `GET /readyz` (readiness) registered automatically.
- **Auth**: Register named auth methods and reference them per-route or per-group.
- **Routing**: Supports nested route groups with prefix, auth inheritance, and scoped plugins.

Environment variables (via `@shipfox/config`):

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

// Define a route with Zod schema validation
const getUser = defineRoute({
  method: "GET",
  path: "/users/:id",
  schema: {
    params: z.object({ id: z.string() }),
    response: { 200: z.object({ id: z.string(), name: z.string() }) },
  },
  handler: async (request, reply) => {
    const { id } = request.params;
    return reply.send({ id, name: "Alice" });
  },
});

// Create and start the app
const app = await createApp({
  routes: [getUser],
  readinessChecks: [{ name: "db", check: () => true }],
});

await listen(); // Listening on 0.0.0.0:3000

// Graceful shutdown
process.on("SIGTERM", async () => {
  await closeApp();
});
```

### Route groups with auth

```ts
import { createApp, defineRoute, type AuthMethod, type RouteGroup } from "@shipfox/node-fastify";

const bearerAuth: AuthMethod = {
  name: "bearer",
  authenticate: async (request, reply) => {
    if (!request.headers.authorization) {
      reply.code(401).send({ code: "unauthorized" });
    }
  },
};

const adminRoutes: RouteGroup = {
  prefix: "/admin",
  auth: "bearer",
  routes: [
    defineRoute({ method: "GET", path: "/stats", handler: async () => ({ ok: true }) }),
  ],
};

await createApp({ auth: [bearerAuth], routes: [adminRoutes] });
```

### Client errors

```ts
import { ClientError } from "@shipfox/node-fastify";

// Inside a handler — returns { "code": "not-found" } with status 404
throw new ClientError("User not found", "not-found", { status: 404 });
```
