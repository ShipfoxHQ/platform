import {parseLogRecordLine} from '@shipfox/api-logs-dto';
import {workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import {defineInterModulePresentation} from '@shipfox/inter-module';
import {createFakeInterModuleClients} from '@shipfox/node-module/inter-module/testing';
import {appendLogs} from '#core/append-logs.js';
import {db} from '#db/db.js';
import {getOrCreateAttemptStream} from '#db/streams.js';
import {jobAccountingFactory} from '#test/factories/job-accounting.js';
import {ndjsonBody, sessionLine} from '#test/fixtures/ndjson.js';
import {listChunks, listStreamClosedEvents} from '#test/queries.js';
import {
  createFinalizeAttemptLogStream,
  type FinalizeAttemptLogStreamParams,
} from './finalize-attempt-stream.js';

const metrics = {
  recordAppendedAdd: vi.fn(),
  streamClosedAdd: vi.fn(),
};

const finalizeAttemptLogStream = createFinalizeAttemptLogStream({
  recordAppendedCount: {add: metrics.recordAppendedAdd},
  streamClosedCount: {add: metrics.streamClosedAdd},
});

function newIdentity(
  overrides: Partial<FinalizeAttemptLogStreamParams> = {},
): FinalizeAttemptLogStreamParams {
  return {
    jobId: crypto.randomUUID(),
    stepId: crypto.randomUUID(),
    attempt: 1,
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    logOutcome: 'drained',
    ...overrides,
  };
}

describe('finalizeAttemptLogStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a missing drained stream and closes it as declared', async () => {
    const identity = newIdentity({logOutcome: 'drained'});

    const stream = await finalizeAttemptLogStream(identity);

    expect(stream.state).toBe('closed');
    expect(stream.closeReason).toBe('declared');
    expect(stream.truncated).toBe(false);
    expect(await listChunks(stream.id)).toHaveLength(0);
    expect(await listStreamClosedEvents(stream.id)).toHaveLength(1);
    expect(metrics.streamClosedAdd).toHaveBeenCalledWith(1, {reason: 'declared'});
    expect(metrics.recordAppendedAdd).not.toHaveBeenCalled();
  });

  it('closes an abandoned open stream with a runner_lost tombstone', async () => {
    const identity = newIdentity({logOutcome: 'abandoned'});
    await db().transaction((tx) => getOrCreateAttemptStream(tx, identity));

    const stream = await finalizeAttemptLogStream(identity);

    expect(stream.state).toBe('closed');
    expect(stream.closeReason).toBe('timeout');
    expect(stream.truncated).toBe(true);
    const chunks = await listChunks(stream.id);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.origin).toBe('control');
    const records = chunks[0]?.data
      .toString('utf8')
      .split('\n')
      .filter(Boolean)
      .map(parseLogRecordLine);
    expect(records).toMatchObject([{type: 'runner_lost'}]);
    expect(await listStreamClosedEvents(stream.id)).toHaveLength(1);
    expect(metrics.streamClosedAdd).toHaveBeenCalledWith(1, {reason: 'timeout'});
    expect(metrics.recordAppendedAdd).toHaveBeenCalledWith(1, {kind: 'runner_lost'});
  });

  it.each([
    {logOutcome: 'drained' as const, expectedOrigins: ['runner', 'control']},
    {logOutcome: 'abandoned' as const, expectedOrigins: ['runner', 'control', 'control']},
  ])('flushes a pending Claude result before a $logOutcome close', async ({
    logOutcome,
    expectedOrigins,
  }) => {
    const identity = newIdentity({logOutcome});
    await jobAccountingFactory.create({
      jobId: identity.jobId,
      workspaceId: identity.workspaceId,
      startedAt: new Date(Date.now() - 60 * 60_000),
    });
    const workflows = createFakeInterModuleClients({
      workflows: defineInterModulePresentation(workflowsInterModuleContract, {
        startRunFromTrigger: vi.fn(),
        startDevRun: vi.fn(),
        resolveWorkflowRunTriggerReference: vi.fn(),
        deliverEventToJobListener: vi.fn(),
        getStepLogContext: () => ({harness: 'claude' as const}),
        listJobStepAttempts: vi.fn(),
        getLeasedAgentToolContext: vi.fn(),
        getLeasedAgentSessionContext: vi.fn(),
        listWorkflowRuns: vi.fn(),
        getWorkflowRunDetail: vi.fn(),
        getStepAttemptDetail: vi.fn(),
        getLatestRunAttempt: vi.fn(),
        getLatestStepAttempt: vi.fn(),
      }),
    }).workflows;
    const body = ndjsonBody(
      sessionLine(JSON.stringify({type: 'system', subtype: 'init', session_id: 'session-1'})),
      sessionLine(JSON.stringify({type: 'result', subtype: 'success', result: 'response'})),
    );

    await appendLogs({...identity, offset: 0, body}, workflows);
    const stream = await finalizeAttemptLogStream(identity);
    const chunks = await listChunks(stream.id);
    const records = chunks.flatMap((chunk) =>
      chunk.data.toString('utf8').split('\n').filter(Boolean).map(parseLogRecordLine),
    );

    expect(chunks.map((chunk) => chunk.origin)).toEqual(expectedOrigins);
    expect(
      records.flatMap((record) =>
        record.type === 'agent_session' && record.row.kind === 'lifecycle'
          ? [record.row.label]
          : [],
      ),
    ).toEqual(['Session started', 'Session completed']);
    if (logOutcome === 'abandoned') {
      expect(records.map((record) => record.type)).toEqual([
        'agent_session',
        'agent_session',
        'runner_lost',
      ]);
    }
    expect(stream.claudePendingResult).toBeNull();
  });

  it('does not emit another tombstone or close event when finalized again', async () => {
    const identity = newIdentity({logOutcome: 'abandoned'});

    const first = await finalizeAttemptLogStream(identity);
    const second = await finalizeAttemptLogStream(identity);

    expect(second.id).toBe(first.id);
    expect(second.state).toBe('closed');
    expect(await listChunks(first.id)).toHaveLength(1);
    expect(await listStreamClosedEvents(first.id)).toHaveLength(1);
    expect(metrics.streamClosedAdd).toHaveBeenCalledTimes(1);
    expect(metrics.recordAppendedAdd).toHaveBeenCalledTimes(1);
  });
});
