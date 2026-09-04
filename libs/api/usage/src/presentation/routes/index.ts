import {AUTH_USER} from '@shipfox/api-auth-context';
import type {RouteGroup} from '@shipfox/node-fastify';
import {getJobExecutionUsageRoute} from './job-execution-usage.js';
import {getRunUsageRoute} from './run-usage.js';

export const usageRoutes: RouteGroup[] = [
  {
    prefix: '/usage/workspaces/:workspace_id',
    auth: AUTH_USER,
    routes: [getRunUsageRoute, getJobExecutionUsageRoute],
  },
];
