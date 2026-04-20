import {createRouter, type RouteIds} from '@tanstack/react-router';
import {routeTree} from './routeTree.gen.js';

export const router = createRouter({
  routeTree,
  scrollRestoration: true,
});

export type RouterType = typeof router;
export type RouterIds = RouteIds<RouterType['routeTree']>;
