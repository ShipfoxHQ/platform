import {getFastifyInstrumentation, logger} from '@shipfox/node-opentelemetry';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {clearAuthMethods, registerAuthMethods, validateAuthReferences} from './auth.js';
import {config} from './config.js';
import {registerCors} from './cors.js';
import {
  errorHandler as defaultErrorHandler,
  notFoundHandler as defaultNotFoundHandler,
} from './errorHandler.js';
import {registerHealthChecks} from './health.js';
import {registerFastifyMetrics} from './metrics.js';
import {mountRoutes} from './router.js';
import {registerSwagger} from './swagger.js';
import type {AppConfig} from './types.js';

export type {FastifyInstance, FastifyReply, FastifyRequest} from 'fastify';
export {extractBearerToken} from './auth.js';
export {ClientError, type ClientErrorParams} from './clientError.js';
export {createAllowedOriginMatcher} from './cors.js';
export {errorHandler} from './errorHandler.js';
export type {SwaggerOptions} from './swagger.js';
export type {
  AppConfig,
  AuthMethod,
  FastifyPlugin,
  HealthCheck,
  HttpMethod,
  RouteDefinition,
  RouteExport,
  RouteGroup,
  RouteOptions,
  RoutePreHandler,
  RouteSchema,
} from './types.js';
export {defineRoute, isRouteGroup} from './types.js';
export {
  createRawBodyPlugin,
  type RawBodyPluginOptions,
  rawBodyPlugin,
  WEBHOOK_BODY_LIMIT,
} from './webhook-raw-body.js';
export {
  type VerifyHexHmacSignatureParams,
  verifyHexHmacSignature,
} from './webhook-signature.js';

let _app: FastifyInstance | undefined;

export type ListenOptions = {
  host?: string;
  port?: number;
};

export async function createApp(appConfig?: AppConfig): Promise<FastifyInstance> {
  clearAuthMethods();

  const fastify = Fastify({
    loggerInstance: logger(),
    ...appConfig?.fastifyOptions,
  });

  const fastifyInstrumentation = getFastifyInstrumentation();
  if (fastifyInstrumentation) await fastify.register(fastifyInstrumentation.plugin());
  registerFastifyMetrics(fastify);

  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  await registerCors(fastify);

  if (appConfig?.auth) {
    registerAuthMethods(appConfig.auth);
  }
  if (appConfig?.routes) {
    validateAuthReferences(appConfig.routes);
  }

  if (appConfig?.swagger !== false && appConfig?.swagger !== null) {
    await registerSwagger(fastify, appConfig?.swagger ?? {});
  }

  if (appConfig?.plugins) {
    for (const plugin of appConfig.plugins) {
      fastify.register(plugin);
    }
  }

  registerHealthChecks({
    app: fastify,
    livenessChecks: appConfig?.livenessChecks,
    readinessChecks: appConfig?.readinessChecks,
  });

  fastify.setErrorHandler(appConfig?.errorHandler ?? defaultErrorHandler);
  fastify.setNotFoundHandler(defaultNotFoundHandler);

  if (appConfig?.routes) {
    mountRoutes({app: fastify, routes: appConfig.routes});
  }

  _app = fastify;
  return fastify;
}

export function app(): FastifyInstance {
  if (!_app) {
    throw new Error('Fastify app has not been created');
  }
  return _app;
}

export async function listen(options: ListenOptions = {}): Promise<string> {
  if (!_app) {
    throw new Error('Fastify app has not been created');
  }
  const address = await _app.listen({
    host: options.host ?? config.HOST,
    port: options.port ?? config.PORT,
  });
  return address;
}

export async function closeApp(): Promise<void> {
  await _app?.close();
  _app = undefined;
}
