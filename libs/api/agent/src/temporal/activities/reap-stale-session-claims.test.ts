import {reapStaleSessionClaimsActivity} from './reap-stale-session-claims.js';

const configMock = vi.hoisted(() => ({unsafe: true}));
const reapStaleSessionClaimsMock = vi.hoisted(() => vi.fn());
const loggerWarnMock = vi.hoisted(() => vi.fn());

vi.mock('#config.js', () => ({
  config: {
    AGENT_SESSION_REAP_AFTER_SECONDS: 0,
    AGENT_SESSION_REAP_BATCH_LIMIT: 100,
  },
  isUnsafeReapAfterSeconds: () => configMock.unsafe,
  resolveReapBatchLimit: () => 100,
}));

vi.mock('#core/reap-stale-session-claims.js', () => ({
  reapStaleSessionClaims: reapStaleSessionClaimsMock,
}));

vi.mock('@shipfox/node-opentelemetry', () => ({
  logger: () => ({warn: loggerWarnMock}),
}));

describe('reapStaleSessionClaimsActivity', () => {
  beforeEach(() => {
    configMock.unsafe = true;
    reapStaleSessionClaimsMock.mockReset();
    loggerWarnMock.mockReset();
  });

  it('disables the destructive sweep when the reap threshold is unsafe', async () => {
    const result = await reapStaleSessionClaimsActivity();

    expect(result).toEqual({reaped: 0, failed: 0});
    expect(reapStaleSessionClaimsMock).not.toHaveBeenCalled();
    expect(loggerWarnMock).toHaveBeenCalled();
  });

  it('runs the sweep with the resolved batch limit when the threshold is safe', async () => {
    configMock.unsafe = false;
    reapStaleSessionClaimsMock.mockResolvedValue({reaped: 3, failed: 0});

    const result = await reapStaleSessionClaimsActivity();

    expect(result).toEqual({reaped: 3, failed: 0});
    expect(reapStaleSessionClaimsMock).toHaveBeenCalledWith({
      olderThanSeconds: 0,
      batchLimit: 100,
    });
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });
});
