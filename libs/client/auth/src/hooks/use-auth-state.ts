import {useAtomValue} from 'jotai';
import {useMemo} from 'react';
import {type AuthState, authStateAtom} from '#state/auth.js';

export interface AuthStateValue extends AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  workspaces: NonNullable<AuthState['workspaces']>;
  hasWorkspace: boolean;
}

export function useAuthState(): AuthStateValue {
  const state = useAtomValue(authStateAtom);

  return useMemo(
    () => ({
      ...state,
      workspaces: state.workspaces ?? [],
      isLoading: state.status === 'loading',
      isAuthenticated: state.status === 'authenticated',
      hasWorkspace: (state.workspaces ?? []).length > 0,
    }),
    [state],
  );
}
