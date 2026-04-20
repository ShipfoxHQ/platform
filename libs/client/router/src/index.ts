import {router} from './router.js';

export type {RouterIds, RouterType} from './router.js';
export {router};

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

export type {ErrorComponentProps} from '@tanstack/react-router';
export {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  ErrorComponent,
  getRouteApi,
  Link,
  Navigate,
  Outlet,
  RouterProvider,
  useLocation,
  useNavigate,
  useRouter,
  useSearch,
} from '@tanstack/react-router';
