import {type QueryClient, useQueryClient} from '@tanstack/react-query';
import {useCallback} from 'react';
import type {IntegrationConnection} from '#core/models.js';
import {integrationsQueryKeys} from '#hooks/api/integrations.js';

export interface CompleteIntegrationCallbackOptions<TInput> {
  input: TInput;
  refreshAuth: () => Promise<{accessToken: string}>;
  complete: (input: TInput, accessToken: string) => Promise<IntegrationConnection>;
  queryClient: QueryClient;
}

export interface CompleteIntegrationCallbackResultOptions<TInput, TResult> {
  input: TInput;
  refreshAuth: () => Promise<{accessToken: string}>;
  complete: (input: TInput, accessToken: string) => Promise<TResult>;
  getConnection: (result: TResult) => IntegrationConnection | undefined;
  queryClient: QueryClient;
}

export async function completeIntegrationCallback<TInput>({
  input,
  refreshAuth,
  complete,
  queryClient,
}: CompleteIntegrationCallbackOptions<TInput>): Promise<IntegrationConnection> {
  return await completeIntegrationCallbackResultInternal({
    input,
    refreshAuth,
    complete,
    getConnection: (result) => result,
    queryClient,
  });
}

export async function completeIntegrationCallbackResult<TInput, TResult>({
  input,
  refreshAuth,
  complete,
  getConnection,
  queryClient,
}: CompleteIntegrationCallbackResultOptions<TInput, TResult>): Promise<TResult> {
  return await completeIntegrationCallbackResultInternal({
    input,
    refreshAuth,
    complete,
    getConnection,
    queryClient,
  });
}

async function completeIntegrationCallbackResultInternal<TInput, TResult>({
  input,
  refreshAuth,
  complete,
  getConnection,
  queryClient,
}: CompleteIntegrationCallbackResultOptions<TInput, TResult>): Promise<TResult> {
  const session = await refreshAuth();
  const result = await complete(input, session.accessToken);
  const connection = getConnection(result);
  if (connection) {
    try {
      await queryClient.invalidateQueries({
        queryKey: integrationsQueryKeys.connectionsByWorkspace(connection.workspaceId),
      });
    } catch {
      // Cache refresh is best effort: the callback is already committed server-side.
    }
  }
  return result;
}

export function useCompleteIntegrationCallback() {
  const queryClient = useQueryClient();
  return useCallback(
    async <TInput>(
      options: Omit<CompleteIntegrationCallbackOptions<TInput>, 'queryClient'>,
    ): Promise<IntegrationConnection> => completeIntegrationCallback({...options, queryClient}),
    [queryClient],
  );
}

export function useCompleteIntegrationCallbackResult() {
  const queryClient = useQueryClient();
  return useCallback(
    async <TInput, TResult>(
      options: Omit<CompleteIntegrationCallbackResultOptions<TInput, TResult>, 'queryClient'>,
    ): Promise<TResult> => completeIntegrationCallbackResult({...options, queryClient}),
    [queryClient],
  );
}
