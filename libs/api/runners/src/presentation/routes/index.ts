import type {RouteGroup} from '@shipfox/node-fastify';
import {completeJobRoute} from './complete-job.js';
import {createRunnerTokenRoute} from './create-runner-token.js';
import {requestJobRoute} from './request-job.js';
import {revokeRunnerTokenRoute} from './revoke-runner-token.js';

export const runnerRoutes: RouteGroup[] = [
  {
    prefix: '/runners/tokens',
    routes: [createRunnerTokenRoute, revokeRunnerTokenRoute],
  },
  {
    prefix: '/runners/jobs',
    auth: 'runner-token',
    routes: [requestJobRoute, completeJobRoute],
  },
];
