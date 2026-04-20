import {FullPageLoader} from '@shipfox/react-ui';
import {Navigate} from '@tanstack/react-router';
import type {PropsWithChildren} from 'react';
import {useAuthState} from '#hooks/use-auth-state.js';
import {WorkspaceOnboardingPage} from '#pages/workspace-onboarding-page.js';

export function AuthGuard({children}: PropsWithChildren) {
  const auth = useAuthState();

  if (auth.isLoading) {
    return <FullPageLoader />;
  }

  if (!auth.isAuthenticated) {
    return <Navigate to="/auth/login" replace />;
  }

  return children;
}

export function GuestGuard({children}: PropsWithChildren) {
  const auth = useAuthState();

  if (auth.isLoading) {
    return <FullPageLoader />;
  }

  if (auth.isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return children;
}

export function WorkspaceGuard({children}: PropsWithChildren) {
  const auth = useAuthState();

  if (auth.isAuthenticated && !auth.hasWorkspace) {
    return <WorkspaceOnboardingPage />;
  }

  return children;
}
