import {agentInterModuleContract} from '@shipfox/api-agent-dto/inter-module';
import {DEFAULT_JOB_CHECKOUT, type WorkflowModel} from '@shipfox/api-definitions-dto';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import type {AgentDefaultsResolver} from '#core/agent-defaults.js';
import {AgentConfigUnresolvableError, InterpolationUnresolvableError} from '#core/errors.js';
import {resolveTestAgentDefaults} from '#test/fixtures/agent-inter-module.js';
import {workflowModel} from '#test/index.js';
import {
  materializeJobRunner,
  materializeWorkflowModel as materializeWorkflowModelImpl,
  modelHasAgentStep,
} from './materialize-workflow-model.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

type TestWorkflowExpression = NonNullable<
  NonNullable<WorkflowModel['jobs'][number]['steps'][number]['gate']>['success']
>;

function materializeWorkflowModel(
  params: Parameters<typeof materializeWorkflowModelImpl>[0],
): ReturnType<typeof materializeWorkflowModelImpl> {
  return materializeWorkflowModelImpl({resolveAgentDefaults: resolveTestAgentDefaults, ...params});
}

function expression(source: string): TestWorkflowExpression {
  return {language: 'cel', check: 'typed', source: source as TestWorkflowExpression['source']};
}

function template(source: string): string {
  return `\${{ ${source} }}`;
}

function shellRef(name: string): string {
  return `\${${name}}`;
}

function runContext(overrides: Record<string, unknown> = {}) {
  return {
    run: {
      id: 'run-1',
      name: 'Build',
      definition_id: 'def-1',
      project_id: 'proj-1',
      workspace_id: 'workspace-1',
      created_at: new Date('2026-06-30T12:00:00.000Z'),
      ...overrides,
    },
    trigger: {source: 'manual', event: 'fire'},
    event: null,
    inputs: null,
  };
}

function creationContext(
  values: Record<string, unknown> = runContext(),
): WorkflowEvaluationContext {
  return {site: 'run-creation', values};
}

describe('materializeWorkflowModel', () => {
  it('keeps literal job names in runtime jobs', async () => {
    const model = workflowModel({
      jobs: {
        deploy: {
          name: 'Deploy',
          steps: [{run: 'echo deploy'}],
        },
        review: {
          name: 'Review',
          steps: [{run: 'echo review'}],
        },
      },
    });

    const rows = await materializeWorkflowModel({model});
    const deploy = rows.find((job) => job.key === 'deploy');
    const review = rows.find((job) => job.key === 'review');

    expect(deploy).toMatchObject({key: 'deploy', name: 'Deploy'});
    expect(review).toMatchObject({key: 'review', name: 'Review'});
  });

  it('converts workflow model jobs and steps to runtime rows', async () => {
    const model = workflowModel({
      runner: 'ubuntu-latest',
      jobs: {
        build: {
          steps: [
            {
              key: 'install',
              name: 'install',
              run: 'npm install',
              sourceLocation: {startLine: 5, endLine: 6},
            },
            {
              run: 'npm run build',
              sourceLocation: {startLine: 7, endLine: 14},
              gate: {
                success: expression('step.exit_code == 0'),
                onFailure: {restartFrom: 'install', feedback: 'Build failed'},
              },
            },
          ],
        },
        test: {
          needs: 'build',
          runner: ['ubuntu-latest', 'node-22'],
          steps: [{run: 'npm test'}],
        },
      },
    });

    const rows = await materializeWorkflowModel({model});

    const setupStep = {
      key: null,
      name: 'Set up job',
      sourceLocation: null,
      status: 'pending',
      type: 'setup',
      config: {},
      authoredConfig: null,
      position: 0,
    };

    expect(rows).toEqual([
      {
        key: 'build',
        mode: 'one_shot',
        checkout: DEFAULT_JOB_CHECKOUT,
        dependencies: [],
        runner: ['ubuntu-latest'],
        position: 0,
        steps: [
          setupStep,
          {
            key: 'install',
            name: 'install',
            sourceLocation: {startLine: 5, endLine: 6},
            status: 'pending',
            type: 'run',
            config: {run: 'npm install'},
            authoredConfig: null,
            position: 1,
          },
          {
            key: null,
            name: 'npm run build',
            sourceLocation: {startLine: 7, endLine: 14},
            status: 'pending',
            type: 'run',
            config: {
              run: 'npm run build',
              gate: {
                success: {language: 'cel', check: 'typed', source: 'step.exit_code == 0'},
                on_failure: {restart_from: 'install', feedback: 'Build failed'},
              },
            },
            authoredConfig: null,
            position: 2,
          },
        ],
      },
      {
        key: 'test',
        mode: 'one_shot',
        checkout: DEFAULT_JOB_CHECKOUT,
        dependencies: ['build'],
        runner: ['ubuntu-latest', 'node-22'],
        position: 1,
        steps: [
          setupStep,
          {
            key: null,
            name: 'npm test',
            sourceLocation: null,
            status: 'pending',
            type: 'run',
            config: {run: 'npm test'},
            authoredConfig: null,
            position: 1,
          },
        ],
      },
    ]);
  });

  it('materializes an agent step as type "agent" with its config, alongside run steps', async () => {
    const model = workflowModel({
      jobs: {
        fix: {
          steps: [
            {run: 'npm install'},
            {
              key: 'implement',
              name: 'implement',
              model: 'claude-opus-4-8',
              provider: 'anthropic',
              thinking: 'high',
              prompt: 'Fix the tests.',
            },
            {
              model: 'gpt-5.5-pro',
              provider: 'openai',
              thinking: 'low',
              prompt: 'Review it.',
              gate: {
                success: expression('step.exit_code == 0'),
                onFailure: {restartFrom: 'implement'},
              },
            },
          ],
        },
      },
    });

    const rows = await materializeWorkflowModel({model});

    expect(rows[0]?.steps[2]).toEqual({
      key: 'implement',
      name: 'implement',
      sourceLocation: null,
      status: 'pending',
      type: 'agent',
      config: {
        harness: 'pi',
        model: 'claude-opus-4-8',
        provider: 'anthropic',
        thinking: 'high',
        prompt: 'Fix the tests.',
      },
      authoredConfig: null,
      position: 2,
    });
    expect(rows[0]?.steps[3]).toEqual({
      key: null,
      name: 'gpt-5.5-pro · Review it.',
      sourceLocation: null,
      status: 'pending',
      type: 'agent',
      config: {
        harness: 'pi',
        model: 'gpt-5.5-pro',
        provider: 'openai',
        thinking: 'low',
        prompt: 'Review it.',
        gate: {
          success: {language: 'cel', check: 'typed', source: 'step.exit_code == 0'},
          on_failure: {restart_from: 'implement'},
        },
      },
      authoredConfig: null,
      position: 3,
    });
  });

  it('materializes prompt-only agent steps with catalog defaults before runner execution', async () => {
    const model = workflowModel({
      jobs: {
        fix: {
          steps: [{prompt: 'Fix the failing tests.'}],
        },
      },
    });

    const rows = await materializeWorkflowModel({model});

    expect(rows[0]?.steps[1]).toEqual({
      key: null,
      name: 'Fix the failing tests.',
      sourceLocation: null,
      status: 'pending',
      type: 'agent',
      config: {
        harness: 'pi',
        model: 'claude-opus-4-8',
        provider: 'anthropic',
        thinking: 'xhigh',
        prompt: 'Fix the failing tests.',
      },
      authoredConfig: null,
      position: 1,
    });
  });

  it('materializes agent step tools into resolved config', async () => {
    const model = workflowModel({
      jobs: {
        fix: {
          steps: [
            {
              harness: 'pi',
              model: 'claude-opus-4-8',
              provider: 'anthropic',
              thinking: 'high',
              tools: ['read', 'web_search'],
              prompt: 'Fix the failing tests.',
            },
          ],
        },
      },
    });

    const rows = await materializeWorkflowModel({model});

    expect(rows[0]?.steps[1]?.config).toEqual({
      harness: 'pi',
      model: 'claude-opus-4-8',
      provider: 'anthropic',
      thinking: 'high',
      tools: ['read', 'web_search'],
      prompt: 'Fix the failing tests.',
    });
  });

  it('materializes provider-only agent steps with that provider catalog default model', async () => {
    const model = workflowModel({
      jobs: {
        fix: {
          steps: [{provider: 'openai', prompt: 'Fix the failing tests.'}],
        },
      },
    });

    const rows = await materializeWorkflowModel({model});

    expect(rows[0]?.steps[1]?.config).toEqual({
      harness: 'pi',
      model: 'gpt-5.5-pro',
      provider: 'openai',
      thinking: 'xhigh',
      prompt: 'Fix the failing tests.',
    });
  });

  it('passes checkout through to materialized jobs', async () => {
    const model = workflowModel({
      jobs: {
        build: {
          checkout: {
            fetchDepth: 1,
            permissions: {contents: 'write'},
            persistCredentials: false,
          },
          steps: [{run: 'npm test'}],
        },
      },
    });

    const rows = await materializeWorkflowModel({model});

    expect(rows[0]?.checkout).toEqual({
      fetchDepth: 1,
      permissions: {contents: 'write'},
      persistCredentials: false,
    });
  });

  it('passes default checkout through to materialized jobs', async () => {
    const model = workflowModel();

    const rows = await materializeWorkflowModel({model});

    expect(rows[0]?.checkout).toEqual(DEFAULT_JOB_CHECKOUT);
  });

  it('routes agent steps through the provided resolver', async () => {
    const model = workflowModel({
      jobs: {
        fix: {
          steps: [{provider: 'anthropic', prompt: 'Fix the failing tests.'}],
        },
      },
    });
    const resolveAgentDefaults = vi.fn<AgentDefaultsResolver>().mockReturnValue({
      harness: 'pi',
      provider: 'openai',
      model: 'gpt-5.5-pro',
      thinking: 'medium',
    });

    const rows = await materializeWorkflowModel({
      model,
      resolveAgentDefaults,
      definitionId: 'def-1',
    });

    expect(resolveAgentDefaults).toHaveBeenCalledWith({
      harness: undefined,
      provider: 'anthropic',
      model: undefined,
      thinking: undefined,
    });
    expect(rows[0]?.steps[1]).toMatchObject({
      name: 'Fix the failing tests.',
      config: {
        harness: 'pi',
        model: 'gpt-5.5-pro',
        provider: 'openai',
        thinking: 'medium',
        prompt: 'Fix the failing tests.',
      },
    });
  });

  it('wraps known resolver errors as permanent agent config errors', async () => {
    const model = workflowModel({
      jobs: {
        fix: {steps: [{prompt: 'Fix the failing tests.'}]},
      },
    });
    const resolveAgentDefaults = vi.fn<AgentDefaultsResolver>().mockImplementation(() => {
      throw createInterModuleKnownError(
        agentInterModuleContract.methods.resolveAgentConfig,
        'agent-config-invalid',
        {},
      );
    });

    const materialize = () =>
      materializeWorkflowModel({model, resolveAgentDefaults, definitionId: 'def-1'});

    await expect(materialize()).rejects.toThrow(AgentConfigUnresolvableError);
    await expect(materialize()).rejects.toThrow(
      'Agent configuration cannot be resolved for definition def-1',
    );
  });

  it('re-throws unknown resolver errors unchanged', async () => {
    const model = workflowModel({
      jobs: {
        fix: {steps: [{prompt: 'Fix the failing tests.'}]},
      },
    });
    const error = new Error('database unavailable');
    const resolveAgentDefaults = vi.fn<AgentDefaultsResolver>().mockImplementation(() => {
      throw error;
    });

    const materialize = () =>
      materializeWorkflowModel({model, resolveAgentDefaults, definitionId: 'def-1'});

    await expect(materialize()).rejects.toThrow(error);
  });

  it('materializes merged env for run steps only', async () => {
    const model = workflowModel({
      env: {SHARED: 'workflow', WORKFLOW_ONLY: 'yes'},
      jobs: {
        build: {
          env: {SHARED: 'job', JOB_ONLY: 'yes'},
          steps: [
            {name: 'run', run: 'npm test', env: {SHARED: 'step', STEP_ONLY: 'yes'}},
            {
              name: 'agent',
              model: 'claude-opus-4-8',
              provider: 'anthropic',
              thinking: 'high',
              prompt: 'Fix it.',
            },
          ],
        },
      },
    });

    const rows = await materializeWorkflowModel({model});

    expect(rows[0]?.steps[0]?.config).toEqual({});
    expect(rows[0]?.steps[1]?.config).toEqual({
      run: 'npm test',
      env: {
        SHARED: 'step',
        WORKFLOW_ONLY: 'yes',
        JOB_ONLY: 'yes',
        STEP_ONLY: 'yes',
      },
    });
    expect(rows[0]?.steps[2]?.config).toEqual({
      harness: 'pi',
      model: 'claude-opus-4-8',
      provider: 'anthropic',
      thinking: 'high',
      prompt: 'Fix it.',
    });
  });

  it('omits env from run-step config when the merge is empty', async () => {
    const model = workflowModel({
      jobs: {
        build: {
          steps: [{run: 'npm test'}],
        },
      },
    });

    const rows = await materializeWorkflowModel({model});

    expect(rows[0]?.steps[1]?.config).toEqual({run: 'npm test'});
  });

  it('hoists run interpolation into generated env vars with shell references', async () => {
    const model = workflowModel({
      jobs: {
        build: {
          steps: [{run: `echo "${template('run.id')}" && echo "${template('run.created_at')}"`}],
        },
      },
    });

    const rows = await materializeWorkflowModel({model, context: creationContext()});

    expect(rows[0]?.steps[1]?.config).toEqual({
      run: `echo "${shellRef('__sf_0')}" && echo "${shellRef('__sf_1')}"`,
      env: {
        __sf_0: 'run-1',
        __sf_1: '2026-06-30T12:00:00.000Z',
      },
    });
    expect(rows[0]?.steps[1]?.authoredConfig).toEqual({
      run: `echo "${template('run.id')}" && echo "${template('run.created_at')}"`,
    });
  });

  it('hoists command secret assignments outside command substitutions', async () => {
    const command = [
      `COMMAND_SECRET='${template('secrets.RUNTIME_TOKEN')}'`,
      'export COMMAND_SECRET',
      `command_secret_sha="$(node -e 'const crypto = require("node:crypto"); process.stdout.write(crypto.createHash("sha256").update(process.env.COMMAND_SECRET ?? "").digest("hex"));')"`,
    ].join('\n');
    const model = workflowModel({
      jobs: {
        build: {
          steps: [{run: command}],
        },
      },
    });

    const rows = await materializeWorkflowModel({model, context: creationContext()});

    expect(rows[0]?.steps[1]?.config).toEqual({
      run: [
        `COMMAND_SECRET=''"${shellRef('__sf_0')}"''`,
        'export COMMAND_SECRET',
        `command_secret_sha="$(node -e 'const crypto = require("node:crypto"); process.stdout.write(crypto.createHash("sha256").update(process.env.COMMAND_SECRET ?? "").digest("hex"));')"`,
      ].join('\n'),
    });
    expect(rows[0]?.steps[1]?.configPlan).toMatchObject({
      env: {
        __sf_0: {
          segments: [
            {
              expression: {source: 'secrets.RUNTIME_TOKEN'},
              kind: 'deferred',
            },
          ],
        },
      },
    });
  });

  it('freezes vars from the run-creation context into step config', async () => {
    const model = workflowModel({
      name: 'vars workflow',
      runner: 'ubuntu-latest',
      jobs: {
        deploy: {
          steps: [
            {
              run: 'deploy',
              env: {REGION: template('"eu-" + vars.REGION')},
            },
          ],
        },
      },
    });

    const rows = await materializeWorkflowModel({
      model,
      context: creationContext({...runContext(), vars: {REGION: 'west'}}),
    });

    expect(rows[0]?.steps[1]?.config).toMatchObject({
      env: {REGION: 'eu-west'},
    });
    expect(rows[0]?.steps[1]?.configPlan).toEqual({
      trace: [
        {
          expression: '"eu-" + vars.REGION',
          roots: ['vars'],
          fillTarget: 'run-creation',
          evaluatedAt: 'run-creation',
          value: 'eu-west',
          field: 'env',
          envKey: 'REGION',
        },
      ],
    });
  });

  it('resolves working directories for run and agent steps', async () => {
    const model = workflowModel({
      jobs: {
        build: {
          steps: [
            {run: 'npm test', workingDirectory: 'packages/api'},
            {prompt: 'Review the changes', workingDirectory: template('run.id')},
          ],
        },
      },
    });

    const rows = await materializeWorkflowModel({model, context: creationContext()});

    expect(rows[0]?.steps[1]?.config).toEqual({
      run: 'npm test',
      working_directory: 'packages/api',
    });
    expect(rows[0]?.steps[2]?.config).toMatchObject({
      harness: 'pi',
      prompt: 'Review the changes',
      working_directory: 'run-1',
    });
  });

  it('defers unresolved working directory templates until step dispatch', async () => {
    const model = workflowModel({
      jobs: {
        build: {
          steps: [{run: 'npm test', workingDirectory: template('steps.previous.outputs.path')}],
        },
      },
    });

    const rows = await materializeWorkflowModel({model, context: creationContext()});

    expect(rows[0]?.steps[1]?.config).toEqual({run: 'npm test'});
    expect(rows[0]?.steps[1]?.configPlan?.working_directory).toEqual({
      segments: [
        {
          kind: 'deferred',
          expression: {
            language: 'cel',
            source: 'steps.previous.outputs.path',
            check: 'syntax',
          },
          fillTarget: 'step-dispatch',
          roots: ['steps'],
        },
      ],
    });
  });

  it('merges env before resolving and only resolves the winning values', async () => {
    const model = workflowModel({
      env: {SHARED: template('event.missing'), WORKFLOW_ONLY: template('run.id')},
      jobs: {
        build: {
          env: {JOB_ONLY: template('trigger.source')},
          steps: [
            {
              run: 'echo ok',
              env: {SHARED: 'step', __sf_0: 'reserved'},
            },
          ],
        },
      },
    });

    const rows = await materializeWorkflowModel({model, context: creationContext()});

    expect(rows[0]?.steps[1]?.config).toEqual({
      run: 'echo ok',
      env: {
        SHARED: 'step',
        WORKFLOW_ONLY: 'run-1',
        JOB_ONLY: 'manual',
        __sf_0: 'reserved',
      },
    });
    expect(rows[0]?.steps[1]?.authoredConfig).toEqual({
      run: 'echo ok',
      env: {
        SHARED: 'step',
        WORKFLOW_ONLY: template('run.id'),
        JOB_ONLY: template('trigger.source'),
        __sf_0: 'reserved',
      },
    });
    expect(rows[0]?.steps[1]?.diagnostics).toBeUndefined();
  });

  it('throws a permanent interpolation error for available missing untrusted env paths', async () => {
    const model = workflowModel({
      jobs: {
        build: {
          steps: [{run: 'echo ok', env: {REF: template('event.ref')}}],
        },
      },
    });

    let error: unknown;
    try {
      await materializeWorkflowModel({
        model,
        context: creationContext({...runContext(), event: {}}),
        definitionId: 'def-1',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InterpolationUnresolvableError);
    expect(error).toMatchObject({
      field: 'env',
      source: 'event.ref',
      envKey: 'REF',
    });
    expect((error as Error).message).toContain("Use has(x) ? x : ''");
  });

  it('preserves dispatch-time execution paths in the config plan at creation', async () => {
    const model = workflowModel({
      jobs: {
        build: {
          steps: [{run: 'echo ok', env: {BODY: template('execution.events[0].data.body')}}],
        },
      },
    });

    const rows = await materializeWorkflowModel({
      model,
      context: creationContext(),
      definitionId: 'def-1',
    });

    expect(rows[0]?.steps[1]?.config).toEqual({
      run: 'echo ok',
    });
    expect(rows[0]?.steps[1]?.configPlan?.env?.BODY?.segments).toEqual([
      expect.objectContaining({
        kind: 'deferred',
        roots: ['execution'],
        fillTarget: 'execution-creation',
      }),
    ]);
    expect(rows[0]?.steps[1]?.diagnostics).toBeUndefined();
  });

  it('reserves user env names when generating run interpolation env vars', async () => {
    const model = workflowModel({
      jobs: {
        build: {
          steps: [{run: `echo "${template('run.id')}"`, env: {__sf_0: 'user'}}],
        },
      },
    });

    const rows = await materializeWorkflowModel({model, context: creationContext()});

    expect(rows[0]?.steps[1]?.config).toEqual({
      run: `echo "${shellRef('__sf_1')}"`,
      env: {__sf_0: 'user', __sf_1: 'run-1'},
    });
  });

  it('reserves deferred user env names when generating run interpolation env vars', async () => {
    const model = workflowModel({
      jobs: {
        build: {
          steps: [
            {
              run: `echo "${template('run.id')}"`,
              env: {__sf_0: template('execution.name')},
            },
          ],
        },
      },
    });

    const rows = await materializeWorkflowModel({model, context: creationContext()});

    expect(rows[0]?.steps[1]?.config).toEqual({
      run: `echo "${shellRef('__sf_1')}"`,
      env: {__sf_1: 'run-1'},
    });
    expect(rows[0]?.steps[1]?.configPlan?.env).toEqual({
      __sf_0: {
        segments: [
          expect.objectContaining({
            kind: 'deferred',
            roots: ['execution'],
            fillTarget: 'execution-creation',
          }),
        ],
      },
    });
  });

  it('resolves agent prompt, model, and provider before catalog defaults', async () => {
    const model = workflowModel({
      jobs: {
        fix: {
          steps: [
            {
              harness: 'claude',
              provider: template('trigger.source'),
              model: template('run.name'),
              tools: ['Read', 'WebSearch'],
              prompt: `Fix ${template('run.id')}`,
            },
          ],
        },
      },
    });
    const resolveAgentDefaults = vi.fn<AgentDefaultsResolver>().mockReturnValue({
      harness: 'claude',
      provider: 'openai',
      model: 'gpt-5.5-pro',
      thinking: 'medium',
    });

    const rows = await materializeWorkflowModel({
      model,
      context: creationContext({
        ...runContext({name: 'gpt-5.5-pro'}),
        trigger: {source: 'openai', event: 'fire'},
      }),
      resolveAgentDefaults,
      definitionId: 'def-1',
    });

    expect(resolveAgentDefaults).toHaveBeenCalledWith({
      harness: 'claude',
      provider: 'openai',
      model: 'gpt-5.5-pro',
      thinking: undefined,
    });
    expect(rows[0]?.steps[1]?.config).toEqual({
      harness: 'claude',
      provider: 'openai',
      model: 'gpt-5.5-pro',
      thinking: 'medium',
      tools: ['Read', 'WebSearch'],
      prompt: 'Fix run-1',
    });
    expect(rows[0]?.steps[1]?.authoredConfig).toEqual({
      harness: 'claude',
      provider: template('trigger.source'),
      model: template('run.name'),
      tools: ['Read', 'WebSearch'],
      prompt: `Fix ${template('run.id')}`,
    });
  });

  it('keeps agent tools in the dispatch plan while config is deferred', async () => {
    const model = workflowModel({
      jobs: {
        fix: {
          steps: [
            {
              harness: 'claude',
              model: template('execution.events[0].data.model'),
              provider: 'anthropic',
              tools: ['Read', 'Grep'],
              prompt: 'Review it.',
            },
          ],
        },
      },
    });

    const rows = await materializeWorkflowModel({
      model,
      context: creationContext(),
      definitionId: 'def-1',
    });

    expect(rows[0]?.steps[1]?.config).toEqual({});
    expect(rows[0]?.steps[1]?.configPlan?.agent).toMatchObject({
      harness: 'claude',
      provider: {
        segments: [{kind: 'literal', value: 'anthropic'}],
      },
      tools: ['Read', 'Grep'],
      prompt: {
        segments: [{kind: 'literal', value: 'Review it.'}],
      },
    });
    expect(rows[0]?.steps[1]?.configPlan?.agent?.model?.segments).toEqual([
      expect.objectContaining({
        kind: 'deferred',
        roots: ['execution'],
        fillTarget: 'execution-creation',
      }),
    ]);
  });

  it('throws a permanent interpolation error for unsafe run interpolation', async () => {
    const model = workflowModel({
      jobs: {
        build: {steps: [{run: `echo \`${template('run.id')}\``}]},
      },
    });

    const materialize = () =>
      materializeWorkflowModel({model, context: creationContext(), definitionId: 'def-1'});

    await expect(materialize()).rejects.toThrow(InterpolationUnresolvableError);
  });

  it('throws a permanent interpolation error for a missing trusted run path', async () => {
    const model = workflowModel({
      jobs: {
        build: {steps: [{run: `echo "${template('run.id')}"`}]},
      },
    });

    const materialize = () =>
      materializeWorkflowModel({model, context: creationContext({}), definitionId: 'def-1'});

    await expect(materialize()).rejects.toThrow(InterpolationUnresolvableError);
  });

  it('throws a permanent interpolation error for missing available agent prompt paths', async () => {
    const model = workflowModel({
      jobs: {
        fix: {steps: [{prompt: template('inputs.ticket')}]},
      },
    });

    let error: unknown;
    try {
      await materializeWorkflowModel({
        model,
        context: creationContext({...runContext(), inputs: {}}),
        definitionId: 'def-1',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InterpolationUnresolvableError);
    expect(error).toMatchObject({
      field: 'agent.prompt',
      source: 'inputs.ticket',
    });
  });

  it('throws a permanent interpolation error for a missing trusted agent model path', async () => {
    const model = workflowModel({
      jobs: {
        fix: {steps: [{model: template('run.missing'), prompt: 'Fix it.'}]},
      },
    });

    let error: unknown;
    try {
      await materializeWorkflowModel({
        model,
        context: creationContext(),
        definitionId: 'def-1',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InterpolationUnresolvableError);
    expect(error).toMatchObject({
      field: 'agent.model',
      source: 'run.missing',
    });
  });

  it('degrades missing execution paths in step names', async () => {
    const model = workflowModel({
      jobs: {
        review: {
          steps: [
            {
              name: `Review ${template('execution.events[0].data.body')}`,
              prompt: 'Summarize the review',
            },
          ],
        },
      },
    });

    const rows = await materializeWorkflowModel({
      model,
      context: creationContext(),
      definitionId: 'def-1',
    });

    expect(rows[0]?.steps[1]).toMatchObject({
      name: 'Review ',
      diagnostics: [
        {
          reason: 'missing-path',
          expression: 'execution.events[0].data.body',
          contextRoots: ['execution'],
          field: 'step.name',
        },
      ],
    });
  });

  it('degrades missing available untrusted paths in step names', async () => {
    const model = workflowModel({
      jobs: {
        review: {
          steps: [
            {
              name: `Review ${template('event.title')}`,
              prompt: 'Summarize the review',
            },
          ],
        },
      },
    });

    const rows = await materializeWorkflowModel({
      model,
      context: creationContext({...runContext(), event: {}}),
      definitionId: 'def-1',
    });

    expect(rows[0]?.steps[1]).toMatchObject({
      name: 'Review ',
      diagnostics: [
        {
          reason: 'missing-path',
          expression: 'event.title',
          contextRoots: ['event'],
          field: 'step.name',
        },
      ],
    });
  });

  it('uses the display-name fallback when a degraded step name resolves empty', async () => {
    const model = workflowModel({
      jobs: {
        build: {
          steps: [
            {
              name: template('event.title'),
              run: 'npm test',
            },
          ],
        },
      },
    });

    const rows = await materializeWorkflowModel({
      model,
      context: creationContext({...runContext(), event: {}}),
      definitionId: 'def-1',
    });

    expect(rows[0]?.steps[1]).toMatchObject({
      name: 'npm test',
      diagnostics: [
        {
          reason: 'missing-path',
          expression: 'event.title',
          contextRoots: ['event'],
          field: 'step.name',
        },
      ],
    });
  });

  it('skips listening job steps at workflow-run creation', async () => {
    const stepNameSource = `Review ${template('execution.index')}`;
    const model = workflowModel({
      name: 'Listening workflow',
      runner: 'ubuntu-latest',
      jobs: {
        review: {
          listening: {
            on: [{source: 'github', event: 'pull_request_review'}],
            maxExecutions: 3,
            onResolve: 'finish',
          },
          steps: [{name: stepNameSource, prompt: 'Summarize the review.'}],
        },
      },
    });

    const rows = await materializeWorkflowModel({
      model,
      context: creationContext(),
      definitionId: 'def-1',
    });

    expect(rows[0]).toMatchObject({
      key: 'review',
      mode: 'listening',
      steps: [],
    });
  });

  it('materializes one-shot siblings while skipping listening steps', async () => {
    const model = workflowModel({
      name: 'Mixed workflow',
      runner: 'ubuntu-latest',
      jobs: {
        review: {
          listening: {
            on: [{source: 'github', event: 'pull_request_review'}],
            maxExecutions: 3,
            onResolve: 'finish',
          },
          steps: [{name: `Review ${template('execution.index')}`, prompt: 'Summarize it.'}],
        },
        build: {
          steps: [{run: 'npm test'}],
        },
      },
    });

    const rows = await materializeWorkflowModel({model, context: creationContext()});

    const review = rows.find((job) => job.key === 'review');
    const build = rows.find((job) => job.key === 'build');
    expect(review?.steps).toEqual([]);
    expect(build?.steps).toHaveLength(2);
    expect(build?.steps[0]).toMatchObject({type: 'setup', name: 'Set up job', position: 0});
    expect(build?.steps[1]).toMatchObject({type: 'run', config: {run: 'npm test'}, position: 1});
  });

  it('uses the supplied context for each materialization call', async () => {
    const model = workflowModel({
      jobs: {
        build: {steps: [{run: `echo "${template('run.id')}"`}]},
      },
    });

    const first = await materializeWorkflowModel({
      model,
      context: creationContext(runContext({id: 'run-a'})),
    });
    const second = await materializeWorkflowModel({
      model,
      context: creationContext(runContext({id: 'run-b'})),
    });

    expect(first[0]?.steps[1]?.config).toMatchObject({env: {__sf_0: 'run-a'}});
    expect(second[0]?.steps[1]?.config).toMatchObject({env: {__sf_0: 'run-b'}});
  });

  it('gives a job with no user steps just the synthetic setup step', async () => {
    const model = workflowModel({jobs: {noop: {steps: []}}});

    const rows = await materializeWorkflowModel({model});

    expect(rows[0]?.steps).toEqual([
      {
        key: null,
        name: 'Set up job',
        sourceLocation: null,
        status: 'pending',
        type: 'setup',
        config: {},
        authoredConfig: null,
        position: 0,
      },
    ]);
    expect(rows[0]?.checkout).toEqual(DEFAULT_JOB_CHECKOUT);
  });

  it('materializes step if as server-owned condition outside runner config', async () => {
    const model = workflowModel({
      name: 'Conditional workflow',
      runner: 'ubuntu-latest',
      jobs: {
        build: {
          steps: [{if: expression('false'), run: 'npm test'}],
        },
      },
    });

    const rows = await materializeWorkflowModel({model});

    const step = rows[0]?.steps[1];
    expect(step?.condition).toEqual({
      language: 'cel',
      source: 'false',
      check: 'typed',
    });
    expect(step?.config).toEqual({run: 'npm test'});
  });

  it('fails fast when the model contains an unresolved dependency id', async () => {
    const model: WorkflowModel = {
      ...workflowModel(),
      jobs: [
        {
          id: 'test',
          key: 'test',
          mode: 'one_shot',
          runner: [],
          checkout: DEFAULT_JOB_CHECKOUT,
          dependencies: ['missing'],
          steps: [],
        },
      ],
      dependencies: [{from: 'missing', to: 'test'}],
    };

    await expect(materializeWorkflowModel({model})).rejects.toThrow(
      'Unresolved workflow model dependency "missing" for job "test"',
    );
  });

  it('detects whether a workflow model contains agent steps', () => {
    const runOnly = workflowModel();
    const withAgent = workflowModel({
      jobs: {
        fix: {steps: [{prompt: 'Fix the failing tests.'}]},
      },
    });

    expect(modelHasAgentStep(runOnly)).toBe(false);
    expect(modelHasAgentStep(withAgent)).toBe(true);
  });
});

describe('materializeJobRunner', () => {
  it('resolves runner templates against execution context', () => {
    const model = workflowModel({
      jobs: {
        review: {
          runner: ['linux'],
          runnerTemplates: [template('execution.events[0].data.runner')],
          steps: [{run: 'npm test'}],
        },
      },
    });
    const [job] = model.jobs;
    if (!job) throw new Error('Test model created no jobs');

    const result = materializeJobRunner({
      job,
      context: {
        site: 'execution-creation',
        values: {
          ...runContext(),
          execution: {
            index: 1,
            name: 'review #1',
            status: 'pending',
            started_at: null,
            finished_at: null,
            events: [{data: {runner: 'GPU'}, source: 'github', event: 'review'}],
          },
        },
      },
      definitionId: 'definition-1',
    });

    expect(result).toEqual(['gpu', 'linux']);
  });

  it('rejects invalid materialized runner labels', () => {
    const model = workflowModel({
      jobs: {
        review: {
          runner: [],
          runnerTemplates: [template('execution.events[0].data.runner')],
          steps: [{run: 'npm test'}],
        },
      },
    });
    const [job] = model.jobs;
    if (!job) throw new Error('Test model created no jobs');

    const act = () =>
      materializeJobRunner({
        job,
        context: {
          site: 'execution-creation',
          values: {
            ...runContext(),
            execution: {
              index: 1,
              name: 'review #1',
              status: 'pending',
              started_at: null,
              finished_at: null,
              events: [{data: {runner: 'not valid'}, source: 'github', event: 'review'}],
            },
          },
        },
        definitionId: 'definition-1',
      });

    expect(act).toThrow('Job runner labels are invalid: not valid');
  });
});
