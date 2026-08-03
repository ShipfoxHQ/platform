import {Toaster} from '@shipfox/react-ui/toast';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {type RenderResult, render} from '@testing-library/react';
import {type ReactElement, StrictMode} from 'react';
import {AuthProvider} from '#components/auth-provider.js';
import {LoginPage} from '#pages/login-page.js';
import {PasswordResetPage} from '#pages/password-reset-page.js';
import {SignupPage} from '#pages/signup-page.js';

function createTestRouter(path: string, element: ReactElement) {
  const rootRoute = createRootRoute({
    component: Outlet,
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (path.split('?')[0] === '/' ? element : <h1>Authenticated home</h1>),
  });
  const workspaceRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: 'w/$workspaceSlug',
    component: () => <h1>Authenticated home</h1>,
  });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/auth/login',
    component: () => (path.split('?')[0] === '/auth/login' ? element : <LoginPage />),
  });
  const signupRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/auth/signup',
    component: () => (path.split('?')[0] === '/auth/signup' ? element : <SignupPage />),
  });
  const passwordResetRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/auth/reset',
    component: () => (path.split('?')[0] === '/auth/reset' ? element : <PasswordResetPage />),
  });
  const routeTree = rootRoute.addChildren([
    indexRoute,
    workspaceRoute,
    loginRoute,
    signupRoute,
    passwordResetRoute,
  ]);
  return createRouter({
    history: createMemoryHistory({initialEntries: [path]}),
    routeTree,
  });
}

function renderWithProviders(path: string, element: ReactElement) {
  const router = createTestRouter(path, element);

  return (
    <AuthProvider>
      <RouterProvider router={router} />
      <Toaster />
    </AuthProvider>
  );
}

export function renderAuthPage(path: string, element: ReactElement): RenderResult {
  return render(renderWithProviders(path, element));
}

export function renderStrictAuthPage(path: string, element: ReactElement): RenderResult {
  return render(<StrictMode>{renderWithProviders(path, element)}</StrictMode>);
}
