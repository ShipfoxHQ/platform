import {
  AGENT_INTEGRATION_MCP_AUTH,
  AGENT_INTEGRATION_MCP_ENDPOINT,
  AGENT_INTEGRATION_MCP_SERVER_NAME,
  AGENT_INTEGRATION_MCP_TRANSPORT,
  type AgentIntegrationMcpServerConfigDto,
  type MaterializedAgentIntegrationConfigDto,
} from '@shipfox/api-agent-dto';
import {agentInterModuleContract} from '@shipfox/api-agent-dto/inter-module';
import {parseWorkflowTemplate, planInterpolationField} from '@shipfox/expression';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {agentThinkingSchema} from '@shipfox/workflow-document';
import type {AgentDefaultsResolver} from '#core/agent-defaults.js';
import type {Step} from '#core/entities/step.js';
import {AgentConfigUnresolvableError, InterpolationUnresolvableError} from '#core/errors.js';
import {completeStepDispatchConfig} from './complete-step-dispatch-config.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

function plannedField(source: string) {
  const plan = planInterpolationField({
    field: 'env.value',
    segments: parseWorkflowTemplate(source),
  });
  if (!plan.ok) throw new Error('Expected field plan to be valid');
  return plan.plan.field;
}

function plannedSessionField(source: string) {
  const plan = planInterpolationField({
    field: 'agent.session',
    segments: parseWorkflowTemplate(source),
  });
  if (!plan.ok) throw new Error('Expected session field plan to be valid');
  return plan.plan.field;
}

function template(source: string): string {
  return '$'.concat('{{ ', source, ' }}');
}

function step(overrides: Partial<Step>): Step {
  return {
    id: 'step-1',
    jobExecutionId: 'exec-1',
    key: 'deploy',
    name: 'Deploy',
    sourceLocation: null,
    status: 'pending',
    statusReason: null,
    evaluationTrace: null,
    type: 'run',
    config: {},
    condition: null,
    configPlan: null,
    authoredConfig: null,
    error: null,
    position: 1,
    version: 1,
    currentAttempt: 1,
    createdAt: new Date('2026-06-30T12:00:00.000Z'),
    updatedAt: new Date('2026-06-30T12:00:00.000Z'),
    ...overrides,
  };
}

const context: WorkflowEvaluationContext = {
  site: 'step-dispatch',
  values: {
    steps: {
      build: {
        outputs: {sha: 'abc123'},
      },
    },
  },
};

const resolveAgentDefaults: AgentDefaultsResolver = (params) => ({
  harness: params.harness ?? 'pi',
  provider: params.provider ?? 'openai',
  model: params.model ?? 'gpt-5.5',
  thinking: agentThinkingSchema.safeParse(params.thinking).data ?? 'off',
});

function materializedIntegration(): MaterializedAgentIntegrationConfigDto {
  return {
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
            sensitivity: 'read',
            sensitive: false,
            requiredScope: [{permission: 'issues', access: 'read'}],
          },
        ],
      },
    ],
  };
}

function integrationMcpServers(
  integrations: readonly MaterializedAgentIntegrationConfigDto[],
): readonly AgentIntegrationMcpServerConfigDto[] {
  return [
    {
      name: AGENT_INTEGRATION_MCP_SERVER_NAME,
      transport: AGENT_INTEGRATION_MCP_TRANSPORT,
      endpoint: AGENT_INTEGRATION_MCP_ENDPOINT,
      auth: AGENT_INTEGRATION_MCP_AUTH,
      integrations: [...integrations],
    },
  ];
}

describe('completeStepDispatchConfig', () => {
  it('completes a deferred session key at the dispatch site with its authored mode', async () => {
    const pending = step({
      type: 'agent',
      config: {
        harness: 'pi',
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
      },
      configPlan: {
        agent: {
          prompt: plannedField(template('steps.build.outputs.sha')),
          session: {
            key: plannedSessionField(`triage-${template('steps.build.outputs.sha')}`),
            mode: 'fork',
          },
        },
      },
    });

    const result = await completeStepDispatchConfig({
      step: pending,
      context,
      resolveAgentDefaults,
      definitionId: 'def-1',
    });

    expect(result.config.session).toEqual({key: 'triage-abc123', mode: 'fork'});
    expect(result.sessionIntent).toEqual({key: 'triage-abc123', mode: 'fork'});
    expect(result.trace).toEqual(
      expect.arrayContaining([expect.objectContaining({field: 'agent.session'})]),
    );
  });

  it('reports an unresolved session key as an interpolation error at dispatch', async () => {
    const pending = step({
      type: 'agent',
      config: {
        harness: 'pi',
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
      },
      configPlan: {
        agent: {
          prompt: plannedField(template('steps.build.outputs.sha')),
          session: {
            key: plannedSessionField(template('steps.build.outputs.missing')),
            mode: 'resume',
          },
        },
      },
    });

    await expect(
      completeStepDispatchConfig({
        step: pending,
        context,
        resolveAgentDefaults,
        definitionId: 'def-1',
      }),
    ).rejects.toBeInstanceOf(InterpolationUnresolvableError);
  });

  it('copies frozen agent integrations from the dispatch plan', async () => {
    const integrations = [materializedIntegration()];
    const pending = step({
      type: 'agent',
      config: {
        harness: 'pi',
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
      },
      configPlan: {
        agent: {
          prompt: plannedField(template('steps.build.outputs.sha')),
          integrations,
        },
      },
    });

    const result = await completeStepDispatchConfig({
      step: pending,
      context,
      resolveAgentDefaults,
      definitionId: 'def-1',
    });

    expect(result.config.integrations).toEqual(integrations);
    expect(result.config.mcpServers).toEqual(integrationMcpServers(integrations));
  });

  it('serializes residual secret env values as secret bindings without writing env values', async () => {
    const pending = step({
      config: {},
      configPlan: {
        env: {
          TOKEN: plannedField(`prefix-${template('secrets.local.TOKEN')}`),
          SHORT: plannedField(template('secrets.API_KEY')),
        },
      },
    });

    const result = await completeStepDispatchConfig({
      step: pending,
      context,
      resolveAgentDefaults,
      definitionId: 'def-1',
    });

    expect(result.config).toEqual({
      secret_bindings: [
        {
          target: 'TOKEN',
          segments: [
            {kind: 'literal', value: 'prefix-'},
            {kind: 'secret', store: 'local', key: 'TOKEN'},
          ],
        },
        {
          target: 'SHORT',
          segments: [{kind: 'secret', store: 'local', key: 'API_KEY'}],
        },
      ],
    });
    expect(result.trace).toEqual([
      {
        expression: 'secrets.local.TOKEN',
        roots: ['secrets'],
        fillTarget: 'runner-fill',
        evaluatedAt: 'step-dispatch',
        reference: true,
        field: 'env',
        envKey: 'TOKEN',
      },
      {
        expression: 'secrets.API_KEY',
        roots: ['secrets'],
        fillTarget: 'runner-fill',
        evaluatedAt: 'step-dispatch',
        reference: true,
        field: 'env',
        envKey: 'SHORT',
      },
    ]);
  });

  it('rejects secret env bindings with malformed target names', async () => {
    const pending = step({
      config: {},
      configPlan: {
        env: {
          'BAD-NAME': plannedField(template('secrets.API_KEY')),
        },
      },
    });

    const act = () =>
      completeStepDispatchConfig({
        step: pending,
        context,
        resolveAgentDefaults,
        definitionId: 'def-1',
      });

    await expect(act()).rejects.toThrow();
  });

  it('keeps fully resolved step config byte-identical apart from resolved env additions', async () => {
    const pending = step({
      config: {run: 'echo "$SHA"'},
      configPlan: {
        env: {
          SHA: plannedField(template('steps.build.outputs.sha')),
        },
      },
    });

    const result = await completeStepDispatchConfig({
      step: pending,
      context,
      resolveAgentDefaults,
      definitionId: 'def-1',
    });

    expect(result).toEqual({
      config: {run: 'echo "$SHA"', env: {SHA: 'abc123'}},
      trace: [
        {
          expression: 'steps.build.outputs.sha',
          roots: ['steps'],
          fillTarget: 'step-dispatch',
          evaluatedAt: 'step-dispatch',
          value: 'abc123',
          field: 'env',
          envKey: 'SHA',
        },
      ],
    });
  });

  it('resolves a deferred working directory at step dispatch', async () => {
    const pending = step({
      config: {},
      configPlan: {
        working_directory: plannedField(template('steps.build.outputs.path')),
      },
    });

    const result = await completeStepDispatchConfig({
      step: pending,
      context: {
        ...context,
        values: {
          ...context.values,
          steps: {
            build: {
              outputs: {path: 'packages/api'},
            },
          },
        },
      },
      resolveAgentDefaults,
      definitionId: 'def-1',
    });

    expect(result).toEqual({
      config: {working_directory: 'packages/api'},
      trace: [
        {
          expression: 'steps.build.outputs.path',
          roots: ['steps'],
          fillTarget: 'step-dispatch',
          evaluatedAt: 'step-dispatch',
          value: 'packages/api',
          field: 'step.working_directory',
        },
      ],
    });
  });

  it('resolves deferred checkout targets at step dispatch', async () => {
    const pending = step({
      type: 'checkout',
      config: {
        checkout: {
          fetch_depth: 1,
          permissions: {contents: 'read'},
          persist_credentials: true,
        },
      },
      configPlan: {
        checkout: {
          repository: plannedField(template('steps.build.outputs.repository')),
          ref: plannedField(template('steps.build.outputs.ref')),
        },
      },
    });

    const result = await completeStepDispatchConfig({
      step: pending,
      context: {
        ...context,
        values: {
          ...context.values,
          steps: {
            build: {
              outputs: {repository: 'acme/api', ref: 'refs/heads/main'},
            },
          },
        },
      },
      resolveAgentDefaults,
      definitionId: 'def-1',
    });

    expect(result).toEqual({
      config: {
        checkout: {
          fetch_depth: 1,
          permissions: {contents: 'read'},
          persist_credentials: true,
          repository: 'acme/api',
          ref: 'refs/heads/main',
        },
      },
      trace: [
        {
          expression: 'steps.build.outputs.repository',
          roots: ['steps'],
          fillTarget: 'step-dispatch',
          evaluatedAt: 'step-dispatch',
          value: 'acme/api',
          field: 'checkout.repository',
        },
        {
          expression: 'steps.build.outputs.ref',
          roots: ['steps'],
          fillTarget: 'step-dispatch',
          evaluatedAt: 'step-dispatch',
          value: 'refs/heads/main',
          field: 'checkout.ref',
        },
      ],
    });
  });

  it('rejects invalid resolved working directories', async () => {
    const pending = step({
      config: {working_directory: '../outside'},
      configPlan: null,
    });

    await expect(
      completeStepDispatchConfig({
        step: pending,
        context,
        resolveAgentDefaults,
        definitionId: 'def-1',
      }),
    ).rejects.toThrow('Invalid working_directory');
  });

  it('completes deferred agent config with the resolved harness', async () => {
    const integration = materializedIntegration();
    const mcpServers = integrationMcpServers([integration]);
    const pending = step({
      type: 'agent',
      config: {},
      configPlan: {
        agent: {
          harness: 'claude',
          tools: ['Read', 'WebSearch'],
          integrations: [integration],
          mcpServers,
          prompt: plannedField(`Review ${template('steps.build.outputs.sha')}`),
        },
      },
    });

    const result = await completeStepDispatchConfig({
      step: pending,
      context,
      resolveAgentDefaults,
      definitionId: 'def-1',
    });

    expect(result).toEqual({
      config: {
        harness: 'claude',
        provider: 'openai',
        model: 'gpt-5.5',
        thinking: 'off',
        tools: ['Read', 'WebSearch'],
        integrations: [integration],
        mcpServers,
        prompt: 'Review abc123',
      },
      trace: [
        {
          expression: 'steps.build.outputs.sha',
          roots: ['steps'],
          fillTarget: 'step-dispatch',
          evaluatedAt: 'step-dispatch',
          value: 'abc123',
          field: 'agent.prompt',
        },
      ],
    });
  });

  it('wraps harness resolver errors as unresolvable agent config', async () => {
    const pending = step({
      type: 'agent',
      config: {},
      configPlan: {
        agent: {
          harness: 'claude',
          thinking: plannedField('off'),
          prompt: plannedField(`Review ${template('steps.build.outputs.sha')}`),
        },
      },
    });
    const failingResolver: AgentDefaultsResolver = () => {
      throw createInterModuleKnownError(
        agentInterModuleContract.methods.resolveAgentConfig,
        'agent-config-invalid',
        {},
      );
    };

    const act = () =>
      completeStepDispatchConfig({
        step: pending,
        context,
        resolveAgentDefaults: failingResolver,
        definitionId: 'def-1',
      });

    await expect(act()).rejects.toThrow(AgentConfigUnresolvableError);
  });

  it('preserves managed provider policy details in unresolvable agent config errors', async () => {
    const pending = step({
      type: 'agent',
      config: {},
      configPlan: {
        agent: {
          prompt: plannedField('Review the change.'),
        },
      },
    });
    const failingResolver: AgentDefaultsResolver = () => {
      throw createInterModuleKnownError(
        agentInterModuleContract.methods.resolveAgentConfig,
        'agent-config-invalid',
        {
          message: 'This instance only supports provider `shipfox`.',
          managed_provider_id: 'shipfox',
        },
      );
    };

    const act = () =>
      completeStepDispatchConfig({
        step: pending,
        context,
        resolveAgentDefaults: failingResolver,
        definitionId: 'def-1',
      });

    await expect(act()).rejects.toMatchObject({
      name: 'AgentConfigUnresolvableError',
      message: 'This instance only supports provider `shipfox`.',
      code: 'workspace-providers-disabled',
      managedProviderId: 'shipfox',
    });
  });

  it('throws when a server-side segment still survives dispatch', async () => {
    const pending = step({
      config: {},
      configPlan: {
        env: {
          STATUS: plannedField(template('step.status')),
        },
      },
    });

    const act = () =>
      completeStepDispatchConfig({
        step: pending,
        context,
        resolveAgentDefaults,
        definitionId: 'def-1',
      });

    await expect(act()).rejects.toThrow(InterpolationUnresolvableError);
  });
});
