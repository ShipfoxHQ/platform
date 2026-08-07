import {
  calculateRunnerInstanceCountDivergences,
  nextBackoffInterval,
  pollDemand,
  shouldReturn,
} from '#core/demand.js';

describe('shouldReturn', () => {
  const emptyResult = {stats: [], reservations: [], terminateRunnerInstanceIds: []};

  it('returns true for observe-only requests', () => {
    const result = shouldReturn(emptyResult, 0, 1, false);

    expect(result).toBe(true);
  });

  it('returns true when no capacity is advertised', () => {
    const result = shouldReturn(emptyResult, 1, 0, false);

    expect(result).toBe(true);
  });

  it('returns true when reservations were granted', () => {
    const result = shouldReturn(
      {
        stats: [],
        reservations: [
          {reservationId: crypto.randomUUID(), labels: ['linux'], count: 1, expiresAt: new Date()},
        ],
        terminateRunnerInstanceIds: [],
      },
      1,
      1,
      false,
    );

    expect(result).toBe(true);
  });

  it('returns true when only a rebound reservation was created', () => {
    const result = shouldReturn({...emptyResult, newlyReservedCount: 1}, 1, 1, false);

    expect(result).toBe(true);
  });

  it('returns true when terminate intents exist', () => {
    const result = shouldReturn(
      {...emptyResult, terminateRunnerInstanceIds: ['provisioned-runner-1']},
      1,
      1,
      false,
    );

    expect(result).toBe(true);
  });

  it('continues waiting for a retry-only activation-timeout intent', () => {
    const result = shouldReturn(
      {...emptyResult, terminateRunnerInstanceIds: ['stale-demand-runner']},
      1,
      1,
      false,
      [
        {
          providerRunnerId: 'stale-demand-runner',
          reason: 'activation-timeout',
          activationTimeoutRetry: true,
        },
      ],
    );

    expect(result).toBe(false);
  });

  it('returns true when the deadline passed', () => {
    const result = shouldReturn(emptyResult, 1, 1, true);

    expect(result).toBe(true);
  });

  it('returns false while demand is fully reserved and the deadline has not passed', () => {
    const result = shouldReturn(emptyResult, 1, 1, false);

    expect(result).toBe(false);
  });
});

describe('pollDemand', () => {
  it('returns immediately when wait seconds is zero', async () => {
    const result = await pollDemand({
      workspaceId: crypto.randomUUID(),
      provisionerId: crypto.randomUUID(),
      maxReservations: 1,
      waitSeconds: 0,
      ttlSeconds: 60,
      terminateIntentLimit: 1000,
      templates: [
        {templateKey: 'linux', labels: ['linux'], availableSlots: 1, starting: 0, running: 0},
      ],
      signal: new AbortController().signal,
    });

    expect(result).toEqual({stats: [], reservations: [], terminateRunnerInstanceIds: []});
  });

  it('returns immediately when terminate intents exist without reservation demand', async () => {
    vi.resetModules();
    const pollDemandAndReserveTx = vi
      .fn()
      .mockResolvedValue({stats: [], reservations: [], newlyReservedUnits: []});
    const listProvisionerTerminateIntentRowsTx = vi
      .fn()
      .mockResolvedValue([{providerRunnerId: 'provisioned-runner-1', reason: 'job-cancelled'}]);
    const listActiveRunnerInstanceCountsByTemplateTx = vi.fn().mockResolvedValue([]);
    vi.doMock('#db/db.js', () => ({
      db: () => ({transaction: (callback: (tx: unknown) => Promise<unknown>) => callback({})}),
    }));
    vi.doMock('#db/reservations.js', () => ({
      deleteReservationsByIds: vi.fn(),
      pollDemandAndReserveTx,
    }));
    vi.doMock('#db/runner-instances.js', () => ({
      listActiveRunnerInstanceCountsByTemplateTx,
      listProvisionerTerminateIntentRowsTx,
    }));

    try {
      const {pollDemand: mockedPollDemand} = await import('#core/demand.js');

      const result = await mockedPollDemand({
        workspaceId: crypto.randomUUID(),
        provisionerId: crypto.randomUUID(),
        maxReservations: 1,
        waitSeconds: 60,
        ttlSeconds: 60,
        terminateIntentLimit: 1000,
        templates: [
          {templateKey: 'linux', labels: ['linux'], availableSlots: 1, starting: 0, running: 0},
        ],
        signal: new AbortController().signal,
      });

      expect(result).toEqual({
        stats: [],
        reservations: [],
        terminateRunnerInstanceIds: ['provisioned-runner-1'],
      });
      expect(pollDemandAndReserveTx).toHaveBeenCalledOnce();
      expect(listProvisionerTerminateIntentRowsTx).toHaveBeenCalledOnce();
    } finally {
      vi.doUnmock('#db/db.js');
      vi.doUnmock('#db/reservations.js');
      vi.doUnmock('#db/runner-instances.js');
      vi.resetModules();
    }
  });

  it('does not return immediately for retry-only activation-timeout intents', async () => {
    vi.resetModules();
    const abortController = new AbortController();
    let listCalls = 0;
    const pollDemandAndReserveTx = vi
      .fn()
      .mockResolvedValue({stats: [], reservations: [], newlyReservedUnits: []});
    const listProvisionerTerminateIntentRowsTx = vi.fn().mockImplementation(() => {
      listCalls += 1;
      if (listCalls === 2) abortController.abort();
      return [
        {
          providerRunnerId: 'stale-demand-runner',
          reason: 'activation-timeout',
          activationTimeoutRetry: true,
        },
      ];
    });
    const listActiveRunnerInstanceCountsByTemplateTx = vi.fn().mockResolvedValue([]);
    vi.doMock('#db/db.js', () => ({
      db: () => ({transaction: (callback: (tx: unknown) => Promise<unknown>) => callback({})}),
    }));
    vi.doMock('#db/reservations.js', () => ({
      deleteReservationsByIds: vi.fn(),
      pollDemandAndReserveTx,
    }));
    vi.doMock('#db/runner-instances.js', () => ({
      listActiveRunnerInstanceCountsByTemplateTx,
      listProvisionerTerminateIntentRowsTx,
    }));
    vi.doMock('#metrics/instance.js', () => ({
      providerRunnerActivationOutcomeCount: {add: vi.fn()},
      providerRunnerCountDivergenceCount: {add: vi.fn()},
      providerRunnerTerminateIntentIssuedCount: {add: vi.fn()},
    }));
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);

    try {
      const {pollDemand: mockedPollDemand} = await import('#core/demand.js');

      const result = await mockedPollDemand({
        workspaceId: crypto.randomUUID(),
        provisionerId: crypto.randomUUID(),
        maxReservations: 1,
        waitSeconds: 60,
        ttlSeconds: 60,
        terminateIntentLimit: 1000,
        templates: [
          {templateKey: 'linux', labels: ['linux'], availableSlots: 1, starting: 0, running: 0},
        ],
        signal: abortController.signal,
      });

      expect(result).toEqual({
        stats: [],
        reservations: [],
        terminateRunnerInstanceIds: ['stale-demand-runner'],
      });
      expect(listProvisionerTerminateIntentRowsTx).toHaveBeenCalledTimes(2);
    } finally {
      random.mockRestore();
      vi.doUnmock('#db/db.js');
      vi.doUnmock('#db/reservations.js');
      vi.doUnmock('#db/runner-instances.js');
      vi.doUnmock('#metrics/instance.js');
      vi.resetModules();
    }
  });

  it('does not calculate divergence for a non-returned long-poll retry', async () => {
    vi.resetModules();
    const abortController = new AbortController();
    const pollDemandAndReserveTx = vi
      .fn()
      .mockResolvedValue({stats: [], reservations: [], newlyReservedUnits: []});
    const listProvisionerTerminateIntentRowsTx = vi.fn().mockImplementation(() => {
      abortController.abort();
      return [];
    });
    const listActiveRunnerInstanceCountsByTemplateTx = vi.fn().mockResolvedValue([]);
    vi.doMock('#db/db.js', () => ({
      db: () => ({transaction: (callback: (tx: unknown) => Promise<unknown>) => callback({})}),
    }));
    vi.doMock('#db/reservations.js', () => ({
      deleteReservationsByIds: vi.fn(),
      pollDemandAndReserveTx,
    }));
    vi.doMock('#db/runner-instances.js', () => ({
      listActiveRunnerInstanceCountsByTemplateTx,
      listProvisionerTerminateIntentRowsTx,
    }));

    try {
      const {pollDemand: mockedPollDemand} = await import('#core/demand.js');

      const result = await mockedPollDemand({
        workspaceId: crypto.randomUUID(),
        provisionerId: crypto.randomUUID(),
        maxReservations: 1,
        waitSeconds: 60,
        ttlSeconds: 60,
        terminateIntentLimit: 1000,
        templates: [
          {templateKey: 'linux', labels: ['linux'], availableSlots: 1, starting: 0, running: 0},
        ],
        signal: abortController.signal,
      });

      expect(result).toEqual({stats: [], reservations: [], terminateRunnerInstanceIds: []});
      expect(listActiveRunnerInstanceCountsByTemplateTx).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock('#db/db.js');
      vi.doUnmock('#db/reservations.js');
      vi.doUnmock('#db/runner-instances.js');
      vi.resetModules();
    }
  });

  it('includes template_key on divergence metrics when the env flag is enabled', async () => {
    vi.resetModules();
    vi.stubEnv('PROVISIONED_RUNNER_COUNT_DIVERGENCE_TEMPLATE_KEY_LABEL_ENABLED', 'true');
    const divergenceAdd = vi.fn();
    const pollDemandAndReserveTx = vi
      .fn()
      .mockResolvedValue({stats: [], reservations: [], newlyReservedUnits: []});
    const listProvisionerTerminateIntentRowsTx = vi.fn().mockResolvedValue([]);
    const listActiveRunnerInstanceCountsByTemplateTx = vi
      .fn()
      .mockResolvedValue([{templateKey: 'linux', state: 'running', count: 2}]);
    vi.doMock('#db/db.js', () => ({
      db: () => ({transaction: (callback: (tx: unknown) => Promise<unknown>) => callback({})}),
    }));
    vi.doMock('#db/reservations.js', () => ({
      deleteReservationsByIds: vi.fn(),
      pollDemandAndReserveTx,
    }));
    vi.doMock('#db/runner-instances.js', () => ({
      listActiveRunnerInstanceCountsByTemplateTx,
      listProvisionerTerminateIntentRowsTx,
    }));
    vi.doMock('#metrics/instance.js', () => ({
      providerRunnerCountDivergenceCount: {add: divergenceAdd},
      providerRunnerTerminateIntentIssuedCount: {add: vi.fn()},
    }));

    try {
      const {pollDemand: mockedPollDemand} = await import('#core/demand.js');

      const result = await mockedPollDemand({
        workspaceId: crypto.randomUUID(),
        provisionerId: crypto.randomUUID(),
        maxReservations: 0,
        waitSeconds: 0,
        ttlSeconds: 60,
        terminateIntentLimit: 1000,
        templates: [
          {templateKey: 'linux', labels: ['linux'], availableSlots: 1, starting: 0, running: 1},
        ],
        signal: new AbortController().signal,
      });

      expect(result).toEqual({stats: [], reservations: [], terminateRunnerInstanceIds: []});
      expect(divergenceAdd).toHaveBeenCalledWith(1, {
        template_key: 'linux',
        state: 'running',
        direction: 'backend-higher',
      });
    } finally {
      vi.unstubAllEnvs();
      vi.doUnmock('#db/db.js');
      vi.doUnmock('#db/reservations.js');
      vi.doUnmock('#db/runner-instances.js');
      vi.doUnmock('#metrics/instance.js');
      vi.resetModules();
    }
  });
});

describe('calculateRunnerInstanceCountDivergences', () => {
  it('returns no divergences when advertised and backend counts match', () => {
    const result = calculateRunnerInstanceCountDivergences({
      advertisedTemplates: [template('linux', 1, 2)],
      backendCounts: [
        {templateKey: 'linux', state: 'starting', count: 1},
        {templateKey: 'linux', state: 'running', count: 2},
      ],
    });

    expect(result).toEqual([]);
  });

  it('detects backend-higher and advertised-higher counts', () => {
    const result = calculateRunnerInstanceCountDivergences({
      advertisedTemplates: [template('linux', 1, 5)],
      backendCounts: [
        {templateKey: 'linux', state: 'starting', count: 3},
        {templateKey: 'linux', state: 'running', count: 2},
      ],
    });

    expect(result).toEqual([
      {templateKey: 'linux', state: 'running', direction: 'advertised-higher', delta: 3},
      {templateKey: 'linux', state: 'starting', direction: 'backend-higher', delta: 2},
    ]);
  });

  it('aggregates duplicate advertised template keys before comparing', () => {
    const result = calculateRunnerInstanceCountDivergences({
      advertisedTemplates: [template('linux', 1, 1), template('linux', 2, 3)],
      backendCounts: [
        {templateKey: 'linux', state: 'starting', count: 3},
        {templateKey: 'linux', state: 'running', count: 4},
      ],
    });

    expect(result).toEqual([]);
  });

  it('detects backend-only template keys as backend-higher', () => {
    const result = calculateRunnerInstanceCountDivergences({
      advertisedTemplates: [template('linux', 0, 0)],
      backendCounts: [{templateKey: 'gpu', state: 'running', count: 2}],
    });

    expect(result).toEqual([
      {templateKey: 'gpu', state: 'running', direction: 'backend-higher', delta: 2},
    ]);
  });

  function template(templateKey: string, starting: number, running: number) {
    return {templateKey, labels: ['linux'], availableSlots: 1, starting, running};
  }
});

describe('nextBackoffInterval', () => {
  it('grows by 1.5x until the configured ceiling', () => {
    const grown = nextBackoffInterval(1000);
    const capped = nextBackoffInterval(5000);

    expect(grown).toBe(1500);
    expect(capped).toBe(5000);
  });
});
