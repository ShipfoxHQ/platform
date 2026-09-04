import {resolveTestAgentDefaults} from '#test/fixtures/agent-inter-module.js';
import {workflowModel} from '#test/index.js';
import {materializeListenerExecution} from './listener-execution-materialization.js';

describe('materializeListenerExecution', () => {
  it('fails cleanly when agent integration materialization is unresolvable', async () => {
    const model = workflowModel({
      jobs: {
        review: {
          steps: [
            {
              prompt: 'Review the pull request.',
              integrations: [{include: ['issue_read.get'], allowWrite: false}],
            },
          ],
        },
      },
    });

    const result = await materializeListenerExecution({
      model,
      run: {
        id: crypto.randomUUID(),
        number: 1,
        currentAttempt: 1,
        name: 'Review run',
        workflowName: 'Review run',
        definitionId: crypto.randomUUID(),
        projectId: crypto.randomUUID(),
        workspaceId: crypto.randomUUID(),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        triggerPayload: {
          source: 'github',
          event: 'pull_request',
          deliveryId: crypto.randomUUID(),
          data: {action: 'opened'},
        },
        inputs: null,
      },
      job: {id: crypto.randomUUID(), key: 'review'},
      sequence: 1,
      triggerEvents: [],
      priorExecutions: [],
      resolveAgentDefaults: resolveTestAgentDefaults,
    });

    expect(result).toMatchObject({
      status: 'failed',
      statusReason: 'unknown',
      runner: [],
      steps: [],
    });
  });
});
