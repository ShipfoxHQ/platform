import {workflowModel} from '#test/index.js';
import {loadAgentToolMaterializationContext} from './agent-tools.js';
import {AgentIntegrationMaterializationError} from './errors.js';

describe('loadAgentToolMaterializationContext', () => {
  const workspaceId = crypto.randomUUID();
  const projectId = crypto.randomUUID();

  test('returns undefined for a model with only run steps', async () => {
    const model = workflowModel({
      name: 'Plain',
      runner: 'ubuntu-latest',
    });

    await expect(
      loadAgentToolMaterializationContext({model, workspaceId, projectId}),
    ).resolves.toBeUndefined();
  });

  test('returns undefined for a model with only checkout steps', async () => {
    const model = workflowModel({
      name: 'Checkout',
      runner: 'ubuntu-latest',
      jobs: {
        build: {
          steps: [
            {
              checkout: {
                repository: 'acme/platform',
                fetchDepth: 1,
                permissions: {contents: 'read'},
                persistCredentials: true,
              },
            },
          ],
        },
      },
    });

    await expect(
      loadAgentToolMaterializationContext({model, workspaceId, projectId}),
    ).resolves.toBeUndefined();
  });

  test('returns undefined for agent steps without integrations', async () => {
    const model = workflowModel({
      name: 'Agent',
      runner: 'ubuntu-latest',
      jobs: {
        build: {
          steps: [{prompt: 'Do the thing'}],
        },
      },
    });

    await expect(
      loadAgentToolMaterializationContext({model, workspaceId, projectId}),
    ).resolves.toBeUndefined();
  });

  test('does not short-circuit for a tool-step-only model', async () => {
    const model = workflowModel({
      name: 'Tools',
      runner: 'ubuntu-latest',
      jobs: {
        build: {
          steps: [
            {
              tool: 'get_issue',
              connection: 'linear-main',
              with: {id: 'ENG-1'},
            },
          ],
        },
      },
    });

    // A tool step is an integration tool reference, so the loader must not
    // return early: with project access missing it reports the materialization
    // setup failure instead of silently skipping tool-step runs.
    await expect(
      loadAgentToolMaterializationContext({model, workspaceId, projectId}),
    ).rejects.toThrow(AgentIntegrationMaterializationError);
  });
});
