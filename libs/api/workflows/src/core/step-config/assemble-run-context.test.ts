import {
  createWorkflowExpression,
  evaluateWorkflowExpression,
  getWorkflowPredicateContextRoots,
} from '@shipfox/expression';
import type {JobExecution} from '#core/entities/job-execution.js';
import type {Step, StepAttempt} from '#core/entities/step.js';
import {
  applyListenerFilterSnapshots,
  assembleCreationContext,
  assembleExecutionCreationContext,
  assembleExecutionResolutionContext,
  assembleGateContext,
  assembleJobActivationContext,
  assembleJobResolutionContext,
  assembleJobsContext,
  assembleListenerSnapshotContext,
  assembleStepDispatchContext,
  assembleWorkflowRunContext,
  listenerFilterOutputTypesForJobs,
  planListenerFilterSnapshots,
} from './assemble-run-context.js';

const date = new Date('2026-06-30T12:00:00.000Z');

describe('assembleJobsContext', () => {
  it.each([
    {persistedValue: 42, expectedValue: 43n},
    {persistedValue: '9007199254740993', expectedValue: 9007199254740994n},
  ])('rehydrates persisted int outputs for CEL arithmetic', ({persistedValue, expectedValue}) => {
    const context = assembleJobsContext([
      {
        job: {key: 'review', status: 'succeeded', outputs: {count: persistedValue}},
        outputTypes: {count: 'int'},
        executions: [],
      },
    ]);
    const expression = createWorkflowExpression({
      source: `jobs.review.outputs.count + 1 == ${expectedValue.toString()}`,
      check: {mode: 'syntax'},
    });

    const result = evaluateWorkflowExpression(expression, context);

    expect(result).toBe(true);
  });

  it('rehydrates persisted timestamp outputs for CEL comparison', () => {
    const persistedValue = '2026-06-30T12:00:00.000Z';
    const context = assembleJobsContext([
      {
        job: {key: 'review', status: 'succeeded', outputs: {createdAt: persistedValue}},
        outputTypes: {createdAt: 'timestamp'},
        executions: [],
      },
    ]);
    const expression = createWorkflowExpression({
      source: 'jobs.review.outputs.createdAt < timestamp("2026-07-01T00:00:00Z")',
      check: {mode: 'syntax'},
    });

    const result = evaluateWorkflowExpression(expression, context);

    expect(result).toBe(true);
  });

  it('rehydrates persisted execution int outputs for CEL arithmetic', () => {
    const context = assembleJobsContext([
      {
        job: {key: 'review', status: 'succeeded', outputs: {}},
        outputTypes: {count: 'int'},
        executions: [jobExecution({outputs: {count: 42}})],
      },
    ]);
    const expression = createWorkflowExpression({
      source: 'jobs.review.executions[0].outputs.count + 1 == 43',
      check: {mode: 'syntax'},
    });

    const result = evaluateWorkflowExpression(expression, context);

    expect(result).toBe(true);
  });

  it('rehydrates persisted execution timestamp outputs for CEL comparison', () => {
    const context = assembleJobsContext([
      {
        job: {key: 'review', status: 'succeeded', outputs: {}},
        outputTypes: {createdAt: 'timestamp'},
        executions: [jobExecution({outputs: {createdAt: '2026-06-30T12:00:00.000Z'}})],
      },
    ]);
    const expression = createWorkflowExpression({
      source: 'jobs.review.executions[0].outputs.createdAt < timestamp("2026-07-01T00:00:00Z")',
      check: {mode: 'syntax'},
    });

    const result = evaluateWorkflowExpression(expression, context);

    expect(result).toBe(true);
  });
});

describe('assembleWorkflowRunContext', () => {
  const run = {
    id: 'run-1',
    number: 1,
    currentAttempt: 1,
    name: 'Build',
    workflowName: 'Build',
    definitionId: 'def-1',
    projectId: 'proj-1',
    workspaceId: 'workspace-1',
    createdAt: new Date('2026-06-30T12:00:00.000Z'),
  };

  it('uses integration payload data as event context', () => {
    const context = assembleWorkflowRunContext({
      run,
      triggerPayload: {
        source: 'github',
        event: 'push',
        deliveryId: 'delivery-1',
        data: {ref: 'refs/heads/main'},
      },
      inputs: {deploy: true},
    });

    expect(context).toEqual({
      workflow: {
        id: 'def-1',
        name: 'Build',
      },
      run: {
        id: 'run-1',
        number: 1n,
        attempt: 1n,
        name: 'Build',
        project_id: 'proj-1',
        workspace_id: 'workspace-1',
        created_at: run.createdAt,
      },
      trigger: {
        source: 'github',
        event: 'push',
        project: null,
        repository: null,
        ref: null,
        commit: null,
      },
      event: {ref: 'refs/heads/main'},
      inputs: {deploy: true},
    });

    const expression = createWorkflowExpression({
      source: 'run.attempt == 1',
      check: {mode: 'syntax'},
    });
    expect(evaluateWorkflowExpression(expression, context)).toBe(true);
  });

  it('rehydrates a later run attempt as a CEL integer', () => {
    const context = assembleWorkflowRunContext({
      run: {...run, currentAttempt: 2},
      triggerPayload: {source: 'manual', event: 'fire', subscriptionId: 'sub-1', userId: 'user-1'},
    });

    expect(context.run).toMatchObject({number: 1n, attempt: 2n});
    expect(
      evaluateWorkflowExpression(
        createWorkflowExpression({source: 'run.attempt == 2', check: {mode: 'syntax'}}),
        context,
      ),
    ).toBe(true);
  });

  it.each([
    {
      source: 'manual' as const,
      event: 'fire' as const,
      subscriptionId: 'sub-1',
      userId: 'user-1',
    },
    {
      source: 'cron' as const,
      event: 'tick' as const,
      scheduleId: 'schedule-1',
    },
  ])('uses null event for %s triggers', (triggerPayload) => {
    const context = assembleWorkflowRunContext({run, triggerPayload});

    expect(context.event).toBeNull();
    expect(context.inputs).toBeNull();
  });
});

describe('assembleCreationContext', () => {
  const run = {
    id: 'run-1',
    number: 1,
    currentAttempt: 1,
    name: 'Build',
    workflowName: 'Build',
    definitionId: 'def-1',
    projectId: 'proj-1',
    workspaceId: 'workspace-1',
    createdAt: new Date('2026-06-30T12:00:00.000Z'),
  };

  it('wraps the run context with the creation site', () => {
    const context = assembleCreationContext({
      run,
      triggerPayload: {
        source: 'github',
        event: 'push',
        deliveryId: 'delivery-1',
        data: {ref: 'refs/heads/main'},
      },
      inputs: {deploy: true},
    });

    expect(context).toEqual({
      site: 'run-creation',
      values: assembleWorkflowRunContext({
        run,
        triggerPayload: {
          source: 'github',
          event: 'push',
          deliveryId: 'delivery-1',
          data: {ref: 'refs/heads/main'},
        },
        inputs: {deploy: true},
      }),
    });
  });

  it('exposes the normalized trigger reference on the trigger root', () => {
    const context = assembleWorkflowRunContext({
      run: {
        ...run,
        triggerReference: {
          project: {id: 'project-1'},
          repository: 'acme/api',
          ref: 'refs/pull/42/head',
          commit: 'a'.repeat(40),
          actor: 'octocat',
        },
      },
      triggerPayload: {
        source: 'github',
        event: 'pull_request',
        deliveryId: 'delivery-1',
        data: {},
      },
    });

    expect(context.trigger).toEqual({
      source: 'github',
      event: 'pull_request',
      project: {id: 'project-1'},
      repository: 'acme/api',
      ref: 'refs/pull/42/head',
      commit: 'a'.repeat(40),
    });
  });
});

describe('assembleExecutionCreationContext', () => {
  const run = {
    id: 'run-1',
    number: 1,
    currentAttempt: 1,
    name: 'Build',
    workflowName: 'Build',
    definitionId: 'def-1',
    projectId: 'proj-1',
    workspaceId: 'workspace-1',
    createdAt: new Date('2026-06-30T12:00:00.000Z'),
  };

  it('wraps run values, prior executions, and the synthetic current execution', () => {
    const prior = jobExecution({
      id: 'exec-1',
      jobId: 'job-1',
      sequence: 1,
      name: 'Build #1',
      status: 'failed',
      finishedAt: date,
    });

    const context = assembleExecutionCreationContext({
      run,
      triggerPayload: {
        source: 'github',
        event: 'push',
        deliveryId: 'delivery-1',
        data: {ref: 'refs/heads/main'},
      },
      inputs: {deploy: true},
      job: {id: 'job-1', key: 'build', name: 'Build'},
      sequence: 2,
      nameOverride: null,
      executionName: 'Build #2',
      status: 'pending',
      triggerEvents: [
        {
          source: 'github',
          event: 'deployment',
          delivery_id: 'delivery-2',
          received_at: '2026-06-30T12:01:00.000Z',
          project: null,
          repository: null,
          ref: null,
          commit: null,
          data: {environment: 'prod'},
        },
      ],
      priorExecutions: [prior],
    });

    expect(context).toEqual({
      site: 'execution-creation',
      values: {
        ...assembleWorkflowRunContext({
          run,
          triggerPayload: {
            source: 'github',
            event: 'push',
            deliveryId: 'delivery-1',
            data: {ref: 'refs/heads/main'},
          },
          inputs: {deploy: true},
        }),
        executions: [
          {
            index: 0n,
            name: 'Build #1',
            status: 'failed',
            started_at: date,
            finished_at: date,
            events: prior.triggerEvents.map((event) => ({...event, received_at: date})),
            outputs: {},
          },
          {
            index: 1n,
            name: 'Build #2',
            status: 'pending',
            started_at: null,
            finished_at: null,
            events: [
              {
                source: 'github',
                event: 'deployment',
                delivery_id: 'delivery-2',
                received_at: new Date('2026-06-30T12:01:00.000Z'),
                project: null,
                repository: null,
                ref: null,
                commit: null,
                data: {environment: 'prod'},
              },
            ],
            outputs: {},
          },
        ],
        job: {key: 'build', name: 'Build'},
        execution: {
          index: 1n,
          name: 'Build #2',
          status: 'pending',
          started_at: null,
          finished_at: null,
          events: [
            {
              source: 'github',
              event: 'deployment',
              delivery_id: 'delivery-2',
              received_at: new Date('2026-06-30T12:01:00.000Z'),
              project: null,
              repository: null,
              ref: null,
              commit: null,
              data: {environment: 'prod'},
            },
          ],
          outputs: {},
        },
      },
    });
  });
});

describe('assembleJobActivationContext', () => {
  const run = {
    id: 'run-1',
    number: 1,
    currentAttempt: 1,
    name: 'Build',
    workflowName: 'Build',
    definitionId: 'def-1',
    projectId: 'proj-1',
    workspaceId: 'workspace-1',
    createdAt: new Date('2026-06-30T12:00:00.000Z'),
  };

  it('wraps run values, named dependency jobs, and ordered needs', () => {
    const buildExecution = jobExecution({
      id: 'exec-build',
      jobId: 'job-build',
      sequence: 1,
      name: 'Build #1',
      status: 'succeeded',
      outputs: {sha: 'abc123'},
    });
    const context = assembleJobActivationContext({
      run,
      triggerPayload: {
        source: 'github',
        event: 'push',
        deliveryId: 'delivery-1',
        data: {ref: 'refs/heads/main'},
      },
      inputs: {deploy: true},
      jobs: [
        {
          job: {key: 'build', status: 'succeeded', outputs: {image: 'app:123'}},
          executions: [buildExecution],
        },
        {
          job: {key: 'lint', status: 'skipped', outputs: null},
          executions: [],
        },
      ],
    });

    expect(Object.keys(context.values).sort()).toEqual(
      [...getWorkflowPredicateContextRoots('job.if')].sort(),
    );
    expect(context).toEqual({
      site: 'job-activation',
      values: {
        ...assembleWorkflowRunContext({
          run,
          triggerPayload: {
            source: 'github',
            event: 'push',
            deliveryId: 'delivery-1',
            data: {ref: 'refs/heads/main'},
          },
          inputs: {deploy: true},
        }),
        jobs: {
          build: {
            key: 'build',
            status: 'succeeded',
            outputs: {image: 'app:123'},
            executions: [
              {
                index: 0n,
                name: 'Build #1',
                status: 'succeeded',
                started_at: date,
                finished_at: null,
                events: buildExecution.triggerEvents.map((event) => ({
                  ...event,
                  received_at: date,
                })),
                outputs: {sha: 'abc123'},
              },
            ],
          },
          lint: {
            key: 'lint',
            status: 'skipped',
            outputs: {},
            executions: [],
          },
        },
        needs: [
          {
            key: 'build',
            status: 'succeeded',
            outputs: {image: 'app:123'},
            executions: [
              {
                index: 0n,
                name: 'Build #1',
                status: 'succeeded',
                started_at: date,
                finished_at: null,
                events: buildExecution.triggerEvents.map((event) => ({
                  ...event,
                  received_at: date,
                })),
                outputs: {sha: 'abc123'},
              },
            ],
          },
          {
            key: 'lint',
            status: 'skipped',
            outputs: {},
            executions: [],
          },
        ],
        vars: {},
      },
    });
  });
});

describe('listener filter snapshots', () => {
  const run = {
    id: 'run-1',
    number: 7,
    currentAttempt: 2,
    name: 'Build',
    workflowName: 'Build',
    definitionId: 'def-1',
    projectId: 'proj-1',
    workspaceId: 'workspace-1',
    createdAt: new Date('2026-06-30T12:00:00.000Z'),
  };
  const triggerPayload = {
    source: 'github',
    event: 'pull_request',
    deliveryId: 'delivery-1',
    data: {action: 'opened'},
  } as const;

  it('snapshots supported roots and exact referenced job keys', () => {
    const plan = planListenerFilterSnapshots({
      on: [
        {
          source: 'github',
          event: 'pull_request',
          filter:
            'jobs.build.outputs.pr_number == event.pull_request.number && inputs.environment == "prod" && trigger.event == "pull_request" && workflow.name != "" && run.id != "" && job.key == "await" && vars.ENABLED == "true"',
        },
      ],
      until: null,
    });
    const context = assembleListenerSnapshotContext({
      job: {key: 'await'},
      run,
      triggerPayload,
      inputs: {environment: 'prod'},
      vars: {ENABLED: 'true'},
      plan,
      dependencyJobs: [
        {
          job: {key: 'build', status: 'succeeded', outputs: {pr_number: 42}},
          executions: [jobExecution({id: 'exec-build', jobId: 'job-build'})],
        },
        {
          job: {key: 'review', status: 'succeeded', outputs: {pr_number: 99}},
          executions: [jobExecution({id: 'exec-review', jobId: 'job-review'})],
        },
      ],
    });

    const [matcher] = applyListenerFilterSnapshots(plan.on, context);

    expect(matcher?.filter_snapshot).toEqual({
      workflow: {id: 'def-1', name: 'Build'},
      run: expect.objectContaining({id: 'run-1', name: 'Build'}),
      trigger: {
        source: 'github',
        event: 'pull_request',
        project: null,
        repository: null,
        ref: null,
        commit: null,
      },
      inputs: {environment: 'prod'},
      job: {key: 'await'},
      vars: {ENABLED: 'true'},
      jobs: {
        build: expect.objectContaining({
          key: 'build',
          status: 'succeeded',
          outputs: {pr_number: 42},
        }),
      },
    });
    expect(Object.keys(matcher?.filter_snapshot ?? {}).sort()).toEqual(
      getWorkflowPredicateContextRoots('listener.on')
        .filter((root) => root !== 'event')
        .sort(),
    );
    expect(matcher?.filter_snapshot).not.toHaveProperty('event');
    const jobs = matcher?.filter_snapshot?.jobs as Record<string, unknown> | undefined;
    expect(jobs).not.toHaveProperty('review');
    expect(jobs?.build).not.toHaveProperty('executions');
  });

  it('projects only referenced execution fields and output keys', () => {
    const plan = planListenerFilterSnapshots({
      on: [
        {
          source: 'github',
          event: 'pull_request',
          filter: 'jobs.build.executions.exists(e, e.outputs.pr_number == 42)',
        },
      ],
      until: null,
    });
    const dependencyJobs = [
      {
        job: {
          key: 'build',
          status: 'succeeded' as const,
          outputs: {pr_number: 42, unrelated: 'large'},
        },
        outputTypes: {pr_number: 'int' as const, unrelated: 'string' as const},
        executions: [
          jobExecution({
            id: 'exec-build',
            jobId: 'job-build',
            outputs: {pr_number: 42, unrelated: 'large'},
            triggerEvents: [
              {
                source: 'github',
                event: 'push',
                delivery_id: 'delivery-1',
                received_at: '2026-06-30T12:00:00.000Z',
                project: null,
                repository: null,
                ref: null,
                commit: null,
                data: {unrelated: 'large'},
              },
            ],
          }),
        ],
      },
    ];
    const context = assembleListenerSnapshotContext({
      job: {key: 'await'},
      run,
      triggerPayload,
      plan,
      dependencyJobs,
    });

    const [matcher] = applyListenerFilterSnapshots(
      plan.on,
      context,
      listenerFilterOutputTypesForJobs(dependencyJobs),
    );

    expect(matcher?.filter_snapshot).toEqual({
      jobs: {
        build: {
          key: 'build',
          status: 'succeeded',
          executions: [{outputs: {pr_number: 42}}],
        },
      },
    });
    expect(matcher?.filter_output_types).toEqual({build: {pr_number: 'int'}});
  });

  it('retains map values when a comprehension iterates over outputs', () => {
    const plan = planListenerFilterSnapshots({
      on: [
        {
          source: 'github',
          event: 'pull_request',
          filter: 'jobs.build.outputs.all(output, output == "ready")',
        },
      ],
      until: null,
    });
    const dependencyJobs = [
      {
        job: {
          key: 'build',
          status: 'succeeded' as const,
          outputs: {status: 'ready', createdAt: '2026-06-30T12:00:00.000Z'},
        },
        outputTypes: {status: 'string' as const, createdAt: 'timestamp' as const},
        executions: [],
      },
    ];
    const context = assembleListenerSnapshotContext({
      job: {key: 'await'},
      run,
      triggerPayload,
      plan,
      dependencyJobs,
    });

    const [matcher] = applyListenerFilterSnapshots(
      plan.on,
      context,
      listenerFilterOutputTypesForJobs(dependencyJobs),
    );

    expect(matcher?.filter_snapshot).toEqual({
      jobs: {
        build: {
          key: 'build',
          status: 'succeeded',
          outputs: {status: 'ready', createdAt: '2026-06-30T12:00:00.000Z'},
        },
      },
    });
    expect(matcher?.filter_output_types).toEqual({
      build: {status: 'string', createdAt: 'timestamp'},
    });
  });

  it('retains available sibling paths when another referenced field is absent', () => {
    const plan = planListenerFilterSnapshots({
      on: [
        {
          source: 'github',
          event: 'pull_request',
          filter: 'jobs.build.outputs.pr_number == 42 || jobs.build.outputs.fork_number == 42',
        },
      ],
      until: null,
    });
    const context = assembleListenerSnapshotContext({
      job: {key: 'await'},
      run,
      triggerPayload,
      plan,
      dependencyJobs: [
        {
          job: {key: 'build', status: 'succeeded', outputs: {pr_number: 42}},
          executions: [],
        },
      ],
    });

    const [matcher] = applyListenerFilterSnapshots(plan.on, context);

    expect(matcher?.filter_snapshot).toEqual({
      jobs: {
        build: {
          key: 'build',
          status: 'succeeded',
          outputs: {pr_number: 42},
        },
      },
    });
  });

  it('merges projections for multiple fields in one indexed execution', () => {
    const plan = planListenerFilterSnapshots({
      on: [
        {
          source: 'github',
          event: 'pull_request',
          filter:
            'jobs.build.executions[0].outputs.pr_number == 42 && jobs.build.executions[0].name == "Build #1"',
        },
      ],
      until: null,
    });
    const context = assembleListenerSnapshotContext({
      job: {key: 'await'},
      run,
      triggerPayload,
      plan,
      dependencyJobs: [
        {
          job: {key: 'build', status: 'succeeded', outputs: {}},
          executions: [
            jobExecution({
              name: 'Build #1',
              outputs: {pr_number: 42, unrelated: 'large'},
            }),
          ],
        },
      ],
    });

    const [matcher] = applyListenerFilterSnapshots(plan.on, context);

    expect(matcher?.filter_snapshot).toEqual({
      jobs: {
        build: {
          key: 'build',
          status: 'succeeded',
          executions: [{name: 'Build #1', outputs: {pr_number: 42}}],
        },
      },
    });
  });

  it('preserves higher indexed executions when a later projection is shorter', () => {
    const plan = planListenerFilterSnapshots({
      on: [
        {
          source: 'github',
          event: 'pull_request',
          filter:
            'jobs.build.executions[1].outputs.pr_number == 43 && jobs.build.executions[0].name == "Build #0"',
        },
      ],
      until: null,
    });
    const context = assembleListenerSnapshotContext({
      job: {key: 'await'},
      run,
      triggerPayload,
      plan,
      dependencyJobs: [
        {
          job: {key: 'build', status: 'succeeded', outputs: {}},
          executions: [
            jobExecution({name: 'Build #0', outputs: {unrelated: 'large'}}),
            jobExecution({name: 'Build #1', outputs: {pr_number: 43, unrelated: 'large'}}),
          ],
        },
      ],
    });

    const [matcher] = applyListenerFilterSnapshots(plan.on, context);

    expect(matcher?.filter_snapshot).toEqual({
      jobs: {
        build: {
          key: 'build',
          status: 'succeeded',
          executions: [{name: 'Build #0'}, {outputs: {pr_number: 43}}],
        },
      },
    });
  });

  it('propagates paths through chained comprehensions', () => {
    const plan = planListenerFilterSnapshots({
      on: [
        {
          source: 'github',
          event: 'pull_request',
          filter:
            'jobs.build.executions.filter(e, e.status == "failed").exists(x, x.outputs.pr_number == 42)',
        },
      ],
      until: null,
    });
    const context = assembleListenerSnapshotContext({
      job: {key: 'await'},
      run,
      triggerPayload,
      plan,
      dependencyJobs: [
        {
          job: {key: 'build', status: 'succeeded', outputs: {}},
          executions: [
            jobExecution({
              status: 'failed',
              outputs: {pr_number: 42, unrelated: 'large'},
            }),
          ],
        },
      ],
    });

    const [matcher] = applyListenerFilterSnapshots(plan.on, context);

    expect(matcher?.filter_snapshot).toEqual({
      jobs: {
        build: {
          key: 'build',
          status: 'succeeded',
          executions: [{status: 'failed', outputs: {pr_number: 42}}],
        },
      },
    });
  });

  it('plans each matcher independently when matchers reference different job paths', () => {
    const plan = planListenerFilterSnapshots({
      on: [
        {
          source: 'github',
          event: 'pull_request',
          filter: 'jobs.build.outputs.pr_number == 42',
        },
        {
          source: 'github',
          event: 'pull_request',
          filter: 'jobs.review.outputs.pr_number == 99',
        },
      ],
      until: null,
    });
    const context = assembleListenerSnapshotContext({
      job: {key: 'await'},
      run,
      triggerPayload,
      plan,
      dependencyJobs: [
        {
          job: {
            key: 'build',
            status: 'succeeded',
            outputs: {pr_number: 42, unrelated: 'build-only'},
          },
          executions: [],
        },
        {
          job: {
            key: 'review',
            status: 'succeeded',
            outputs: {pr_number: 99, unrelated: 'review-only'},
          },
          executions: [],
        },
      ],
    });

    const matchers = applyListenerFilterSnapshots(plan.on, context);

    expect(matchers[0]?.filter_snapshot).toEqual({
      jobs: {
        build: {
          key: 'build',
          status: 'succeeded',
          outputs: {pr_number: 42},
        },
      },
    });
    expect(matchers[1]?.filter_snapshot).toEqual({
      jobs: {
        review: {
          key: 'review',
          status: 'succeeded',
          outputs: {pr_number: 99},
        },
      },
    });
  });

  it('snapshots vars for listener filters', () => {
    const plan = planListenerFilterSnapshots({
      on: [
        {
          source: 'github',
          event: 'pull_request',
          filter: 'vars.ENABLED == "true"',
        },
      ],
      until: null,
    });
    const context = assembleListenerSnapshotContext({
      job: {key: 'await'},
      run,
      triggerPayload,
      vars: {ENABLED: 'true'},
      plan,
      dependencyJobs: [],
    });

    const [matcher] = applyListenerFilterSnapshots(plan.on, context);

    expect(matcher?.filter_snapshot).toEqual({vars: {ENABLED: 'true'}});
  });

  it('persists output types beside JSON-safe listener snapshots', () => {
    const plan = planListenerFilterSnapshots({
      on: [
        {
          source: 'github',
          event: 'pull_request',
          filter: 'jobs.build.outputs.details.count + 1 == 43',
        },
      ],
      until: null,
    });
    const dependencyJobs = [
      {
        job: {
          key: 'build',
          status: 'succeeded' as const,
          outputs: {details: {count: 42}, unrelated: 'large'},
        },
        outputTypes: {
          details: {kind: 'object' as const, fields: {count: 'int' as const}},
          unrelated: 'string' as const,
        },
        executions: [],
      },
    ];
    const context = assembleListenerSnapshotContext({
      job: {key: 'await'},
      run,
      triggerPayload,
      plan,
      dependencyJobs,
    });

    const [matcher] = applyListenerFilterSnapshots(
      plan.on,
      context,
      listenerFilterOutputTypesForJobs(dependencyJobs),
    );

    expect(matcher).toEqual({
      source: 'github',
      event: 'pull_request',
      filter: 'jobs.build.outputs.details.count + 1 == 43',
      filter_snapshot: {
        jobs: {
          build: expect.objectContaining({outputs: {details: {count: 42}}}),
        },
      },
      filter_output_types: {
        build: {details: {kind: 'object', fields: {count: 'int'}}},
      },
    });
  });

  it('merges output types for multiple fields in one nested output', () => {
    const plan = planListenerFilterSnapshots({
      on: [
        {
          source: 'github',
          event: 'pull_request',
          filter:
            'jobs.build.outputs.details.count == 42 && jobs.build.outputs.details.createdAt == timestamp("2026-06-30T12:00:00.000Z")',
        },
      ],
      until: null,
    });
    const dependencyJobs = [
      {
        job: {
          key: 'build',
          status: 'succeeded' as const,
          outputs: {
            details: {count: 42, createdAt: '2026-06-30T12:00:00.000Z'},
          },
        },
        outputTypes: {
          details: {
            kind: 'object' as const,
            fields: {count: 'int' as const, createdAt: 'timestamp' as const},
          },
        },
        executions: [],
      },
    ];
    const context = assembleListenerSnapshotContext({
      job: {key: 'await'},
      run,
      triggerPayload,
      plan,
      dependencyJobs,
    });

    const [matcher] = applyListenerFilterSnapshots(
      plan.on,
      context,
      listenerFilterOutputTypesForJobs(dependencyJobs),
    );

    expect(matcher?.filter_output_types).toEqual({
      build: {
        details: {
          kind: 'object',
          fields: {count: 'int', createdAt: 'timestamp'},
        },
      },
    });
  });

  it('omits dynamic listener output metadata for rolling-deploy compatibility', () => {
    const result = listenerFilterOutputTypesForJobs([
      {
        job: {key: 'build', status: 'succeeded', outputs: {}},
        outputTypes: {
          count: 'int',
          payload: {kind: 'dyn'},
          nested: {
            kind: 'object',
            fields: {value: {kind: 'dyn'}, createdAt: 'timestamp'},
          },
          items: {kind: 'list', element: {kind: 'dyn'}},
          nestedItems: {
            kind: 'list',
            element: {
              kind: 'object',
              fields: {value: {kind: 'dyn'}, count: 'int'},
            },
          },
        },
        executions: [],
      },
    ]);

    expect(result).toEqual({
      build: {
        count: 'int',
        nested: {kind: 'object', fields: {createdAt: 'timestamp'}},
        nestedItems: {kind: 'list', element: {kind: 'object', fields: {count: 'int'}}},
      },
    });
  });

  it('omits snapshots for event-only filters and malformed filters', () => {
    const plan = planListenerFilterSnapshots({
      on: [
        {source: 'github', event: 'pull_request', filter: 'event.action == "closed"'},
        {source: 'github', event: 'pull_request', filter: 'event.'},
      ],
      until: null,
    });
    const context = assembleListenerSnapshotContext({
      job: {key: 'await'},
      run,
      triggerPayload,
      plan,
      dependencyJobs: [],
    });

    const matchers = applyListenerFilterSnapshots(plan.on, context);

    expect(matchers).toEqual([
      {source: 'github', event: 'pull_request', filter: 'event.action == "closed"'},
      {source: 'github', event: 'pull_request', filter: 'event.'},
    ]);
  });

  it('snapshots an empty jobs root when no referenced dependency is available', () => {
    const plan = planListenerFilterSnapshots({
      on: [
        {
          source: 'github',
          event: 'pull_request',
          filter: 'jobs.missing.outputs.pr_number == event.pull_request.number',
        },
      ],
      until: null,
    });
    const context = assembleListenerSnapshotContext({
      job: {key: 'await'},
      run,
      triggerPayload,
      plan,
      dependencyJobs: [
        {
          job: {key: 'build', status: 'succeeded', outputs: {pr_number: 42}},
          executions: [jobExecution({id: 'exec-build', jobId: 'job-build'})],
        },
      ],
    });

    const [matcher] = applyListenerFilterSnapshots(plan.on, context);

    expect(matcher).toEqual({
      source: 'github',
      event: 'pull_request',
      filter: 'jobs.missing.outputs.pr_number == event.pull_request.number',
      filter_snapshot: {jobs: {}},
    });
  });

  it('snapshots all dependency jobs for dynamic jobs access', () => {
    const plan = planListenerFilterSnapshots({
      on: [
        {
          source: 'github',
          event: 'pull_request',
          filter: 'jobs[inputs.target].outputs.pr_number == event.pull_request.number',
        },
      ],
      until: null,
    });
    const context = assembleListenerSnapshotContext({
      job: {key: 'await'},
      run,
      triggerPayload,
      inputs: {target: 'build'},
      plan,
      dependencyJobs: [
        {
          job: {key: 'build', status: 'succeeded', outputs: {pr_number: 42}},
          executions: [jobExecution({id: 'exec-build', jobId: 'job-build'})],
        },
        {
          job: {key: 'review', status: 'skipped', outputs: null},
          executions: [],
        },
      ],
    });

    const [matcher] = applyListenerFilterSnapshots(plan.on, context);

    expect(matcher?.filter_snapshot).toEqual({
      inputs: {target: 'build'},
      jobs: {
        build: expect.objectContaining({
          key: 'build',
          status: 'succeeded',
          outputs: {pr_number: 42},
        }),
        review: expect.objectContaining({
          key: 'review',
          status: 'skipped',
          outputs: {},
        }),
      },
    });
  });

  it('projects only the indexed execution needed by a direct access', () => {
    const plan = planListenerFilterSnapshots({
      on: [
        {
          source: 'github',
          event: 'pull_request',
          filter: 'jobs.build.executions[0].status == "succeeded"',
        },
      ],
      until: null,
    });
    const context = assembleListenerSnapshotContext({
      job: {key: 'await'},
      run,
      triggerPayload,
      plan,
      dependencyJobs: [
        {
          job: {key: 'build', status: 'succeeded', outputs: {unrelated: 'large'}},
          executions: [
            jobExecution({status: 'succeeded', outputs: {needed: true}}),
            jobExecution({sequence: 3, status: 'failed', outputs: {unrelated: 'large'}}),
          ],
        },
      ],
    });

    const [matcher] = applyListenerFilterSnapshots(plan.on, context);

    expect(matcher?.filter_snapshot).toEqual({
      jobs: {
        build: {
          key: 'build',
          status: 'succeeded',
          executions: [{status: 'succeeded'}],
        },
      },
    });
  });

  it('keeps snapshots JSON-serializable so they survive the outbox payload', () => {
    const plan = planListenerFilterSnapshots({
      on: [
        {
          source: 'github',
          event: 'pull_request',
          filter: 'jobs.build.executions[0].index == 0 && run.number == 7',
        },
      ],
      until: null,
    });
    const context = assembleListenerSnapshotContext({
      job: {key: 'await'},
      run,
      triggerPayload,
      plan,
      dependencyJobs: [
        {
          job: {key: 'build', status: 'succeeded', outputs: {}},
          executions: [jobExecution({id: 'exec-build', jobId: 'job-build'})],
        },
      ],
    });

    const [matcher] = applyListenerFilterSnapshots(plan.on, context);
    const jobs = matcher?.filter_snapshot?.jobs as Record<string, {executions: {index: unknown}[]}>;
    const snapshotRun = matcher?.filter_snapshot?.run as {number: unknown; attempt: unknown};

    expect(typeof jobs.build?.executions[0]?.index).toBe('number');
    expect(snapshotRun.number).toBe(7);
    expect(snapshotRun.attempt).toBe(2);
    expect(() => JSON.stringify(matcher?.filter_snapshot)).not.toThrow();
  });
});

describe('assembleStepDispatchContext', () => {
  it('wraps coherent step entities, the step self-root, and the current execution', () => {
    const targetStep = step({id: 'step-2', key: 'test', currentAttempt: 2});
    const steps = [
      step({id: 'step-1', key: 'build', status: 'succeeded'}),
      targetStep,
      step({id: 'step-3', key: null}),
      step({id: 'step-4', key: 'running', status: 'running'}),
    ];
    const attempts = [
      attempt({
        id: 'attempt-1',
        stepId: 'step-1',
        output: {image: 'app:123'},
        gateResult: {passed: true, source: 'step.exit_code == 0', exit_code: 0},
      }),
      attempt({stepId: 'step-4', status: 'running', output: {ignored: true}}),
    ];
    const execution = jobExecution();

    const context = assembleStepDispatchContext({
      steps,
      attempts,
      targetStepId: targetStep.id,
      jobExecution: execution,
    });

    expect(Object.keys(context.values).sort()).toEqual(
      [...getWorkflowPredicateContextRoots('step.if')].sort(),
    );
    expect(context).toEqual({
      site: 'step-dispatch',
      values: {
        execution: {
          index: 1n,
          name: 'Deploy',
          status: 'running',
          failed: false,
          started_at: date,
          finished_at: null,
          events: [
            {
              source: 'github',
              event: 'push',
              delivery_id: 'delivery-1',
              received_at: date,
              project: null,
              repository: null,
              ref: null,
              commit: null,
              data: {ref: 'refs/heads/main'},
            },
          ],
          outputs: {},
        },
        jobs: {},
        step: {
          attempt: 2n,
          is_retry: true,
        },
        steps: {
          build: {
            status: 'succeeded',
            exit_code: 0n,
            outputs: {image: 'app:123'},
            gate: {passed: true, source: 'step.exit_code == 0', exit_code: 0},
            attempts: [
              {
                status: 'succeeded',
                exit_code: 0n,
                outputs: {image: 'app:123'},
                gate: {passed: true, source: 'step.exit_code == 0', exit_code: 0},
              },
            ],
          },
          test: {status: 'pending', attempts: []},
          running: {status: 'running', attempts: []},
        },
        vars: {},
      },
    });
  });

  it('uses the latest terminal attempt by execution order and keeps history ordered', () => {
    const targetStep = step({id: 'step-2', key: 'deploy'});
    const steps = [step({id: 'step-1', key: 'build', status: 'succeeded'}), targetStep];
    const attempts = [
      attempt({
        id: 'attempt-2',
        stepId: 'step-1',
        attempt: 2,
        executionOrder: 3,
        output: {image: 'app:good'},
      }),
      attempt({
        id: 'attempt-1',
        stepId: 'step-1',
        attempt: 1,
        executionOrder: 1,
        status: 'failed',
        output: {image: 'app:bad'},
        exitCode: 1,
      }),
      attempt({
        id: 'attempt-3',
        stepId: 'step-1',
        attempt: 3,
        executionOrder: 4,
        status: 'running',
        output: {image: 'app:ignored'},
      }),
    ];

    const context = assembleStepDispatchContext({
      steps,
      attempts,
      targetStepId: targetStep.id,
    });

    expect(context.values.steps).toEqual({
      build: {
        status: 'succeeded',
        exit_code: 0n,
        outputs: {image: 'app:good'},
        attempts: [
          {status: 'failed', exit_code: 1n, outputs: {image: 'app:bad'}},
          {status: 'succeeded', exit_code: 0n, outputs: {image: 'app:good'}},
        ],
      },
      deploy: {status: 'pending', attempts: []},
    });
  });

  it('includes the target step prior attempts but excludes the in-flight attempt', () => {
    const targetStep = step({
      id: 'step-1',
      key: 'build',
      status: 'running',
      currentAttempt: 3,
    });
    const attempts = [
      attempt({id: 'attempt-1', attempt: 1, executionOrder: 1, output: {sha: 'old'}}),
      attempt({
        id: 'attempt-2',
        attempt: 2,
        executionOrder: 2,
        status: 'failed',
        output: {sha: 'failed'},
        exitCode: 1,
      }),
      attempt({
        id: 'attempt-3',
        attempt: 3,
        executionOrder: 3,
        status: 'running',
        output: {sha: 'in-flight'},
      }),
    ];

    const context = assembleStepDispatchContext({
      steps: [targetStep],
      attempts,
      targetStepId: targetStep.id,
    });

    expect(context.values.step).toEqual({attempt: 3n, is_retry: true});
    expect(context.values.steps).toEqual({
      build: {
        status: 'running',
        exit_code: 1n,
        outputs: {sha: 'failed'},
        attempts: [
          {status: 'succeeded', exit_code: 0n, outputs: {sha: 'old'}},
          {status: 'failed', exit_code: 1n, outputs: {sha: 'failed'}},
        ],
      },
    });
  });

  it('assembles restart provenance from the latest restart covering the target step', () => {
    const targetStep = step({
      id: 'step-1',
      key: 'producer',
      status: 'pending',
      currentAttempt: 2,
      position: 1,
    });
    const reviewer = step({
      id: 'step-2',
      key: 'reviewer',
      status: 'pending',
      currentAttempt: 2,
      position: 2,
    });
    const attempts = [
      attempt({
        id: 'attempt-1',
        stepId: 'step-1',
        attempt: 1,
        executionOrder: 1,
        output: {patch: 'old'},
      }),
      attempt({
        id: 'attempt-2',
        stepId: 'step-2',
        attempt: 1,
        executionOrder: 2,
        status: 'failed',
        output: {summary: 'tests failed'},
        exitCode: 1,
        gateResult: {passed: false, source: 'step.exit_code == 0', exit_code: 1},
        config: {gate: {on_failure: {restart_from: 'producer'}}},
        restartFeedback: 'failed: tests failed',
      }),
    ];

    const context = assembleStepDispatchContext({
      steps: [targetStep, reviewer],
      attempts,
      targetStepId: targetStep.id,
    });

    expect(context.values.step).toEqual({
      attempt: 2n,
      is_retry: true,
      restart: {
        from: {
          status: 'failed',
          exit_code: 1n,
          outputs: {summary: 'tests failed'},
          gate: {passed: false, source: 'step.exit_code == 0', exit_code: 1},
          attempts: [
            {
              status: 'failed',
              exit_code: 1n,
              outputs: {summary: 'tests failed'},
              gate: {passed: false, source: 'step.exit_code == 0', exit_code: 1},
            },
          ],
        },
        feedback: 'failed: tests failed',
      },
    });
  });

  it('omits response for run steps so response resolves as a missing path', () => {
    const targetStep = step({id: 'step-2', key: 'deploy'});
    const steps = [step({id: 'step-1', key: 'build', status: 'succeeded'}), targetStep];

    const context = assembleStepDispatchContext({
      steps,
      attempts: [attempt({stepId: 'step-1'})],
      targetStepId: targetStep.id,
    });

    const stepsContext = context.values.steps as Record<string, Record<string, unknown>>;
    const build = stepsContext.build as Record<string, unknown>;
    const buildAttempt = (build.attempts as Record<string, unknown>[])[0];
    expect(build).not.toHaveProperty('response');
    expect(buildAttempt).not.toHaveProperty('response');
  });

  it('exposes agent response on the latest attempt and attempt history', () => {
    const targetStep = step({id: 'step-2', key: 'deploy'});
    const steps = [step({id: 'step-1', key: 'review', status: 'succeeded'}), targetStep];

    const context = assembleStepDispatchContext({
      steps,
      attempts: [attempt({stepId: 'step-1', response: 'Looks good.'})],
      targetStepId: targetStep.id,
    });

    const stepsContext = context.values.steps as Record<string, Record<string, unknown>>;
    const review = stepsContext.review as Record<string, unknown>;
    const reviewAttempt = (review.attempts as Record<string, unknown>[])[0];
    expect(review.response).toBe('Looks good.');
    expect(reviewAttempt?.response).toBe('Looks good.');
  });

  it('exposes projection status when a step has no terminal attempt', () => {
    const skipped = step({
      id: 'step-1',
      key: 'conditional',
      status: 'skipped' as Step['status'],
    });

    const context = assembleStepDispatchContext({
      steps: [skipped],
      attempts: [],
      targetStepId: skipped.id,
    });

    const stepsContext = context.values.steps as Record<string, Record<string, unknown>>;
    expect(stepsContext).toEqual({
      conditional: {
        status: 'skipped',
        attempts: [],
      },
    });
    expect(stepsContext.conditional).not.toHaveProperty('outputs');
    expect(stepsContext.conditional).not.toHaveProperty('exit_code');
    expect(stepsContext.conditional).not.toHaveProperty('gate');
  });

  it('sets execution.failed when an earlier step failed', () => {
    const targetStep = step({id: 'step-2', key: 'cleanup'});

    const context = assembleStepDispatchContext({
      steps: [step({id: 'step-1', key: 'build', status: 'failed'}), targetStep],
      attempts: [attempt({stepId: 'step-1', status: 'failed', exitCode: 1})],
      targetStepId: targetStep.id,
      jobExecution: jobExecution(),
    });

    expect(context.values.execution).toMatchObject({failed: true});
  });
});

describe('assembleGateContext', () => {
  it('wraps the reported step result with the step-report site', () => {
    const context = assembleGateContext({status: 'failed', exitCode: 1});

    expect(Object.keys(context.values).sort()).toEqual(
      [...getWorkflowPredicateContextRoots('step.success')].sort(),
    );
    expect(context).toEqual({
      site: 'step-report',
      values: {
        vars: {},
        step: {
          exit_code: 1n,
          status: 'failed',
          outputs: {},
        },
      },
    });
  });

  it('includes reported step output', () => {
    const context = assembleGateContext({
      status: 'succeeded',
      exitCode: 0,
      output: {pass: true},
    });

    expect(context.values.step).toEqual({
      exit_code: 0n,
      status: 'succeeded',
      outputs: {pass: true},
    });
  });
});

describe('assembleJobResolutionContext', () => {
  it('wraps executions with the job-resolution site', () => {
    const executions = [
      jobExecution({sequence: 0, name: 'First', status: 'failed', finishedAt: date}),
      jobExecution({sequence: 1, name: 'Second', status: 'succeeded', finishedAt: date}),
    ];

    const context = assembleJobResolutionContext({executions, jobs: []});

    expect(Object.keys(context.values).sort()).toEqual(
      [...getWorkflowPredicateContextRoots('job.success')].sort(),
    );
    expect(context).toEqual({
      site: 'job-resolution',
      values: {
        jobs: {},
        vars: {},
        executions: [
          {
            index: 0n,
            name: 'First',
            status: 'failed',
            started_at: date,
            finished_at: date,
            events: [
              {
                source: 'github',
                event: 'push',
                delivery_id: 'delivery-1',
                received_at: date,
                project: null,
                repository: null,
                ref: null,
                commit: null,
                data: {ref: 'refs/heads/main'},
              },
            ],
            outputs: {},
          },
          {
            index: 1n,
            name: 'Second',
            status: 'succeeded',
            started_at: date,
            finished_at: date,
            events: [
              {
                source: 'github',
                event: 'push',
                delivery_id: 'delivery-1',
                received_at: date,
                project: null,
                repository: null,
                ref: null,
                commit: null,
                data: {ref: 'refs/heads/main'},
              },
            ],
            outputs: {},
          },
        ],
      },
    });
  });
});

describe('assembleExecutionResolutionContext', () => {
  const run = {
    id: 'run-1',
    number: 1,
    currentAttempt: 1,
    name: 'Build',
    workflowName: 'Build',
    definitionId: 'def-1',
    projectId: 'proj-1',
    workspaceId: 'workspace-1',
    createdAt: new Date('2026-06-30T12:00:00.000Z'),
  };

  it('uses the target execution for the execution self-root', () => {
    const priorExecution = jobExecution({
      id: 'exec-1',
      sequence: 1,
      name: 'Build #1',
      outputs: {sha: 'old'},
    });
    const targetExecution = jobExecution({
      id: 'exec-2',
      sequence: 2,
      name: 'Build #2',
      outputs: {sha: 'target'},
    });

    const context = assembleExecutionResolutionContext({
      run,
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: 'sub-1',
        userId: 'user-1',
      },
      job: {key: 'build'},
      jobExecution: targetExecution,
      executions: [targetExecution, priorExecution],
      steps: [],
      attempts: [],
    });

    expect(context.values.execution).toEqual({
      index: 0n,
      name: 'Build #2',
      status: 'running',
      started_at: date,
      finished_at: null,
      events: targetExecution.triggerEvents.map((event) => ({...event, received_at: date})),
      outputs: {sha: 'target'},
    });
  });

  it('exposes execution indices and event timestamps as CEL-native values', () => {
    const targetExecution = jobExecution({
      id: 'exec-2',
      sequence: 2,
      outputs: {sha: 'target'},
    });

    const context = assembleExecutionResolutionContext({
      run,
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: 'sub-1',
        userId: 'user-1',
      },
      job: {key: 'build'},
      jobExecution: targetExecution,
      executions: [targetExecution],
      steps: [],
      attempts: [],
    });

    const expressions = [
      'executions[0].index + 1 == 1',
      'execution.index + 1 == 1',
      'run.number + 1 == 2',
      'executions[0].events[0].received_at < timestamp("2026-07-01T00:00:00Z")',
    ];

    for (const source of expressions) {
      const expression = createWorkflowExpression({source, check: {mode: 'syntax'}});

      expect(evaluateWorkflowExpression(expression, context.values)).toBe(true);
    }
  });
});

function step(overrides: Partial<Step> = {}): Step {
  return {
    id: 'step-1',
    jobExecutionId: 'exec-1',
    key: 'build',
    name: 'Build',
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
    position: 0,
    version: 1,
    currentAttempt: 1,
    createdAt: date,
    updatedAt: date,
    ...overrides,
  };
}

function attempt(overrides: Partial<StepAttempt> = {}): StepAttempt {
  return {
    id: 'attempt-1',
    stepId: 'step-1',
    attempt: 1,
    executionOrder: 1,
    status: 'succeeded',
    config: null,
    evaluationTrace: null,
    output: null,
    response: null,
    error: null,
    exitCode: 0,
    gateResult: null,
    restartFeedback: null,
    logOutcome: null,
    invocations: [],
    startedAt: date,
    finishedAt: date,
    createdAt: date,
    ...overrides,
  };
}

function jobExecution(overrides: Partial<JobExecution> = {}): JobExecution {
  return {
    id: 'exec-1',
    jobId: 'job-1',
    sequence: 2,
    nameOverride: 'Deploy',
    name: 'Deploy',
    runner: null,
    status: 'running',
    statusReason: null,
    triggerEvents: [
      {
        source: 'github',
        event: 'push',
        delivery_id: 'delivery-1',
        received_at: '2026-06-30T12:00:00.000Z',
        project: null,
        repository: null,
        ref: null,
        commit: null,
        data: {ref: 'refs/heads/main'},
      },
    ],
    outputs: null,
    version: 1,
    createdAt: date,
    updatedAt: date,
    queuedAt: date,
    startedAt: date,
    finishedAt: null,
    timedOutAt: null,
    ...overrides,
  };
}
