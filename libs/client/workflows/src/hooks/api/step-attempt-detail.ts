import {stepAttemptDetailResponseSchema} from '@shipfox/api-workflows-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {queryOptions, type UseQueryOptions, useQuery} from '@tanstack/react-query';
import type {StepAttemptDetail} from '#core/workflow-run.js';
import {toStepAttemptDetail} from './workflow-run-mapper.js';

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
): StepAttemptDetailQueryOptions {
  return queryOptions({
    queryKey:
      stepId && attempt !== undefined
        ? stepAttemptDetailQueryKeys.detail(stepId, attempt)
        : ([...stepAttemptDetailQueryKeys.all] as const),
    enabled: Boolean(stepId) && attempt !== undefined,
    queryFn: ({signal}) =>
      getStepAttemptDetail({stepId: stepId ?? '', attempt: attempt ?? 0, signal}),
    staleTime: Infinity,
  });
}

export function useStepAttemptDetailQuery(
  stepId: string | undefined,
  attempt: number | undefined,
  options?: {enabled?: boolean | undefined},
) {
  return useQuery({
    ...stepAttemptDetailQueryOptions(stepId, attempt),
    ...options,
    enabled: Boolean(stepId) && attempt !== undefined && (options?.enabled ?? true),
  });
}
