import {stepAttemptDetailResponseSchema} from '@shipfox/api-workflows-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {queryOptions, type UseQueryOptions, useQuery} from '@tanstack/react-query';
import type {StepAttemptDetail} from '#core/workflow-run.js';
import {toStepAttemptDetail} from './workflow-run-mapper.js';

export const STEP_ATTEMPT_DETAIL_ACTIVE_POLL_MS = 4_000;
export const STEP_ATTEMPT_DETAIL_STALE_TIME_MS = 2_000;

export const stepAttemptDetailQueryKeys = {
  all: ['workflow-step-attempt-details'] as const,
  detail: (stepId: string, attempt: number) =>
    [...stepAttemptDetailQueryKeys.all, stepId, attempt] as const,
};

type StepAttemptDetailQueryKey =
  | ReturnType<typeof stepAttemptDetailQueryKeys.detail>
  | readonly ['workflow-step-attempt-details'];

type StepAttemptDetailQueryOptions = UseQueryOptions<
  StepAttemptDetail,
  Error,
  StepAttemptDetail,
  StepAttemptDetailQueryKey
>;

async function getStepAttemptDetail({
  stepId,
  attempt,
  signal,
}: {
  stepId: string;
  attempt: number;
  signal?: AbortSignal;
}): Promise<StepAttemptDetail> {
  const response = await checkedApiRequest(
    stepAttemptDetailResponseSchema,
    `/workflows/runs/steps/${stepId}/attempts/${attempt}`,
    {signal},
  );
  return toStepAttemptDetail(response);
}

export function stepAttemptDetailQueryOptions(
  stepId: string | undefined,
  attempt: number | undefined,
  options: {polling?: boolean | undefined} = {},
): StepAttemptDetailQueryOptions {
  const polling = options.polling ?? false;
  const queryEnabled = Boolean(stepId) && attempt !== undefined;
  return queryOptions({
    queryKey:
      stepId && attempt !== undefined
        ? stepAttemptDetailQueryKeys.detail(stepId, attempt)
        : ([...stepAttemptDetailQueryKeys.all] as const),
    enabled: queryEnabled,
    queryFn: ({signal}) =>
      getStepAttemptDetail({stepId: stepId ?? '', attempt: attempt ?? 0, signal}),
    staleTime: polling ? STEP_ATTEMPT_DETAIL_STALE_TIME_MS : Infinity,
    refetchOnWindowFocus: polling,
    refetchInterval: (query) => {
      if (!queryEnabled || !polling) return false;
      if (query.state.error !== null && query.state.data === undefined) return false;
      return STEP_ATTEMPT_DETAIL_ACTIVE_POLL_MS;
    },
    refetchIntervalInBackground: false,
  });
}

export function useStepAttemptDetailQuery(
  stepId: string | undefined,
  attempt: number | undefined,
  options?: {enabled?: boolean | undefined; polling?: boolean | undefined},
) {
  return useQuery({
    ...stepAttemptDetailQueryOptions(stepId, attempt, options),
    ...options,
    enabled: Boolean(stepId) && attempt !== undefined && (options?.enabled ?? true),
  });
}
