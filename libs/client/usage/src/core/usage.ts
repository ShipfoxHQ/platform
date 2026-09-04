export type UsageJobExecutionState = 'queued' | 'running' | 'terminated';
export type UsageJobExecutionStatus = 'succeeded' | 'failed' | 'cancelled';
export type UsageInferenceDialect =
  | 'anthropic-messages'
  | 'openai-completions'
  | 'openai-responses';

export interface UsageJobExecution {
  jobId: string;
  jobExecutionId: string;
  workflowRunId: string;
  workflowRunAttemptId: string;
  workspaceId: string;
  projectId: string;
  definitionId: string | null;
  jobKey: string | null;
  runNumber: number | null;
  requestedLabels: string[] | null;
  runnerLabels: string[] | null;
  templateKey: string | null;
  provisionerId: string | null;
  provisionerScope: string | null;
  providerKind: string | null;
  launchKind: string | null;
  runnerClass: string | null;
  runnerArch: string | null;
  runnerCpu: string | null;
  managed: boolean | null;
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  leaseExpiredAt: string | null;
  status: UsageJobExecutionStatus | null;
  statusReason: string | null;
  cancellationReason: string | null;
  durationSeconds: number | null;
  state: UsageJobExecutionState | null;
  recordedAt: string | null;
}

export interface UsageInferenceSegment {
  id: string;
  segmentKey: string;
  source: 'gateway';
  workspaceId: string;
  projectId: string;
  workflowRunId: string;
  workflowRunAttemptId: string;
  jobId: string;
  jobExecutionId: string;
  stepId: string;
  stepAttemptId: string;
  upstream: string;
  model: string;
  dialect: UsageInferenceDialect;
  windowStart: string;
  windowEnd: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  recordedAt: string;
}

export interface RunUsage {
  jobExecutions: UsageJobExecution[];
  inferenceSegments: UsageInferenceSegment[];
}

export interface JobExecutionUsage {
  jobExecution: UsageJobExecution;
  inferenceSegments: UsageInferenceSegment[];
}

export interface UsageTokenTotals {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface UsageModelTotals extends UsageTokenTotals {
  model: string;
}

export interface UsageRunSummary {
  computeSeconds: number;
  totals: UsageTokenTotals;
  byModel: UsageModelTotals[];
}

export interface StepInferenceUsage extends UsageTokenTotals {
  jobExecutionId: string;
  stepId: string;
  stepAttemptId: string;
  upstream: string;
  model: string;
}

export function emptyUsageTokenTotals(): UsageTokenTotals {
  return {
    requestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  };
}

export function usageTokenTotalsForSegments(
  segments: readonly UsageInferenceSegment[],
): UsageTokenTotals {
  return segments.reduce(
    (totals, segment) => addUsageTokenTotals(totals, segment),
    emptyUsageTokenTotals(),
  );
}

export function summarizeRunUsage(usage: RunUsage): UsageRunSummary {
  const byModel = new Map<string, UsageTokenTotals>();
  for (const segment of usage.inferenceSegments) {
    const totals = byModel.get(segment.model) ?? emptyUsageTokenTotals();
    byModel.set(segment.model, addUsageTokenTotals(totals, segment));
  }

  return {
    computeSeconds: usage.jobExecutions.reduce(
      (total, execution) => total + (execution.durationSeconds ?? 0),
      0,
    ),
    totals: usageTokenTotalsForSegments(usage.inferenceSegments),
    byModel: [...byModel.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([model, totals]) => ({model, ...totals})),
  };
}

export function groupInferenceSegmentsByStepAttempt(
  segments: readonly UsageInferenceSegment[],
): StepInferenceUsage[] {
  const grouped = new Map<string, StepInferenceUsage>();
  for (const segment of segments) {
    const key = `${segment.stepAttemptId}:${segment.upstream}:${segment.model}`;
    const current = grouped.get(key);
    if (current) {
      addUsageTokenTotalsInPlace(current, segment);
      continue;
    }
    grouped.set(key, {
      jobExecutionId: segment.jobExecutionId,
      stepId: segment.stepId,
      stepAttemptId: segment.stepAttemptId,
      upstream: segment.upstream,
      model: segment.model,
      ...addUsageTokenTotals(emptyUsageTokenTotals(), segment),
    });
  }

  return [...grouped.values()].sort(
    (left, right) =>
      left.stepId.localeCompare(right.stepId) ||
      left.stepAttemptId.localeCompare(right.stepAttemptId) ||
      left.upstream.localeCompare(right.upstream) ||
      left.model.localeCompare(right.model),
  );
}

function addUsageTokenTotals(
  totals: UsageTokenTotals,
  segment: Pick<
    UsageInferenceSegment,
    | 'requestCount'
    | 'inputTokens'
    | 'outputTokens'
    | 'cacheCreationTokens'
    | 'cacheReadTokens'
    | 'reasoningTokens'
  >,
): UsageTokenTotals {
  const next = {
    requestCount: totals.requestCount + segment.requestCount,
    inputTokens: totals.inputTokens + segment.inputTokens,
    outputTokens: totals.outputTokens + segment.outputTokens,
    cacheCreationTokens: totals.cacheCreationTokens + segment.cacheCreationTokens,
    cacheReadTokens: totals.cacheReadTokens + segment.cacheReadTokens,
    reasoningTokens: totals.reasoningTokens + segment.reasoningTokens,
  };
  return {...next, totalTokens: totalTokenCount(next)};
}

function addUsageTokenTotalsInPlace(
  totals: UsageTokenTotals,
  segment: Pick<
    UsageInferenceSegment,
    | 'requestCount'
    | 'inputTokens'
    | 'outputTokens'
    | 'cacheCreationTokens'
    | 'cacheReadTokens'
    | 'reasoningTokens'
  >,
): void {
  totals.requestCount += segment.requestCount;
  totals.inputTokens += segment.inputTokens;
  totals.outputTokens += segment.outputTokens;
  totals.cacheCreationTokens += segment.cacheCreationTokens;
  totals.cacheReadTokens += segment.cacheReadTokens;
  totals.reasoningTokens += segment.reasoningTokens;
  totals.totalTokens = totalTokenCount(totals);
}

function totalTokenCount(
  totals: Pick<
    UsageTokenTotals,
    'inputTokens' | 'outputTokens' | 'cacheCreationTokens' | 'cacheReadTokens' | 'reasoningTokens'
  >,
): number {
  return (
    totals.inputTokens +
    totals.outputTokens +
    totals.cacheCreationTokens +
    totals.cacheReadTokens +
    totals.reasoningTokens
  );
}
