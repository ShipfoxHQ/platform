import type {RouteDefinition} from '@shipfox/node-fastify';
import {createApiKeyRoute} from './create.js';
import {revokeApiKeyRoute} from './revoke.js';

export const apiKeyRoutes: RouteDefinition[] = [createApiKeyRoute, revokeApiKeyRoute];
