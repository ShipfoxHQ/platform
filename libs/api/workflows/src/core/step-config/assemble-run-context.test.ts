import {getWorkflowPredicateContextRoots} from '@shipfox/expression';
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
  assembleListenerSnapshotContext,
  assembleStepDispatchContext,
  assembleWorkflowRunContext,
  planListenerFilterSnapshots,
} from './assemble-run-context.js';

const date = new Date('2026-06-30T12:00:00.000Z');

describe('assembleWorkflowRunContext', () => {
  const run = {
    id: 'run-1',
    number: 1,
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
        number: 1,
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
            index: 0,
            name: 'Build #1',
            status: 'failed',
            started_at: date,
            finished_at: date,
            events: prior.triggerEvents,
            outputs: {},
          },
          {
            index: 1,
            name: 'Build #2',
            status: 'pending',
            started_at: null,
            finished_at: null,
            events: [
              {
                source: 'github',
                event: 'deployment',
                delivery_id: 'delivery-2',
                received_at: '2026-06-30T12:01:00.000Z',
                data: {environment: 'prod'},
              },
            ],
            outputs: {},
          },
        ],
        job: {key: 'build', name: 'Build'},
        execution: {
          index: 1,
          name: 'Build #2',
          status: 'pending',
          started_at: null,
          finished_at: null,
          events: [
            {
              source: 'github',
              event: 'deployment',
              delivery_id: 'delivery-2',
              received_at: '2026-06-30T12:01:00.000Z',
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
                index: 0,
                name: 'Build #1',
                status: 'succeeded',
                started_at: date,
                finished_at: null,
                events: buildExecution.triggerEvents,
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
                index: 0,
                name: 'Build #1',
                status: 'succeeded',
                started_at: date,
                finished_at: null,
                events: buildExecution.triggerEvents,
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
    number: 1,
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
          executions: expect.any(Array),
        }),
      },
    });
    expect(Object.keys(matcher?.filter_snapshot ?? {}).sort()).toEqual(
      getWorkflowPredicateContextRoots('listener.on')
        .filter((root) => root !== 'event')
        .sort(),
    );
    expect(matcher?.filter_snapshot).not.toHaveProperty('event');
    expect(matcher?.filter_snapshot?.jobs).not.toHaveProperty('review');
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
          index: 2,
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
              received_at: '2026-06-30T12:00:00.000Z',
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
            index: 0,
            name: 'First',
            status: 'failed',
            started_at: date,
            finished_at: date,
            events: [
              {
                source: 'github',
                event: 'push',
                delivery_id: 'delivery-1',
                received_at: '2026-06-30T12:00:00.000Z',
                data: {ref: 'refs/heads/main'},
              },
            ],
            outputs: {},
          },
          {
            index: 1,
            name: 'Second',
            status: 'succeeded',
            started_at: date,
            finished_at: date,
            events: [
              {
                source: 'github',
                event: 'push',
                delivery_id: 'delivery-1',
                received_at: '2026-06-30T12:00:00.000Z',
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
      index: 0,
      name: 'Build #2',
      status: 'running',
      started_at: date,
      finished_at: null,
      events: targetExecution.triggerEvents,
      outputs: {sha: 'target'},
    });
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
