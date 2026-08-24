import {
  AGENT_INTEGRATION_MCP_AUTH,
  AGENT_INTEGRATION_MCP_ENDPOINT,
  AGENT_INTEGRATION_MCP_SERVER_NAME,
  AGENT_INTEGRATION_MCP_TRANSPORT,
} from '@shipfox/api-agent-dto';
import {agentInterModuleContract} from '@shipfox/api-agent-dto/inter-module';
import {createWorkflowExpression} from '@shipfox/expression';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import type {AgentDefaultsResolver} from '#core/agent-defaults.js';
import type {AgentToolCatalogEntry, AgentToolMaterializationContext} from '#core/agent-tools.js';
import {AgentConfigUnresolvableError, InterpolationUnresolvableError} from '#core/errors.js';
import {resolveTestAgentDefaults} from '#test/fixtures/agent-inter-module.js';
import {workflowModel} from '#test/index.js';
import {materializeJobExecutionSteps as materializeJobExecutionStepsImpl} from './materialize-job-execution-steps.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

function materializeJobExecutionSteps(
  params: Parameters<typeof materializeJobExecutionStepsImpl>[0],
): ReturnType<typeof materializeJobExecutionStepsImpl> {
  return materializeJobExecutionStepsImpl({
    resolveAgentDefaults: resolveTestAgentDefaults,
    ...params,
  });
}

function template(source: string): string {
  return `\${{ ${source} }}`;
}

function shellRef(name: string): string {
  return `\${${name}}`;
}

function checkout(repository: string) {
  return {
    repository,
    fetchDepth: 1,
    permissions: {contents: 'read' as const},
    persistCredentials: true,
  };
}

function condition(source: string) {
  return createWorkflowExpression({source, check: {mode: 'syntax'}});
}

function jobExecutionContext(): WorkflowEvaluationContext {
  return {
    site: 'execution-creation',
    values: {
      run: {
        id: 'run-1',
        name: 'Reviews',
        definition_id: 'def-1',
        project_id: 'proj-1',
        workspace_id: 'workspace-1',
        created_at: new Date('2026-06-30T12:00:00.000Z'),
      },
      trigger: {source: 'manual', event: 'fire'},
      event: null,
      inputs: null,
      execution: {
        index: 1,
        name: 'Review batch 2',
        status: 'pending',
        started_at: '2026-06-30T12:01:00.000Z',
        finished_at: null,
        events: [
          {
            source: 'github',
            event: 'pull_request_review',
            delivery_id: 'delivery-2',
            received_at: '2026-06-30T12:01:00.000Z',
            project: null,
            repository: null,
            ref: null,
            commit: null,
            data: {body: 'LGTM'},
          },
        ],
      },
      executions: [
        {
          index: 0,
          name: 'Review batch 1',
          status: 'succeeded',
          started_at: '2026-06-30T12:00:00.000Z',
          finished_at: '2026-06-30T12:00:30.000Z',
          events: [],
        },
      ],
    },
  };
}

function githubAgentToolContext(
  catalog: readonly AgentToolCatalogEntry[] = githubAgentToolCatalog(),
): AgentToolMaterializationContext {
  return {
    catalogs: new Map([['github', catalog]]),
    workspaceConnectionSnapshot: new Map([
      [
        'github-main',
        {
          id: 'connection-1',
          provider: 'github',
          capabilities: ['agent_tools'],
        },
      ],
    ]),
    defaultConnection: {
      id: 'connection-1',
      slug: 'github-main',
      provider: 'github',
    },
  };
}

function githubAgentToolCatalog(): readonly AgentToolCatalogEntry[] {
  return [
    {
      id: 'issue_read',
      description: 'Read issues.',
      sensitivity: 'read',
      sensitive: false,
      requiredScope: [{permission: 'issues', access: 'read'}],
      inputSchema: {type: 'object'},
      methods: [
        {
          id: 'get',
          description: 'Get issue.',
          sensitivity: 'read',
          sensitive: false,
          requiredScope: [{permission: 'issues', access: 'read'}],
        },
        {
          id: 'get_comments',
          description: 'Get issue comments.',
          sensitivity: 'read',
          sensitive: false,
          requiredScope: [{permission: 'issues', access: 'read'}],
        },
      ],
    },
    {
      id: 'issue_write',
      description: 'Write issues.',
      sensitivity: 'write',
      sensitive: false,
      requiredScope: [{permission: 'issues', access: 'write'}],
      inputSchema: {type: 'object'},
      methods: [
        {
          id: 'create',
          description: 'Create issue.',
          sensitivity: 'write',
          sensitive: false,
          requiredScope: [{permission: 'issues', access: 'write'}],
        },
      ],
    },
    {
      id: 'merge_pull_request',
      description: 'Merge a pull request.',
      sensitivity: 'write',
      sensitive: true,
      requiredScope: [
        {permission: 'pull_requests', access: 'write'},
        {permission: 'contents', access: 'write'},
      ],
      inputSchema: {type: 'object'},
    },
  ];
}

describe('materializeJobExecutionSteps', () => {
  it('resolves static job names through the job execution context', async () => {
    const model = workflowModel({
      jobs: {
        review: {
          name: 'Review',
          steps: [{name: template('job.name'), run: 'echo review'}],
        },
      },
    });
    const job = model.jobs[0];
    if (!job) throw new Error('Expected workflow job');

    const steps = await materializeJobExecutionSteps({model, job, context: jobExecutionContext()});

    expect(steps[1]).toMatchObject({
      name: 'Review',
      config: {run: 'echo review'},
    });
  });

  it('rejects tool steps until materialization supports them', async () => {
    const model = workflowModel({
      jobs: {
        build: {
          steps: [
            {
              tool: 'list_issues',
              connection: 'github-main',
              provider: 'github',
              with: {},
            },
          ],
        },
      },
    });
    const job = model.jobs[0];
    if (!job) throw new Error('Expected workflow job');

    await expect(
      materializeJobExecutionSteps({model, job, context: jobExecutionContext()}),
    ).rejects.toThrow('Unsupported workflow step kind: tool');
  });

  it('materializes checkout steps with their resolved config and default name', async () => {
    const model = workflowModel({
      jobs: {
        build: {
          steps: [
            {
              checkout: {
                repository: 'acme/api',
                ref: 'refs/heads/main',
                fetchDepth: 0,
                path: 'target',
                permissions: {contents: 'write'},
                persistCredentials: false,
                force: true,
              },
            },
          ],
        },
      },
    });
    const job = model.jobs[0];
    if (!job) throw new Error('Expected workflow job');

    const steps = await materializeJobExecutionSteps({model, job, context: jobExecutionContext()});

    expect(steps[0]).toMatchObject({
      type: 'setup',
      config: {},
    });
    expect(steps[1]).toEqual({
      key: null,
      name: 'Checkout',
      sourceLocation: null,
      status: 'pending',
      type: 'checkout',
      config: {
        checkout: {
          repository: 'acme/api',
          ref: 'refs/heads/main',
          fetch_depth: 0,
          path: 'target',
          permissions: {contents: 'write'},
          persist_credentials: false,
          force: true,
        },
      },
      authoredConfig: null,
      position: 1,
    });
  });

  it('places a leading checkout at the job root when its path is omitted', async () => {
    const model = workflowModel({
      jobs: {
        build: {
          steps: [{checkout: checkout('acme/api')}, {run: 'echo use checkout'}],
        },
      },
    });
    const job = model.jobs[0];
    if (!job) throw new Error('Expected workflow job');

    const steps = await materializeJobExecutionSteps({model, job, context: jobExecutionContext()});

    expect(steps[0]).toMatchObject({type: 'setup', config: {}});
    expect(steps[1]).toMatchObject({
      type: 'checkout',
      config: {checkout: {repository: 'acme/api', path: '.'}},
    });
    expect(steps[2]).toMatchObject({type: 'run', config: {run: 'echo use checkout'}});
  });

  it('keeps the implicit checkout when an explicit checkout is not leading', async () => {
    const model = workflowModel({
      jobs: {
        build: {
          steps: [
            {run: 'echo route'},
            {checkout: checkout('acme/api')},
            {run: 'echo use checkout'},
          ],
        },
      },
    });
    const job = model.jobs[0];
    if (!job) throw new Error('Expected workflow job');

    const steps = await materializeJobExecutionSteps({model, job, context: jobExecutionContext()});

    expect(steps[0]).toMatchObject({
      type: 'setup',
      config: {
        checkout: {
          permissions: {contents: 'read'},
          persist_credentials: true,
        },
      },
    });
    expect(steps[2]).toMatchObject({
      type: 'checkout',
      config: {
        checkout: {
          repository: 'acme/api',
          fetch_depth: 1,
          permissions: {contents: 'read'},
          persist_credentials: true,
        },
      },
    });
    expect(steps[2]?.config.checkout).not.toHaveProperty('path');
    expect(steps[3]).toMatchObject({type: 'run', config: {run: 'echo use checkout'}});
  });

  it('omits the implicit checkout when the job opts out', async () => {
    const model = workflowModel({
      jobs: {
        build: {
          checkout: false,
          steps: [{run: 'echo no repository'}],
        },
      },
    });
    const job = model.jobs[0];
    if (!job) throw new Error('Expected workflow job');

    const steps = await materializeJobExecutionSteps({model, job, context: jobExecutionContext()});

    expect(steps[0]).toMatchObject({type: 'setup', config: {}});
  });

  it('does not restore the implicit checkout for a leading checkout with a false if', async () => {
    const model = workflowModel({
      jobs: {
        build: {
          steps: [{if: condition('false'), checkout: checkout('acme/api')}],
        },
      },
    });
    const job = model.jobs[0];
    if (!job) throw new Error('Expected workflow job');

    const steps = await materializeJobExecutionSteps({model, job, context: jobExecutionContext()});

    expect(steps[0]).toMatchObject({type: 'setup', config: {}});
    expect(steps[1]).toMatchObject({
      type: 'checkout',
      condition: expect.any(Object),
      config: {checkout: {repository: 'acme/api', path: '.'}},
    });
  });

  it('propagates a non-default job checkout policy into the setup step config', async () => {
    const model = workflowModel({
      jobs: {
        build: {
          checkout: {
            permissions: {contents: 'write'},
            persistCredentials: false,
          },
          steps: [{run: 'echo hello'}],
        },
      },
    });
    const job = model.jobs[0];
    if (!job) throw new Error('Expected workflow job');

    const steps = await materializeJobExecutionSteps({model, job, context: jobExecutionContext()});

    expect(steps[0]).toMatchObject({
      type: 'setup',
      config: {
        checkout: {
          permissions: {contents: 'write'},
          persist_credentials: false,
        },
      },
    });
  });

  it('falls back to the default checkout policy for legacy jobs', async () => {
    const model = workflowModel({
      jobs: {
        build: {steps: [{run: 'echo hello'}]},
      },
    });
    const job = model.jobs[0];
    if (!job) throw new Error('Expected workflow job');
    const legacyJob = {...job, checkout: undefined} as unknown as typeof job;

    const steps = await materializeJobExecutionSteps({
      model,
      job: legacyJob,
      context: jobExecutionContext(),
    });

    expect(steps[0]).toMatchObject({
      type: 'setup',
      config: {
        checkout: {
          permissions: {contents: 'read'},
          persist_credentials: true,
        },
      },
    });
  });

  it('prepends setup and resolves job-execution context fields', async () => {
    const model = workflowModel({
      jobs: {
        review: {
          steps: [
            {
              name: `Review ${template('execution.events[0].data.body')}`,
              run: `echo "${template('executions[0].name')}"`,
              env: {BODY: template('execution.events[0].data.body')},
            },
          ],
        },
      },
    });
    const job = model.jobs[0];
    if (!job) throw new Error('Expected workflow job');

    const steps = await materializeJobExecutionSteps({model, job, context: jobExecutionContext()});

    expect(steps).toEqual([
      {
        key: null,
        name: 'Set up job',
        sourceLocation: null,
        status: 'pending',
        type: 'setup',
        config: {
          checkout: {
            permissions: {contents: 'read'},
            persist_credentials: true,
          },
        },
        authoredConfig: null,
        position: 0,
      },
      {
        key: null,
        name: 'Review LGTM',
        sourceLocation: null,
        status: 'pending',
        type: 'run',
        config: {
          run: `echo "${shellRef('__sf_0')}"`,
          env: {
            BODY: 'LGTM',
            __sf_0: 'Review batch 1',
          },
        },
        authoredConfig: {
          run: `echo "${template('executions[0].name')}"`,
          env: {BODY: template('execution.events[0].data.body')},
        },
        configPlan: {
          trace: [
            {
              expression: 'execution.events[0].data.body',
              roots: ['execution'],
              fillTarget: 'execution-creation',
              evaluatedAt: 'execution-creation',
              value: 'LGTM',
              field: 'env',
              envKey: 'BODY',
            },
            {
              expression: 'executions[0].name',
              roots: ['executions'],
              fillTarget: 'execution-creation',
              evaluatedAt: 'execution-creation',
              value: 'Review batch 1',
              field: 'run',
            },
            {
              expression: 'execution.events[0].data.body',
              roots: ['execution'],
              fillTarget: 'execution-creation',
              evaluatedAt: 'execution-creation',
              value: 'LGTM',
              field: 'step.name',
            },
          ],
        },
        position: 1,
      },
    ]);
  });

  it('freezes resolved agent integration tools with default connection, repo, and token scope', async () => {
    const model = workflowModel({
      jobs: {
        fix: {
          steps: [
            {
              harness: 'pi',
              provider: 'anthropic',
              model: 'claude-opus-4-8',
              thinking: 'high',
              prompt: 'Fix it.',
              integrations: [
                {
                  include: ['issue_read.get', 'issue_write.create', 'merge_pull_request'],
                  allowWrite: true,
                },
              ],
            },
          ],
        },
      },
    });
    const job = model.jobs[0];
    if (!job) throw new Error('Expected workflow job');

    const steps = await materializeJobExecutionSteps({
      model,
      job,
      context: jobExecutionContext(),
      agentToolContext: githubAgentToolContext(),
    });
    const integrations = steps[1]?.config.integrations;

    expect(integrations).toEqual([
      {
        connectionId: 'connection-1',
        connectionSlug: 'github-main',
        provider: 'github',
        requiredScope: [
          {permission: 'issues', access: 'write'},
          {permission: 'pull_requests', access: 'write'},
          {permission: 'contents', access: 'write'},
        ],
        tools: [
          {
            id: 'issue_read',
            sensitivity: 'read',
            sensitive: false,
            requiredScope: [{permission: 'issues', access: 'read'}],
            inputSchema: {type: 'object'},
            methods: [
              {
                id: 'get',
                token: 'issue_read.get',
                description: 'Get issue.',
                sensitivity: 'read',
                sensitive: false,
                requiredScope: [{permission: 'issues', access: 'read'}],
              },
            ],
          },
          {
            id: 'issue_write',
            sensitivity: 'write',
            sensitive: false,
            requiredScope: [{permission: 'issues', access: 'write'}],
            inputSchema: {type: 'object'},
            methods: [
              {
                id: 'create',
                token: 'issue_write.create',
                description: 'Create issue.',
                sensitivity: 'write',
                sensitive: false,
                requiredScope: [{permission: 'issues', access: 'write'}],
              },
            ],
          },
          {
            id: 'merge_pull_request',
            sensitivity: 'write',
            sensitive: true,
            requiredScope: [
              {permission: 'pull_requests', access: 'write'},
              {permission: 'contents', access: 'write'},
            ],
            inputSchema: {type: 'object'},
          },
        ],
      },
    ]);
    expect(steps[1]?.config.mcpServers).toEqual([
      {
        name: AGENT_INTEGRATION_MCP_SERVER_NAME,
        transport: AGENT_INTEGRATION_MCP_TRANSPORT,
        endpoint: AGENT_INTEGRATION_MCP_ENDPOINT,
        auth: AGENT_INTEGRATION_MCP_AUTH,
        integrations,
      },
    ]);
  });

  it('carries frozen integrations through the agent dispatch plan when prompt is deferred', async () => {
    const model = workflowModel({
      jobs: {
        fix: {
          steps: [
            {
              harness: 'pi',
              provider: 'anthropic',
              model: 'claude-opus-4-8',
              thinking: 'high',
              prompt: `Fix ${template('steps.build.outputs.summary')}`,
              integrations: [
                {
                  connection: 'github-main',
                  include: ['issue_read'],
                  exclude: ['issue_read.get_comments'],
                  allowWrite: false,
                },
              ],
            },
          ],
        },
      },
    });
    const job = model.jobs[0];
    if (!job) throw new Error('Expected workflow job');

    const steps = await materializeJobExecutionSteps({
      model,
      job,
      context: jobExecutionContext(),
      agentToolContext: githubAgentToolContext(),
    });

    expect(steps[1]?.config).toEqual({
      harness: 'pi',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
    });
    const integrations = steps[1]?.configPlan?.agent?.integrations;
    expect(integrations).toEqual([
      {
        connectionId: 'connection-1',
        connectionSlug: 'github-main',
        provider: 'github',
        requiredScope: [{permission: 'issues', access: 'read'}],
        tools: [
          {
            id: 'issue_read',
            sensitivity: 'read',
            sensitive: false,
            requiredScope: [{permission: 'issues', access: 'read'}],
            inputSchema: {type: 'object'},
            methods: [
              {
                id: 'get',
                token: 'issue_read.get',
                description: 'Get issue.',
                sensitivity: 'read',
                sensitive: false,
                requiredScope: [{permission: 'issues', access: 'read'}],
              },
            ],
          },
        ],
      },
    ]);
    expect(steps[1]?.configPlan?.agent?.mcpServers).toEqual([
      {
        name: AGENT_INTEGRATION_MCP_SERVER_NAME,
        transport: AGENT_INTEGRATION_MCP_TRANSPORT,
        endpoint: AGENT_INTEGRATION_MCP_ENDPOINT,
        auth: AGENT_INTEGRATION_MCP_AUTH,
        integrations,
      },
    ]);
  });

  it('throws a permanent interpolation error for available missing value paths', async () => {
    const model = workflowModel({
      jobs: {
        review: {
          steps: [{run: 'echo ok', env: {TICKET: template('inputs.ticket')}}],
        },
      },
    });
    const job = model.jobs[0];
    if (!job) throw new Error('Expected workflow job');
    const baseContext = jobExecutionContext();

    let error: unknown;
    try {
      await materializeJobExecutionSteps({
        model,
        job,
        context: {...baseContext, values: {...baseContext.values, inputs: {}}},
        definitionId: 'def-1',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InterpolationUnresolvableError);
    expect(error).toMatchObject({
      field: 'env',
      source: 'inputs.ticket',
      envKey: 'TICKET',
    });
  });

  it('wraps known resolver errors as permanent agent config errors', async () => {
    const model = workflowModel({
      jobs: {
        review: {steps: [{prompt: 'Summarize the review.'}]},
      },
    });
    const job = model.jobs[0];
    if (!job) throw new Error('Expected workflow job');
    const resolveAgentDefaults = vi.fn<AgentDefaultsResolver>().mockImplementation(() => {
      throw createInterModuleKnownError(
        agentInterModuleContract.methods.resolveAgentConfig,
        'agent-config-invalid',
        {},
      );
    });

    const materialize = () =>
      materializeJobExecutionSteps({
        model,
        job,
        context: jobExecutionContext(),
        resolveAgentDefaults,
        definitionId: 'def-1',
      });

    await expect(materialize()).rejects.toThrow(AgentConfigUnresolvableError);
    await expect(materialize()).rejects.toThrow(
      'Agent configuration cannot be resolved for definition def-1',
    );
  });

  it('throws a permanent interpolation error for unsafe run interpolation', async () => {
    const model = workflowModel({
      jobs: {
        review: {steps: [{run: `echo \`${template('execution.index')}\``}]},
      },
    });
    const job = model.jobs[0];
    if (!job) throw new Error('Expected workflow job');

    const materialize = () =>
      materializeJobExecutionSteps({
        model,
        job,
        context: jobExecutionContext(),
        definitionId: 'def-1',
      });

    await expect(materialize()).rejects.toThrow(InterpolationUnresolvableError);
  });
});
