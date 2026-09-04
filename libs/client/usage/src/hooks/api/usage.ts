import {jobExecutionUsageResponseSchema, runUsageResponseSchema} from '@shipfox/api-usage-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {type UseQueryOptions, useQuery} from '@tanstack/react-query';
import type {JobExecutionUsage, RunUsage} from '#core/usage.js';
import {toJobExecutionUsage, toRunUsage} from './usage-mapper.js';

const USAGE_REFETCH_INTERVAL_MS = 5_000;

export const usageQueryKeys = {
  all: ['usage'] as const,
  run: (workspaceId: string, workflowRunId: string) =>
    [...usageQueryKeys.all, 'run', workspaceId, workflowRunId] as const,
  jobExecution: (workspaceId: string, jobExecutionId: string) =>
    [...usageQueryKeys.all, 'job-execution', workspaceId, jobExecutionId] as const,
};

export interface UsageRunQueryOptions {
  workspaceId: string | undefined;
  workflowRunId: string | undefined;
  enabled?: boolean;
  polling?: boolean;
}

export interface UsageJobExecutionQueryOptions {
  workspaceId: string | undefined;
  jobExecutionId: string | undefined;
  enabled?: boolean;
  polling?: boolean;
}

export async function readRunUsage({
  workspaceId,
  workflowRunId,
  signal,
}: {
  workspaceId: string;
  workflowRunId: string;
  signal?: AbortSignal;
}): Promise<RunUsage> {
  const response = await checkedApiRequest(
    runUsageResponseSchema,
    `/usage/workspaces/${encodeURIComponent(workspaceId)}/runs/${encodeURIComponent(workflowRunId)}`,
    {signal},
  );
  return toRunUsage(response);
}

export async function readJobExecutionUsage({
  workspaceId,
  jobExecutionId,
  signal,
}: {
  workspaceId: string;
  jobExecutionId: string;
  signal?: AbortSignal;
}): Promise<JobExecutionUsage> {
  const response = await checkedApiRequest(
    jobExecutionUsageResponseSchema,
    `/usage/workspaces/${encodeURIComponent(workspaceId)}/job-executions/${encodeURIComponent(jobExecutionId)}`,
    {signal},
  );
  return toJobExecutionUsage(response);
}

export function runUsageQueryOptions({
  workspaceId,
  workflowRunId,
  enabled: enabledOverride = true,
  polling = false,
}: UsageRunQueryOptions): UseQueryOptions<RunUsage> {
  const enabled = enabledOverride && Boolean(workspaceId && workflowRunId);
  return {
    queryKey:
      enabled && workspaceId && workflowRunId
        ? usageQueryKeys.run(workspaceId, workflowRunId)
        : [...usageQueryKeys.all, 'run', 'disabled'],
    enabled,
    queryFn: ({signal}) =>
      readRunUsage({workspaceId: workspaceId ?? '', workflowRunId: workflowRunId ?? '', signal}),
    staleTime: USAGE_REFETCH_INTERVAL_MS,
    refetchInterval: polling ? USAGE_REFETCH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  };
}

export function jobExecutionUsageQueryOptions({
  workspaceId,
  jobExecutionId,
  enabled: enabledOverride = true,
  polling = false,
}: UsageJobExecutionQueryOptions): UseQueryOptions<JobExecutionUsage> {
  const enabled = enabledOverride && Boolean(workspaceId && jobExecutionId);
  return {
    queryKey:
      enabled && workspaceId && jobExecutionId
        ? usageQueryKeys.jobExecution(workspaceId, jobExecutionId)
        : [...usageQueryKeys.all, 'job-execution', 'disabled'],
    enabled,
    queryFn: ({signal}) =>
      readJobExecutionUsage({
        workspaceId: workspaceId ?? '',
        jobExecutionId: jobExecutionId ?? '',
        signal,
      }),
    staleTime: USAGE_REFETCH_INTERVAL_MS,
    refetchInterval: polling ? USAGE_REFETCH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  };
}

/** Package-owned query hook for the usage records of one workflow run. */
export function useRunUsageQuery(options: UsageRunQueryOptions) {
  return useQuery(runUsageQueryOptions(options));
}

/** Package-owned query hook for one job execution and its inference segments. */
export function useJobExecutionUsageQuery(options: UsageJobExecutionQueryOptions) {
  return useQuery(jobExecutionUsageQueryOptions(options));
}

export const usageRunQueryOptions = runUsageQueryOptions;
export const usageJobExecutionQueryOptions = jobExecutionUsageQueryOptions;
