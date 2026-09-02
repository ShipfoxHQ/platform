import {agentAccessSuccess} from './envelope.js';

describe('agent-access envelope helpers', () => {
  test('does not construct a success envelope without a result', () => {
    expect(() => agentAccessSuccess(undefined)).toThrow(
      'Agent-access success results cannot be undefined',
    );
  });
});
