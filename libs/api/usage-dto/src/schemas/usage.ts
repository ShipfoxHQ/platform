import {z} from 'zod';

const idSchema = z.string().uuid();
const nonEmptyStringSchema = z.string().min(1);
const dateTimeSchema = z.string().datetime();
const inferenceWindowDateTimeSchema = z.string().datetime({precision: 3});
const usageCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const MAX_USAGE_REPLAY_LIMIT = 500;
export const MAX_INFERENCE_SEGMENTS_BATCH_SIZE = 1_000;

export const usageJobExecutionStateSchema = z.enum(['queued', 'running', 'terminated']);
export const usageJobExecutionStatusSchema = z.enum(['succeeded', 'failed', 'cancelled']);

/** The durable, internal representation shared by Usage events and list cursors. */
export const jobExecutionUsageSchema = z
  .object({
    jobExecutionId: idSchema,
    jobId: idSchema,
    workflowRunId: idSchema,
    workflowRunAttemptId: idSchema,
    workspaceId: idSchema.nullable(),
    projectId: idSchema.nullable(),
    definitionId: idSchema.nullable(),
    jobKey: nonEmptyStringSchema.nullable(),
    runNumber: z.number().int().positive().nullable(),
    requestedLabels: z.array(nonEmptyStringSchema).nullable(),
    runnerLabels: z.array(nonEmptyStringSchema).nullable(),
    templateKey: nonEmptyStringSchema.nullable(),
    provisionerId: idSchema.nullable(),
    provisionerScope: nonEmptyStringSchema.nullable(),
    providerKind: nonEmptyStringSchema.nullable(),
    launchKind: nonEmptyStringSchema.nullable(),
    runnerClass: nonEmptyStringSchema.nullable(),
    runnerArch: nonEmptyStringSchema.nullable(),
    runnerCpu: nonEmptyStringSchema.nullable(),
    managed: z.boolean().nullable(),
    queuedAt: dateTimeSchema.nullable(),
    startedAt: dateTimeSchema.nullable(),
    finishedAt: dateTimeSchema.nullable(),
    leaseExpiredAt: dateTimeSchema.nullable(),
    status: usageJobExecutionStatusSchema.nullable(),
    statusReason: nonEmptyStringSchema.nullable(),
    cancellationReason: nonEmptyStringSchema.nullable(),
    durationSeconds: z.number().finite().nonnegative().nullable(),
    state: usageJobExecutionStateSchema.nullable(),
    recordedAt: dateTimeSchema.nullable(),
  })
  .strict();

export type JobExecutionUsageDto = z.infer<typeof jobExecutionUsageSchema>;

export const recordedJobExecutionUsageSchema = jobExecutionUsageSchema
  .extend({version: z.literal(1), recordedAt: dateTimeSchema})
  .strict();
export type RecordedJobExecutionUsageDto = z.infer<typeof recordedJobExecutionUsageSchema>;

const inferenceSegmentInputObjectSchema = z
  .object({
    segmentKey: nonEmptyStringSchema.max(512),
    source: z.literal('gateway'),
    workspaceId: idSchema,
    projectId: idSchema,
    workflowRunId: idSchema,
    workflowRunAttemptId: idSchema,
    jobId: idSchema,
    jobExecutionId: idSchema,
    stepId: idSchema,
    stepAttemptId: idSchema,
    upstream: nonEmptyStringSchema,
    model: nonEmptyStringSchema,
    dialect: z.enum(['anthropic-messages', 'openai-completions', 'openai-responses']),
    windowStart: inferenceWindowDateTimeSchema,
    windowEnd: inferenceWindowDateTimeSchema,
    requestCount: usageCountSchema,
    inputTokens: usageCountSchema,
    outputTokens: usageCountSchema,
    cacheCreationTokens: usageCountSchema,
    cacheReadTokens: usageCountSchema,
    reasoningTokens: usageCountSchema,
    webSearchRequests: usageCountSchema,
  })
  .strict();

export const inferenceSegmentInputSchema =
  inferenceSegmentInputObjectSchema.superRefine(validateInferenceWindow);
export type InferenceSegmentInputDto = z.infer<typeof inferenceSegmentInputSchema>;

const inferenceSegmentUsageObjectSchema = inferenceSegmentInputObjectSchema
  .extend({id: idSchema, recordedAt: dateTimeSchema})
  .strict();
export const inferenceSegmentUsageSchema =
  inferenceSegmentUsageObjectSchema.superRefine(validateInferenceWindow);
export type InferenceSegmentUsageDto = z.infer<typeof inferenceSegmentUsageSchema>;

export const jobExecutionUsageHttpSchema = z
  .object({
    job_id: idSchema,
    job_execution_id: idSchema,
    workflow_run_id: idSchema,
    workflow_run_attempt_id: idSchema,
    workspace_id: idSchema,
    project_id: idSchema,
    definition_id: idSchema.nullable(),
    job_key: nonEmptyStringSchema.nullable(),
    run_number: z.number().int().positive().nullable(),
    requested_labels: z.array(nonEmptyStringSchema).nullable(),
    runner_labels: z.array(nonEmptyStringSchema).nullable(),
    template_key: nonEmptyStringSchema.nullable(),
    provisioner_id: idSchema.nullable(),
    provisioner_scope: nonEmptyStringSchema.nullable(),
    provider_kind: nonEmptyStringSchema.nullable(),
    launch_kind: nonEmptyStringSchema.nullable(),
    runner_class: nonEmptyStringSchema.nullable(),
    runner_arch: nonEmptyStringSchema.nullable(),
    runner_cpu: nonEmptyStringSchema.nullable(),
    managed: z.boolean().nullable(),
    queued_at: dateTimeSchema.nullable(),
    started_at: dateTimeSchema.nullable(),
    finished_at: dateTimeSchema.nullable(),
    lease_expired_at: dateTimeSchema.nullable(),
    status: usageJobExecutionStatusSchema.nullable(),
    status_reason: nonEmptyStringSchema.nullable(),
    cancellation_reason: nonEmptyStringSchema.nullable(),
    duration_seconds: z.number().finite().nonnegative().nullable(),
    state: usageJobExecutionStateSchema.nullable(),
    recorded_at: dateTimeSchema.nullable(),
  })
  .strict();
export type JobExecutionUsageHttpDto = z.infer<typeof jobExecutionUsageHttpSchema>;

const inferenceSegmentUsageHttpObjectSchema = z
  .object({
    id: idSchema,
    segment_key: nonEmptyStringSchema,
    source: z.literal('gateway'),
    workspace_id: idSchema,
    project_id: idSchema,
    workflow_run_id: idSchema,
    workflow_run_attempt_id: idSchema,
    job_id: idSchema,
    job_execution_id: idSchema,
    step_id: idSchema,
    step_attempt_id: idSchema,
    upstream: nonEmptyStringSchema,
    model: nonEmptyStringSchema,
    dialect: z.enum(['anthropic-messages', 'openai-completions', 'openai-responses']),
    window_start: inferenceWindowDateTimeSchema,
    window_end: inferenceWindowDateTimeSchema,
    request_count: usageCountSchema,
    input_tokens: usageCountSchema,
    output_tokens: usageCountSchema,
    cache_creation_tokens: usageCountSchema,
    cache_read_tokens: usageCountSchema,
    reasoning_tokens: usageCountSchema,
    web_search_requests: usageCountSchema,
    recorded_at: dateTimeSchema,
  })
  .strict();
export const inferenceSegmentUsageHttpSchema = inferenceSegmentUsageHttpObjectSchema.superRefine(
  validateInferenceHttpWindow,
);
export type InferenceSegmentUsageHttpDto = z.infer<typeof inferenceSegmentUsageHttpSchema>;

export const runUsageResponseSchema = z
  .object({
    job_executions: z.array(jobExecutionUsageHttpSchema),
    inference_segments: z.array(inferenceSegmentUsageHttpSchema),
  })
  .strict();
export type RunUsageResponseDto = z.infer<typeof runUsageResponseSchema>;

export const jobExecutionUsageResponseSchema = z
  .object({
    job_execution: jobExecutionUsageHttpSchema,
    inference_segments: z.array(inferenceSegmentUsageHttpSchema),
  })
  .strict();
export type JobExecutionUsageResponseDto = z.infer<typeof jobExecutionUsageResponseSchema>;

// Descriptive aliases keep the route names discoverable without creating a second schema.
export const usageRunResponseSchema = runUsageResponseSchema;
export const usageJobExecutionResponseSchema = jobExecutionUsageResponseSchema;

const MAX_INFERENCE_SEGMENT_WINDOW_MS = 60 * 60 * 1_000;

function validateInferenceWindow(
  value: {windowStart: string; windowEnd: string},
  context: z.RefinementCtx,
): void {
  validateWindow(value.windowStart, value.windowEnd, ['windowEnd'], context);
}

function validateInferenceHttpWindow(
  value: {window_start: string; window_end: string},
  context: z.RefinementCtx,
): void {
  validateWindow(value.window_start, value.window_end, ['window_end'], context);
}

function validateWindow(
  windowStart: string,
  windowEnd: string,
  path: string[],
  context: z.RefinementCtx,
): void {
  const start = Date.parse(windowStart);
  const end = Date.parse(windowEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  if (end < start) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: 'windowEnd must be at or after windowStart',
    });
  }
  if (end - start > MAX_INFERENCE_SEGMENT_WINDOW_MS) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: 'Inference segment windows cannot exceed one hour',
    });
  }
}
