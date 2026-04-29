import cookie from '@fastify/cookie';
import type {RouteGroup} from '@shipfox/node-fastify';
import {createE2eSessionRoute} from './create-session.js';
import {createE2eUserRoute} from './create-user.js';

export const authE2eRoutes: RouteGroup = {
  prefix: '/auth',
  plugins: [cookie],
  routes: [createE2eUserRoute, createE2eSessionRoute],
};
