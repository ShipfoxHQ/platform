import {assertEgressAllowed, EgressDeniedError} from '@shipfox/node-egress-guard';
import {runnerEgressPolicy} from '#config.js';
import {AgentConfigError} from '#core/errors.js';

export async function assertRunnerEgressAllowed(
  url: string,
  blockedTargetLabel: string,
): Promise<void> {
  try {
    await assertEgressAllowed(url, runnerEgressPolicy());
  } catch (error) {
    if (error instanceof EgressDeniedError) {
      throw new AgentConfigError(
        `${blockedTargetLabel} blocked by egress policy: ${error.reason} (${error.target}).`,
        'step_config_invalid',
      );
    }
    throw error;
  }
}
