import {createAgentPersonalAccessTokenCommand} from './agent-access.js';

describe('createAgentPersonalAccessTokenCommand', () => {
  test('trims the operator-provided name', () => {
    expect(createAgentPersonalAccessTokenCommand('  Local coding agent  ', 90)).toEqual({
      name: 'Local coding agent',
      expiresInDays: 90,
    });
  });
});
