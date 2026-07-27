const {assertEgressAllowedMock, EgressDeniedErrorMock} = vi.hoisted(() => {
  class EgressDeniedError extends Error {
    constructor(
      public readonly reason: string,
      public readonly target: string,
    ) {
      super(`Egress denied for ${target}: ${reason}`);
      this.name = 'EgressDeniedError';
    }
  }

  return {assertEgressAllowedMock: vi.fn(), EgressDeniedErrorMock: EgressDeniedError};
});

vi.mock('@shipfox/node-egress-guard', () => ({
  assertEgressAllowed: assertEgressAllowedMock,
  EgressDeniedError: EgressDeniedErrorMock,
  parseEgressHostDenylist: (value: string) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
}));

import {assertRunnerEgressAllowed} from '#core/egress.js';
import {AgentConfigError} from '#core/errors.js';

describe('assertRunnerEgressAllowed', () => {
  beforeEach(() => {
    assertEgressAllowedMock.mockReset();
    assertEgressAllowedMock.mockResolvedValue(undefined);
  });

  it('delegates to the shared egress guard with the runner policy', async () => {
    await assertRunnerEgressAllowed('https://models.example.test/v1', 'Model endpoint');

    expect(assertEgressAllowedMock).toHaveBeenCalledWith(
      'https://models.example.test/v1',
      expect.objectContaining({allowPrivateNetworks: true, hostDenylist: []}),
    );
  });

  it('maps denied egress to an AgentConfigError with the caller label', async () => {
    assertEgressAllowedMock.mockRejectedValue(
      new EgressDeniedErrorMock('host-denied', 'api.anthropic.com'),
    );

    const result = assertRunnerEgressAllowed('https://api.anthropic.com', 'Claude endpoint');

    await expect(result).rejects.toThrow(
      new AgentConfigError(
        'Claude endpoint blocked by egress policy: host-denied (api.anthropic.com).',
        'step_config_invalid',
      ),
    );
  });
});
