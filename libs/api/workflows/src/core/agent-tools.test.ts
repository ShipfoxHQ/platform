import {workflowModel} from '#test/index.js';
import type {AgentToolCatalogEntry, AgentToolMaterializationContext} from './agent-tools.js';
import {
  createAgentToolMaterializationSnapshot,
  loadAgentToolMaterializationContext,
  materializeToolStep,
} from './agent-tools.js';
import {AgentIntegrationMaterializationError} from './errors.js';

function materializationContext(): AgentToolMaterializationContext {
  const tool: AgentToolCatalogEntry = {
    id: 'issue_read',
    description: 'Read issues.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [{permission: 'issues', access: 'read'}],
    inputSchema: {type: 'object'},
    methods: [
      {
        id: 'get',
        description: 'Get an issue.',
        sensitivity: 'read',
        sensitive: false,
        requiredScope: [{permission: 'issues', access: 'read'}],
      },
    ],
  };

  return {
    catalogs: new Map([['github', [tool]]]),
    workspaceConnectionSnapshot: new Map([
      ['github-main', {id: 'connection-1', provider: 'github', capabilities: ['agent_tools']}],
    ]),
    defaultConnection: {id: 'connection-1', slug: 'github-main', provider: 'github'},
  };
}

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

  test('materializes a selected tool method from the catalog', () => {
    const materialized = materializeToolStep({
      jobKey: 'build',
      stepId: 'call',
      tool: {id: 'issue_read', method: 'get'},
      connection: 'github-main',
      context: materializationContext(),
      snapshot: undefined,
    });

    expect(materialized).toEqual({
      connectionId: 'connection-1',
      connectionSlug: 'github-main',
      provider: 'github',
      id: 'issue_read',
      method: 'get',
      sensitivity: 'read',
      sensitive: false,
      requiredScope: [{permission: 'issues', access: 'read'}],
      inputSchema: {type: 'object'},
    });
    expect(Object.isFrozen(materialized)).toBe(true);
  });

  test('includes tool steps in the run-attempt materialization snapshot', () => {
    const model = workflowModel({
      name: 'Tools',
      runner: 'ubuntu-latest',
      jobs: {
        build: {
          steps: [
            {
              tool: 'issue_read.get',
              connection: 'github-main',
              with: {owner: 'acme'},
            },
          ],
        },
      },
    });

    expect(
      createAgentToolMaterializationSnapshot({model, context: materializationContext()}),
    ).toMatchObject({
      steps: [
        {
          jobKey: 'build',
          stepId: 'build-step-1',
          tool: {id: 'issue_read', method: 'get', connectionSlug: 'github-main'},
        },
      ],
    });
  });
});
