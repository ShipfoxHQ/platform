import {apiRequest} from '@shipfox/client-api';
import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useSetAtom} from 'jotai';
import {authStateAtom} from '#state/auth.js';
import {authRefreshQueryKey} from './refresh-auth.js';

async function logoutAuth() {
  try {
    await apiRequest<void>('/auth/logout', {method: 'POST', body: {}});
  } catch {
    // Logout is best-effort: local session state must clear even if the API is offline.
  }
}

export function useLogoutAuth() {
  const queryClient = useQueryClient();
  const setState = useSetAtom(authStateAtom);

  return useMutation({
    mutationFn: logoutAuth,
    onSettled: () => {
      setState({status: 'guest'});
      queryClient.removeQueries({queryKey: authRefreshQueryKey});
    },
  });
}
