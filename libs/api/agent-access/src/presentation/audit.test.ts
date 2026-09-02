import type {AgentAccessContext} from '@shipfox/api-auth-context';
import {createAgentAccessToolCallRecorder} from './audit.js';

const baseContext: AgentAccessContext = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  scopes: ['read'],
  credential: {kind: 'pat', patId: 'pat-1'},
};

describe('agent-access tool call audit recorder', () => {
  test('records bounded identity fields for a PAT without tool arguments', () => {
    const recordMetric = vi.fn();
    const logInfo = vi.fn();
    const recorder = createAgentAccessToolCallRecorder({recordMetric, logInfo});

    recorder({
      tool: 'agent_access_fixture',
      outcome: 'success',
      errorCode: 'none',
      context: baseContext,
    });

    expect(recordMetric).toHaveBeenCalledWith({
      tool: 'agent_access_fixture',
      outcome: 'success',
    });
    expect(logInfo).toHaveBeenCalledWith(
      {
        tool: 'agent_access_fixture',
        outcome: 'success',
        errorCode: 'none',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        credentialKind: 'pat',
        credentialId: 'pat-1',
        clientId: null,
      },
      'agent access tool call audited',
    );
    expect(logInfo.mock.calls[0]?.[0]).not.toHaveProperty('arguments');
  });

  test('includes the OAuth client identifier while keeping the grant identity explicit', () => {
    const logInfo = vi.fn();
    const recorder = createAgentAccessToolCallRecorder({logInfo, recordMetric: vi.fn()});

    recorder({
      tool: 'agent_access_fixture',
      outcome: 'tool-error',
      errorCode: 'invalid-request',
      context: {
        ...baseContext,
        credential: {kind: 'oauth_grant', grantId: 'grant-1', clientId: 'client-1'},
      },
    });

    expect(logInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialKind: 'oauth_grant',
        credentialId: 'grant-1',
        clientId: 'client-1',
      }),
      'agent access tool call audited',
    );
  });
});
