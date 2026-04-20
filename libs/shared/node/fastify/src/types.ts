import type {
  FastifyBaseLogger,
  FastifyHttpOptions,
  FastifyPluginAsync,
  FastifyPluginCallback,
  FastifyReply,
  FastifyRequest,
  RawServerDefault,
} from 'fastify';
import type {ZodTypeAny, z} from 'zod';
import type {SwaggerOptions} from './swagger.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RouteSchema {
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  querystring?: ZodTypeAny;
  response?: Record<number, ZodTypeAny>;
}

export interface RouteOptions {
  bodyLimit?: number;
  logLevel?: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  handlerTimeout?: number;
}

export interface RouteDefinition {
  method: HttpMethod;
  path: string;
  description: string;
  schema?: RouteSchema;
  auth?: string | string[];
  options?: RouteOptions;
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;
  errorHandler?: (error: unknown, request: FastifyRequest, reply: FastifyReply) => unknown;
}

export type FastifyPlugin = FastifyPluginCallback | FastifyPluginAsync;

export interface RouteGroup {
  prefix: string;
  auth?: string | string[];
  routes: (RouteDefinition | RouteGroup)[];
  plugins?: FastifyPlugin[];
}

export type RouteExport = RouteDefinition | RouteGroup;

export interface AuthMethod {
  name: string;
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

export interface HealthCheck {
  name: string;
  check: () => Promise<boolean> | boolean;
}

export interface AppConfig {
  fastifyOptions?: FastifyHttpOptions<RawServerDefault, FastifyBaseLogger>;
  auth?: AuthMethod[];
  routes?: RouteExport[];
  plugins?: FastifyPlugin[];
  livenessChecks?: HealthCheck[];
  readinessChecks?: HealthCheck[];
  swagger?: SwaggerOptions | false | null;
  errorHandler?: (error: unknown, request: FastifyRequest, reply: FastifyReply) => unknown;
}

export function isRouteGroup(route: RouteExport): route is RouteGroup {
  return 'prefix' in route && 'routes' in route;
}

type InferSchema<S extends RouteSchema | undefined> = S extends RouteSchema
  ? {
      Body: S['body'] extends ZodTypeAny ? z.infer<S['body']> : unknown;
      Params: S['params'] extends ZodTypeAny ? z.infer<S['params']> : unknown;
      Querystring: S['querystring'] extends ZodTypeAny ? z.infer<S['querystring']> : unknown;
    }
  : {Body: unknown; Params: unknown; Querystring: unknown};

export function defineRoute<const S extends RouteSchema | undefined>(
  route: Omit<RouteDefinition, 'handler' | 'schema'> & {
    schema?: S;
    handler: (
      request: FastifyRequest<InferSchema<S>>,
      reply: FastifyReply,
    ) => Promise<unknown> | unknown;
  },
): RouteDefinition {
  return route as unknown as RouteDefinition;
}
