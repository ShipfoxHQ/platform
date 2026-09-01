import {Buffer} from 'node:buffer';
import {gzipSync} from 'node:zlib';
import type {AttemptStream} from '#core/entities/attempt-stream.js';
import {type ReadStepLogTailDependencies, readStepLogTail} from './read-step-log-tail.js';

const mocks = vi.hoisted(() => ({
  getAttemptStreamById: vi.fn(),
  getObjectBytes: vi.fn(),
  getObjectStream: vi.fn(),
  getStreamByStepAttempt: vi.fn(),
  readChunksReverse: vi.fn(),
}));

const dependencies: ReadStepLogTailDependencies = {
  compactedTailObjectKey: (key) => `${key}.tail`,
  getAttemptStreamById: mocks.getAttemptStreamById,
  getObjectBytes: mocks.getObjectBytes,
  getObjectStream: mocks.getObjectStream,
  getStreamByStepAttempt: mocks.getStreamByStepAttempt,
  readChunksReverse: mocks.readChunksReverse,
};

function stream(overrides: Partial<AttemptStream> = {}): AttemptStream {
  return {
    id: 'stream-id',
    jobId: 'job-id',
    stepId: 'step-id',
    attempt: 1,
    workspaceId: 'workspace-id',
    projectId: 'project-id',
    workflowRunAttemptId: 'run-attempt-id',
    committedLength: 0,
    state: 'closed',
    closeReason: 'declared',
    declaredTotalBytes: 0,
    claudeHasInit: false,
    claudeSessionId: null,
    claudeTurn: 0,
    claudePendingResult: null,
    claudePendingToolRows: [],
    truncated: false,
    lineCount: null,
    compactionUploadKeys: [],
    objectKey: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    closedAt: new Date(0),
    ...overrides,
  };
}

describe('readStepLogTail compaction boundary', () => {
  beforeEach(() => {
    mocks.getAttemptStreamById.mockReset();
    mocks.getObjectBytes.mockReset();
    mocks.getObjectStream.mockReset();
    mocks.getStreamByStepAttempt.mockReset();
    mocks.readChunksReverse.mockReset();
    mocks.readChunksReverse.mockResolvedValue({rows: [], hasMore: false});
  });

  it('retries on the cold artifact when compaction publishes during an empty hot read', async () => {
    const hot = stream();
    const cold = stream({objectKey: 'full-key', lineCount: 1});
    mocks.getStreamByStepAttempt.mockResolvedValue(hot);
    mocks.getAttemptStreamById.mockResolvedValue(cold);
    mocks.getObjectBytes.mockResolvedValue(
      gzipSync(Buffer.from('{"v":1,"ts":1,"type":"output","stream":"stdout","data":"done\\n"}\n')),
    );

    const result = await readStepLogTail(
      {stepId: hot.stepId, attempt: 1, tailLines: 1},
      dependencies,
    );

    expect(result?.content).toContain('done');
    expect(result?.totalLines).toBe(1);
    expect(mocks.getAttemptStreamById).toHaveBeenCalledWith(hot.id);
  });

  it('returns the empty hot result when the closed row is still uncompacted', async () => {
    const hot = stream();
    mocks.getStreamByStepAttempt.mockResolvedValue(hot);
    mocks.getAttemptStreamById.mockResolvedValue(hot);

    const result = await readStepLogTail(
      {stepId: hot.stepId, attempt: 1, tailLines: 1},
      dependencies,
    );

    expect(result).toEqual({content: ''});
    expect(mocks.getObjectBytes).not.toHaveBeenCalled();
  });
});
