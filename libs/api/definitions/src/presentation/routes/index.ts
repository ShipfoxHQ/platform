import {AUTH_API_KEY} from '@shipfox/api-auth-context';
import type {RouteGroup} from '@shipfox/node-fastify';
import {createDefinitionRoute} from './create-definition.js';
import {getDefinitionRoute} from './get-definition.js';
import {listDefinitionsRoute} from './list-definitions.js';
import {validateDefinitionRoute} from './validate-definition.js';

export const definitionRoutes: RouteGroup[] = [
  {
    prefix: '/definitions',
    auth: AUTH_API_KEY,
    routes: [
      createDefinitionRoute,
      listDefinitionsRoute,
      getDefinitionRoute,
      validateDefinitionRoute,
    ],
  },
];
