const mocks = vi.hoisted(() => ({
  executionAdd: vi.fn(),
  failureAdd: vi.fn(),
  retryAdd: vi.fn(),
  durationRecord: vi.fn(),
}));

vi.mock('@shipfox/node-opentelemetry', () => ({
  instanceMetrics: {
    getMeter: () => ({
      createCounter: (name: string) => {
        let add = mocks.retryAdd;
        if (name.endsWith('_execution')) add = mocks.executionAdd;
        else if (name.endsWith('_failure')) add = mocks.failureAdd;
        return {add};
      },
      createHistogram: () => ({record: mocks.durationRecord}),
    }),
  },
}));

import {instrumentModuleActivities} from './metrics.js';

afterEach(() => {
  vi.clearAllMocks();
});

describe('instrumentModuleActivities', () => {
  it('records successful first-attempt processing with bounded labels', async () => {
    const activities = instrumentModuleActivities({
      moduleName: 'definitions',
      taskQueue: 'definitions-sync',
      activities: {syncDefinition: async (value: string) => `synced:${value}`},
      getAttempt: () => 1,
    }) as {syncDefinition(value: string): Promise<string>};

    const result = await activities.syncDefinition('definition-id');

    expect(result).toBe('synced:definition-id');
    expect(mocks.executionAdd).toHaveBeenCalledWith(1, {
      module: 'definitions',
      task_queue: 'definitions-sync',
      activity: 'syncDefinition',
      outcome: 'success',
    });
    expect(mocks.retryAdd).not.toHaveBeenCalled();
    expect(mocks.durationRecord).toHaveBeenCalledWith(expect.any(Number), expect.any(Object));
  });

  it('records retries and failures without arguments or error messages as labels', async () => {
    const failure = new Error('object key secret/path');
    const activities = instrumentModuleActivities({
      moduleName: 'logs',
      taskQueue: 'logs-compaction',
      activities: {compact: () => Promise.reject(failure)},
      getAttempt: () => 2,
    }) as {compact(value: string): Promise<void>};

    const result = activities.compact('object-key-123');

    await expect(result).rejects.toBe(failure);
    const labels = {
      module: 'logs',
      task_queue: 'logs-compaction',
      activity: 'compact',
    };
    expect(mocks.retryAdd).toHaveBeenCalledWith(1, labels);
    expect(mocks.failureAdd).toHaveBeenCalledWith(1, labels);
    expect(mocks.executionAdd).toHaveBeenCalledWith(1, {...labels, outcome: 'failure'});
  });

  it('records a successful retry separately from a first attempt', async () => {
    const activities = instrumentModuleActivities({
      moduleName: 'projects',
      taskQueue: 'projects-sync',
      activities: {sync: async () => 'synced'},
      getAttempt: () => 3,
    }) as {sync(): Promise<string>};

    const result = await activities.sync();

    expect(result).toBe('synced');
    expect(mocks.retryAdd).toHaveBeenCalledWith(1, {
      module: 'projects',
      task_queue: 'projects-sync',
      activity: 'sync',
    });
    expect(mocks.executionAdd).toHaveBeenCalledWith(
      1,
      expect.objectContaining({outcome: 'success'}),
    );
  });
});
