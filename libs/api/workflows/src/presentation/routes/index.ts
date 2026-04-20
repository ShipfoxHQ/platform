import {AUTH_API_KEY} from '@shipfox/api-auth-context';
import type {RouteGroup} from '@shipfox/node-fastify';
import {createRunRoute} from './create-run.js';
import {getRunRoute} from './get-run.js';
import {listRunsRoute} from './list-runs.js';

export const workflowRoutes: RouteGroup[] = [
  {
    prefix: '/workflows/runs',
    auth: AUTH_API_KEY,
    routes: [createRunRoute, listRunsRoute, getRunRoute],
  },
];
