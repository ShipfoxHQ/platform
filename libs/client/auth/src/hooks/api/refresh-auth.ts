import type {LoginResponseDto} from '@shipfox/api-auth-dto';
import {ApiError, apiRequest} from '@shipfox/client-api';
import {useQueryClient} from '@tanstack/react-query';
import {useSetAtom} from 'jotai';
import {useCallback} from 'react';
import {authStateAtom, toAuthenticatedState} from '#state/auth.js';
import {listUserWorkspaces, userWorkspacesQueryKey} from './workspace-auth.js';

export const authRefreshQueryKey = ['auth', 'refresh'] as const;

const REFRESH_EARLY_MS = 5 * 60 * 1000;
const BASE64_URL_REPLACEMENTS = {dash: /-/g, underscore: /_/g} as const;

async function refreshAuth() {
  return await apiRequest<LoginResponseDto>('/auth/refresh', {method: 'POST'});
}

function decodeBase64Url(value: string): string {
  const base64 = value
    .replace(BASE64_URL_REPLACEMENTS.dash, '+')
    .replace(BASE64_URL_REPLACEMENTS.underscore, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  return atob(padded);
}

function readJwtExp(token: string): number | undefined {
  const [, payload] = token.split('.');
  if (!payload) return undefined;

  try {
    const parsed = JSON.parse(decodeBase64Url(payload)) as {exp?: unknown};
    return typeof parsed.exp === 'number' && Number.isFinite(parsed.exp) ? parsed.exp : undefined;
  } catch {
    return undefined;
  }
}

export function getAuthRefreshDelayMs(token: string, nowMs = Date.now()): number | undefined {
  const exp = readJwtExp(token);
  if (exp === undefined) return undefined;

  return exp * 1000 - nowMs - REFRESH_EARLY_MS;
}

export function useRefreshAuth() {
  const queryClient = useQueryClient();
  const setState = useSetAtom(authStateAtom);

  return useCallback(async () => {
    try {
      const result = await queryClient.fetchQuery({
        queryKey: authRefreshQueryKey,
        queryFn: refreshAuth,
        retry: false,
        staleTime: 0,
      });
      setState(toAuthenticatedState(result));
      try {
        const workspaces = await queryClient.fetchQuery({
          queryKey: userWorkspacesQueryKey,
          queryFn: () => listUserWorkspaces(result.token),
          retry: false,
          staleTime: 0,
        });
        setState(toAuthenticatedState(result, workspaces.memberships));
      } catch {
        // Auth is valid even if the workspace read model is temporarily unavailable.
      }
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setState({status: 'guest'});
      }
      throw error;
    }
  }, [queryClient, setState]);
}
