import {
  USAGE_INFERENCE_SEGMENT_RECORDED,
  USAGE_JOB_EXECUTION_RECORDED,
  type UsageEventMap,
  usageEventSchemas,
  usageInferenceSegmentRecordedEventSchema,
  usageJobExecutionRecordedEventSchema,
} from './events.js';
import {inferenceSegmentInputSchema} from './schemas/usage.js';

const ids = {
  workspaceId: crypto.randomUUID(),
  projectId: crypto.randomUUID(),
  workflowRunId: crypto.randomUUID(),
  workflowRunAttemptId: crypto.randomUUID(),
  jobId: crypto.randomUUID(),
  jobExecutionId: crypto.randomUUID(),
  stepId: crypto.randomUUID(),
  stepAttemptId: crypto.randomUUID(),
};

const validJobExecution = {
  jobExecutionId: ids.jobExecutionId,
  jobId: ids.jobId,
  workflowRunId: ids.workflowRunId,
  workflowRunAttemptId: ids.workflowRunAttemptId,
  workspaceId: ids.workspaceId,
  projectId: ids.projectId,
  definitionId: crypto.randomUUID(),
  jobKey: 'build',
  runNumber: 3,
  requestedLabels: ['linux'],
  runnerLabels: ['arch.x64', 'class.standard', 'cpu.2', 'linux', 'shipfox-managed'],
  templateKey: 'standard',
  provisionerId: crypto.randomUUID(),
  provisionerScope: 'installation',
  providerKind: 'aws',
  launchKind: 'demand',
  runnerClass: 'standard',
  runnerArch: 'x64',
  runnerCpu: '2',
  managed: true,
  queuedAt: '2026-09-04T10:00:00.000Z',
  startedAt: '2026-09-04T10:00:01.000Z',
  finishedAt: '2026-09-04T10:00:11.000Z',
  leaseExpiredAt: null,
  status: 'succeeded' as const,
  statusReason: 'completed',
  cancellationReason: null,
  durationSeconds: 10,
  state: 'terminated' as const,
  recordedAt: '2026-09-04T10:00:11.000Z',
};

const validSegment = {
  id: crypto.randomUUID(),
  segmentKey: 'gateway:segment-1',
  source: 'gateway' as const,
  ...ids,
  upstream: 'openai',
  model: 'gpt-5',
  dialect: 'openai-responses' as const,
  windowStart: '2026-09-04T10:00:00.000Z',
  windowEnd: '2026-09-04T10:01:00.000Z',
  requestCount: 2,
  inputTokens: 10,
  outputTokens: 20,
  cacheCreationTokens: 0,
  cacheReadTokens: 4,
  reasoningTokens: 6,
  webSearchRequests: 1,
  recordedAt: '2026-09-04T10:01:00.000Z',
};

describe('Usage event contracts', () => {
  it('registers the strict v1 event map', () => {
    expect(Object.keys(usageEventSchemas).sort()).toEqual(
      [USAGE_INFERENCE_SEGMENT_RECORDED, USAGE_JOB_EXECUTION_RECORDED].sort() satisfies Array<
        keyof UsageEventMap
      >,
    );

    expect(usageJobExecutionRecordedEventSchema.parse({...validJobExecution, version: 1})).toEqual({
      ...validJobExecution,
      version: 1,
    });
    expect(usageInferenceSegmentRecordedEventSchema.parse({...validSegment, version: 1})).toEqual({
      ...validSegment,
      version: 1,
    });

    const {webSearchRequests, ...legacySegment} = validSegment;
    void webSearchRequests;
    expect(usageInferenceSegmentRecordedEventSchema.parse({...legacySegment, version: 1})).toEqual({
      ...legacySegment,
      webSearchRequests: 0,
      version: 1,
    });
  });

  it('rejects unknown fields and non-v1 event versions', () => {
    expect(() =>
      usageJobExecutionRecordedEventSchema.parse({...validJobExecution, version: 2}),
    ).toThrow();
    expect(() =>
      usageInferenceSegmentRecordedEventSchema.parse({...validSegment, version: 1, extra: true}),
    ).toThrow();
  });

  it('accepts the maximum persisted web-search count', () => {
    const {id, recordedAt, ...validInputSegment} = validSegment;
    void id;
    void recordedAt;
    expect(
      inferenceSegmentInputSchema.parse({
        ...validInputSegment,
        webSearchRequests: 2_147_483_647,
      }),
    ).toEqual({...validInputSegment, webSearchRequests: 2_147_483_647});
    expect(
      usageInferenceSegmentRecordedEventSchema.parse({
        ...validSegment,
        webSearchRequests: 2_147_483_647,
        version: 1,
      }),
    ).toMatchObject({webSearchRequests: 2_147_483_647});
  });

  it('rejects invalid inference windows and unsafe counters', () => {
    expect(() =>
      usageInferenceSegmentRecordedEventSchema.parse({
        ...validSegment,
        windowEnd: '2026-09-04T09:59:00.000Z',
        version: 1,
      }),
    ).toThrow();
    expect(() =>
      usageInferenceSegmentRecordedEventSchema.parse({
        ...validSegment,
        windowEnd: '2026-09-04T11:01:00.000Z',
        version: 1,
      }),
    ).toThrow();
    expect(() =>
      usageInferenceSegmentRecordedEventSchema.parse({
        ...validSegment,
        windowEnd: '2026-09-04T10:00:00.0001Z',
        version: 1,
      }),
    ).toThrow();
    expect(() =>
      usageInferenceSegmentRecordedEventSchema.parse({
        ...validSegment,
        inputTokens: Number.MAX_SAFE_INTEGER + 1,
        version: 1,
      }),
    ).toThrow();
    expect(() =>
      usageInferenceSegmentRecordedEventSchema.parse({
        ...validSegment,
        webSearchRequests: 2_147_483_648,
        version: 1,
      }),
    ).toThrow();
  });
});
