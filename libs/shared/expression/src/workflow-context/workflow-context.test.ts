import {evaluateWorkflowPredicate} from '../evaluator/evaluate-workflow-expression.js';
import {createWorkflowExpression} from '../expression/create-workflow-expression.js';
import {InvalidWorkflowExpressionError} from '../expression/errors.js';
import {
  type AvailabilitySite,
  availabilitySites,
  buildTypedRootsEnvironment,
  contextRootsForField,
  type FillTarget,
  getWorkflowContextTypeEnvironment,
  getWorkflowInterpolationFieldFailurePolicy,
  getWorkflowInterpolationFieldMinimumFillTarget,
  getWorkflowPredicateContextRoots,
  getWorkflowPredicateFieldMinimumFillTarget,
  getWorkflowPredicateFieldTypeEnvironment,
  projectWorkflowPredicateContext,
  resolveContextRootAvailability,
  resolveContextRootHost,
  rootsAvailableAt,
  runnerFillTarget,
  toolStepReportTypeEnvironment,
  unavailableRootsAt,
  type WorkflowInterpolationField,
  workflowContextAvailabilityReference,
  workflowContextDefinitions,
  workflowContextHosts,
  workflowContextNames,
  workflowContextReservedRoots,
  workflowContextSensitivities,
  workflowFieldFailurePolicies,
  workflowInterpolationFieldAcceptsHost,
  workflowInterpolationFieldPolicies,
  workflowInterpolationFields,
  workflowPredicateContextRoots,
  workflowPredicateFieldFailurePolicy,
  workflowPredicateFields,
} from './workflow-context.js';

describe('workflow context registry', () => {
  it('defines exactly the v1 contexts', () => {
    expect(workflowContextNames).toEqual([
      'workflow',
      'run',
      'trigger',
      'event',
      'inputs',
      'job',
      'executions',
      'execution',
      'jobs',
      'needs',
      'steps',
      'step',
      'vars',
      'secrets',
    ]);
  });

  it('keeps future roots reserved out of the referenceable registry', () => {
    expect(workflowContextReservedRoots).toEqual({
      matrix: {host: 'server', availability: 'job-activation'},
      runner: {host: 'runner'},
      result: {host: 'server', availability: 'step-report'},
    });
    expect(workflowContextNames).toContain('jobs');
    expect(workflowContextNames).toContain('needs');
    expect(workflowContextNames).toContain('step');
    expect(workflowContextNames).toContain('steps');
    expect(workflowContextNames).not.toContain('matrix');
    expect(workflowContextNames).not.toContain('runner');
    expect(workflowContextNames).not.toContain('result');
  });

  it('marks known-shape contexts as typed and open contexts as syntax-only', () => {
    expect(workflowContextDefinitions.run).toMatchObject({
      shape: 'known',
      checkMode: 'typed',
    });
    expect(workflowContextDefinitions.trigger).toMatchObject({
      availability: 'ingest',
      shape: 'known',
      checkMode: 'typed',
    });
    expect(workflowContextDefinitions.job).toMatchObject({
      shape: 'known',
      checkMode: 'typed',
    });
    expect(workflowContextDefinitions.executions).toMatchObject({
      shape: 'known',
      checkMode: 'typed',
    });
    expect(workflowContextDefinitions.execution).toMatchObject({
      shape: 'known',
      checkMode: 'typed',
    });
    expect(workflowContextDefinitions.jobs).toMatchObject({
      availability: 'job-activation',
      shape: 'open',
      checkMode: 'syntax',
    });
    expect(workflowContextDefinitions.needs).toMatchObject({
      availability: 'job-activation',
      shape: 'known',
      checkMode: 'typed',
    });
    expect(workflowContextDefinitions.step).toMatchObject({
      availability: 'step-dispatch',
      shape: 'known',
      checkMode: 'typed',
    });
    expect(workflowContextDefinitions.steps).toMatchObject({
      availability: 'step-dispatch',
      shape: 'open',
      checkMode: 'syntax',
    });
    expect(workflowContextDefinitions.event).toMatchObject({
      availability: 'ingest',
      shape: 'open',
      checkMode: 'syntax',
    });
    expect(workflowContextDefinitions.inputs).toMatchObject({
      shape: 'open',
      checkMode: 'syntax',
    });
    expect(workflowContextDefinitions.vars).toMatchObject({
      availability: 'run-creation',
      sensitivity: 'persistable',
      host: 'server',
      shape: 'open',
      checkMode: 'syntax',
      literalKeyOnly: true,
    });
    expect(workflowContextDefinitions.secrets).toMatchObject({
      sensitivity: 'ephemeral',
      host: 'runner',
      shape: 'open',
      checkMode: 'syntax',
      literalKeyOnly: true,
    });
  });

  it('declares every implemented context with all registry dimensions', () => {
    for (const root of workflowContextNames) {
      expect(workflowContextDefinitions[root]).toMatchObject({
        sensitivity: expect.any(String),
        host: expect.any(String),
        shape: expect.any(String),
        checkMode: expect.any(String),
      });
      const availability = resolveContextRootAvailability(root);
      if (workflowContextDefinitions[root].host === 'server') {
        expect(availabilitySites).toContain(availability);
      } else {
        expect(availability).toBeUndefined();
      }
      expect(workflowContextSensitivities).toContain(workflowContextDefinitions[root].sensitivity);
      expect(workflowContextHosts).toContain(workflowContextDefinitions[root].host);
    }
  });

  it('exports type environments for the known v1 context fields', () => {
    expect(getWorkflowContextTypeEnvironment('workflow')).toEqual({
      workflow: {
        kind: 'object',
        fields: {
          id: 'string',
          name: 'string',
        },
      },
    });
    const runTypeEnvironment = getWorkflowContextTypeEnvironment('run');
    expect(runTypeEnvironment).toEqual({
      run: {
        kind: 'object',
        fields: {
          id: 'string',
          number: 'int',
          name: 'string',
          project_id: 'string',
          workspace_id: 'string',
          created_at: 'timestamp',
        },
      },
    });
    if (!runTypeEnvironment) throw new Error('Run type environment is not defined');
    expect(() =>
      createWorkflowExpression({
        source: 'run.number > 0',
        check: {mode: 'typed', typeEnvironment: runTypeEnvironment},
      }),
    ).not.toThrow();
    expect(getWorkflowContextTypeEnvironment('trigger')).toEqual({
      trigger: {
        kind: 'object',
        fields: {
          source: 'string',
          event: 'string',
          project: {
            kind: 'object',
            fields: {id: 'string'},
          },
          repository: 'string',
          ref: 'string',
          commit: 'string',
        },
      },
    });
    expect(() =>
      createWorkflowExpression({
        source: 'trigger.project != null && trigger.commit != null',
        check: {mode: 'typed', typeEnvironment: workflowContextDefinitions.trigger.typeEnvironment},
      }),
    ).not.toThrow();
    const expression = createWorkflowExpression({
      source: 'trigger.project != null && trigger.commit != null',
      check: {mode: 'syntax'},
    });
    expect(
      evaluateWorkflowPredicate(expression, {
        trigger: {project: {id: 'project-1'}, commit: 'a'.repeat(40)},
      }),
    ).toBe(true);
    expect(evaluateWorkflowPredicate(expression, {trigger: {project: null, commit: null}})).toBe(
      false,
    );
    expect(getWorkflowContextTypeEnvironment('job')).toEqual({
      job: {
        kind: 'object',
        fields: {
          key: 'string',
          name: 'string',
        },
      },
    });
    expect(getWorkflowContextTypeEnvironment('execution')).toMatchObject({
      execution: {
        fields: {
          failed: 'bool',
          outputs: {kind: 'map'},
        },
      },
    });
    expect(getWorkflowContextTypeEnvironment('executions')).toMatchObject({
      executions: {
        element: {
          fields: {
            outputs: {kind: 'map'},
          },
        },
      },
    });
    expect(getWorkflowContextTypeEnvironment('executions')).not.toHaveProperty(
      'executions.element.fields.failed',
    );
    expect(getWorkflowContextTypeEnvironment('needs')).toMatchObject({
      needs: {
        kind: 'list',
        element: {
          fields: {
            key: 'string',
            status: 'string',
            outputs: {kind: 'map'},
            executions: {kind: 'list'},
          },
        },
      },
    });
    expect(getWorkflowContextTypeEnvironment('step')).toMatchObject({
      step: {
        fields: {
          attempt: 'int',
          is_retry: 'bool',
          restart: {
            fields: {
              from: {
                fields: {
                  status: 'string',
                  exit_code: 'int',
                  outputs: {kind: 'map'},
                  response: 'string',
                  gate: {
                    fields: {
                      passed: 'bool',
                      source: 'string',
                      reason: 'string',
                      exit_code: 'int',
                    },
                  },
                  attempts: {
                    element: {
                      fields: {
                        status: 'string',
                        exit_code: 'int',
                        outputs: {kind: 'map'},
                        response: 'string',
                        gate: {
                          fields: {
                            passed: 'bool',
                            source: 'string',
                            reason: 'string',
                            exit_code: 'int',
                          },
                        },
                      },
                    },
                  },
                },
              },
              feedback: 'string',
            },
          },
          exit_code: 'int',
          status: 'string',
          outputs: {kind: 'map'},
        },
      },
    });
  });

  it('does not expose type environments for open contexts', () => {
    expect(getWorkflowContextTypeEnvironment('event')).toBeUndefined();
    expect(getWorkflowContextTypeEnvironment('inputs')).toBeUndefined();
    expect(getWorkflowContextTypeEnvironment('jobs')).toBeUndefined();
    expect(getWorkflowContextTypeEnvironment('steps')).toBeUndefined();
    expect(getWorkflowContextTypeEnvironment('vars')).toBeUndefined();
    expect(getWorkflowContextTypeEnvironment('secrets')).toBeUndefined();
  });

  it('builds a typed steps overlay with closed keys and declared outputs', () => {
    const typeEnvironment = buildTypedRootsEnvironment({
      steps: [{key: 'build', outputs: {count: {type: 'number'}}}, {key: 'lint'}],
    });

    expect(() =>
      createWorkflowExpression({
        source: 'steps.build.outputs.count > 5',
        check: {mode: 'typed', typeEnvironment},
      }),
    ).not.toThrow();
    expect(() =>
      createWorkflowExpression({
        source: 'steps.build.outputs.typo',
        check: {mode: 'typed', typeEnvironment},
      }),
    ).toThrow(InvalidWorkflowExpressionError);
    expect(() =>
      createWorkflowExpression({
        source: 'steps.missing.outputs.count',
        check: {mode: 'typed', typeEnvironment},
      }),
    ).toThrow(InvalidWorkflowExpressionError);
    expect(() =>
      createWorkflowExpression({
        source: 'steps.lint.outputs.anything',
        check: {mode: 'typed', typeEnvironment},
      }),
    ).not.toThrow();
  });

  it('types tool step entities from the catalog output schema and mapped outputs', () => {
    const typeEnvironment = buildTypedRootsEnvironment({
      steps: [
        {
          key: 'notify',
          kind: 'tool',
          outputs: {ts: {type: 'string'}},
          outputSchema: {
            type: 'object',
            properties: {
              ts: {type: 'string'},
              channel: {type: 'string'},
            },
            required: ['ts', 'channel'],
            additionalProperties: false,
          },
        },
      ],
    });

    expect(() =>
      createWorkflowExpression({
        source: 'steps.notify.outputs.ts == steps.notify.outputs.result.channel',
        check: {mode: 'typed', typeEnvironment},
      }),
    ).not.toThrow();
    expect(() =>
      createWorkflowExpression({
        source: 'steps.notify.outputs.result',
        check: {mode: 'typed', typeEnvironment},
      }),
    ).not.toThrow();
    expect(() =>
      createWorkflowExpression({
        source: 'steps.notify.outputs.result.typo',
        check: {mode: 'typed', typeEnvironment},
      }),
    ).toThrow(InvalidWorkflowExpressionError);
  });

  it('types a tool step result as an open map without a catalog output schema', () => {
    const typeEnvironment = buildTypedRootsEnvironment({
      steps: [{key: 'notify', kind: 'tool', outputs: {ts: {type: 'string'}}}],
    });

    expect(() =>
      createWorkflowExpression({
        source: 'steps.notify.outputs.result.anything',
        check: {mode: 'typed', typeEnvironment},
      }),
    ).not.toThrow();
    expect(() =>
      createWorkflowExpression({
        source: 'steps.notify.outputs.ts',
        check: {mode: 'typed', typeEnvironment},
      }),
    ).not.toThrow();
  });

  it('omits exit_code from tool step entities and self roots', () => {
    const stepsEnvironment = buildTypedRootsEnvironment({
      steps: [{key: 'notify', kind: 'tool'}],
    });
    const selfEnvironment = buildTypedRootsEnvironment({
      currentStep: {key: 'notify', kind: 'tool'},
    });

    for (const source of [
      'steps.notify.exit_code == 0',
      'step.exit_code == 0',
      'steps.notify.gate.exit_code == 0',
      'steps.notify.attempts[0].gate.exit_code == 0',
    ]) {
      for (const typeEnvironment of [stepsEnvironment, selfEnvironment]) {
        expect(() =>
          createWorkflowExpression({
            source,
            check: {mode: 'typed', typeEnvironment, expectedResultType: 'bool'},
          }),
        ).toThrow(InvalidWorkflowExpressionError);
      }
    }

    expect(() =>
      createWorkflowExpression({
        source: 'steps.notify.status == "succeeded"',
        check: {mode: 'typed', typeEnvironment: stepsEnvironment},
      }),
    ).not.toThrow();
    expect(() =>
      createWorkflowExpression({
        source: 'step.status == "succeeded"',
        check: {mode: 'typed', typeEnvironment: selfEnvironment},
      }),
    ).not.toThrow();
  });

  it('exposes a tool step gate context without exit_code', () => {
    expect(() =>
      createWorkflowExpression({
        source: 'step.status == "succeeded" && step.outputs != null',
        check: {
          mode: 'typed',
          typeEnvironment: toolStepReportTypeEnvironment,
          expectedResultType: 'bool',
        },
      }),
    ).not.toThrow();
    expect(() =>
      createWorkflowExpression({
        source: 'step.exit_code == 0',
        check: {
          mode: 'typed',
          typeEnvironment: toolStepReportTypeEnvironment,
          expectedResultType: 'bool',
        },
      }),
    ).toThrow(InvalidWorkflowExpressionError);
  });

  it('preserves exit_code through non-tool step overlays', () => {
    const stepsEnvironment = buildTypedRootsEnvironment({steps: [{key: 'build'}]});
    const selfEnvironment = buildTypedRootsEnvironment({currentStep: {key: 'build'}});

    for (const [source, typeEnvironment] of [
      ['steps.build.exit_code == 0', stepsEnvironment],
      ['step.exit_code == 0', selfEnvironment],
    ] as const) {
      expect(() =>
        createWorkflowExpression({
          source,
          check: {mode: 'typed', typeEnvironment, expectedResultType: 'bool'},
        }),
      ).not.toThrow();
    }
  });

  it('builds typed step self-root and upstream job output overlays', () => {
    const typeEnvironment = buildTypedRootsEnvironment({
      currentStep: {key: 'test', outputs: {ready: {type: 'boolean'}}},
      jobs: [{key: 'build', outputs: {count: 'double'}}],
    });

    expect(() =>
      createWorkflowExpression({
        source: 'step.outputs.ready && jobs.build.outputs.count > 5',
        check: {mode: 'typed', typeEnvironment, expectedResultType: 'bool'},
      }),
    ).not.toThrow();
  });

  it('builds typed needs overlays for dependency aggregation', () => {
    const typeEnvironment = buildTypedRootsEnvironment({
      needs: [{key: 'build'}, {key: 'test'}],
    });

    expect(() =>
      createWorkflowExpression({
        source: 'needs.exists(n, n.key == "build" && n.status == "failed")',
        check: {mode: 'typed', typeEnvironment, expectedResultType: 'bool'},
      }),
    ).not.toThrow();
  });

  it('returns the roots available at each availability site', () => {
    expect(rootsAvailableAt('ingest')).toEqual(['trigger', 'event']);
    expect(rootsAvailableAt('run-creation')).toEqual([
      'workflow',
      'run',
      'trigger',
      'event',
      'inputs',
      'job',
      'vars',
    ]);
    expect(rootsAvailableAt('execution-creation')).toEqual([
      'workflow',
      'run',
      'trigger',
      'event',
      'inputs',
      'job',
      'executions',
      'execution',
      'vars',
    ]);
    expect(rootsAvailableAt('job-activation')).toEqual([
      'workflow',
      'run',
      'trigger',
      'event',
      'inputs',
      'job',
      'executions',
      'execution',
      'jobs',
      'needs',
      'vars',
    ]);
    expect(rootsAvailableAt('step-dispatch')).toEqual([
      'workflow',
      'run',
      'trigger',
      'event',
      'inputs',
      'job',
      'executions',
      'execution',
      'jobs',
      'needs',
      'steps',
      'step',
      'vars',
    ]);
    expect(rootsAvailableAt('step-report')).toEqual([
      'workflow',
      'run',
      'trigger',
      'event',
      'inputs',
      'job',
      'executions',
      'execution',
      'jobs',
      'needs',
      'steps',
      'step',
      'vars',
    ]);
    expect(rootsAvailableAt('execution-resolution')).toEqual([
      'workflow',
      'run',
      'trigger',
      'event',
      'inputs',
      'job',
      'executions',
      'execution',
      'jobs',
      'needs',
      'steps',
      'step',
      'vars',
    ]);
    expect(rootsAvailableAt('job-resolution')).toEqual([
      'workflow',
      'run',
      'trigger',
      'event',
      'inputs',
      'job',
      'executions',
      'execution',
      'jobs',
      'needs',
      'steps',
      'step',
      'vars',
    ]);
  });

  it('returns unavailable known roots at an availability site', () => {
    expect(unavailableRootsAt(['run', 'execution', 'executions', 'step'], 'run-creation')).toEqual([
      'execution',
      'executions',
      'step',
    ]);
    expect(
      unavailableRootsAt(['run', 'execution', 'executions', 'step'], 'execution-creation'),
    ).toEqual(['step']);
    expect(unavailableRootsAt(['run', 'execution', 'executions', 'step'], 'step-report')).toEqual(
      [],
    );
  });

  it.each(
    availabilitySites,
  )('returns no unavailable roots when all roots are available at %s', (site) => {
    const roots = rootsAvailableAt(site);

    const unavailableRoots = unavailableRootsAt(roots, site);

    expect(unavailableRoots).toEqual([]);
  });

  it.each(
    availabilitySites.filter(
      (site) => availabilitySites.indexOf(site) < availabilitySites.indexOf('step-dispatch'),
    ),
  )('reports step as unavailable before step-dispatch at %s', (site) => {
    const unavailableRoots = unavailableRootsAt(['step'], site);

    expect(unavailableRoots).toEqual(['step']);
  });

  it('never returns runner-host roots at a server availability site', () => {
    for (const site of availabilitySites) {
      const availableRoots = rootsAvailableAt(site);
      for (const root of availableRoots) {
        expect(workflowContextDefinitions[root].host).toBe('server');
      }
      expect(availableRoots).not.toContain('runner');
      expect(availableRoots).not.toContain('secrets');
    }
  });

  it('keeps workflow context availability monotonic across sites', () => {
    const siteIndexes = new Map<AvailabilitySite, number>(
      availabilitySites.map((site, index) => [site, index]),
    );

    const sitePairs: readonly [AvailabilitySite, AvailabilitySite][] = [
      ['ingest', 'run-creation'],
      ['run-creation', 'execution-creation'],
      ['execution-creation', 'job-activation'],
      ['job-activation', 'step-dispatch'],
      ['step-dispatch', 'step-report'],
      ['step-report', 'execution-resolution'],
      ['execution-resolution', 'job-resolution'],
    ];

    for (const [previousSite, currentSite] of sitePairs) {
      const previous = new Set(rootsAvailableAt(previousSite));
      const current = new Set(rootsAvailableAt(currentSite));

      for (const root of previous) {
        expect(current.has(root)).toBe(true);
      }
    }

    for (const root of workflowContextNames) {
      const availability = resolveContextRootAvailability(root);
      if (availability === undefined) continue;

      const available = rootsAvailableAt(availability);
      expect(available).toContain(root);
      expect(siteIndexes.get(availability)).toBeDefined();
    }
  });

  it('keeps runner fill as a non-site fill target', () => {
    const target: FillTarget = runnerFillTarget;

    expect(target).toBe('runner-fill');
    expect(availabilitySites).not.toContain(target as AvailabilitySite);
  });

  it('generates an availability reference from the registry and reserved roots', () => {
    const expected = [
      ...workflowContextNames.map((root) => {
        const availability = resolveContextRootAvailability(root);
        return availability === undefined
          ? {
              root,
              reserved: false,
              availableAt: noServerAvailabilityReference(),
            }
          : {
              root,
              availability,
              reserved: false,
              availableAt: availableAtReference(availability),
            };
      }),
      ...Object.entries(workflowContextReservedRoots).map(([root, definition]) =>
        definition.host === 'runner'
          ? {
              root,
              reserved: true,
              availableAt: noServerAvailabilityReference(),
            }
          : {
              root,
              availability: definition.availability,
              reserved: true,
              availableAt: availableAtReference(definition.availability),
            },
      ),
    ];

    expect(workflowContextAvailabilityReference()).toEqual(expected);
  });

  it('resolves root host and availability across implemented and reserved roots', () => {
    expect(resolveContextRootHost('run')).toBe('server');
    expect(resolveContextRootAvailability('run')).toBe('run-creation');
    expect(resolveContextRootHost('steps')).toBe('server');
    expect(resolveContextRootAvailability('steps')).toBe('step-dispatch');
    expect(resolveContextRootHost('jobs')).toBe('server');
    expect(resolveContextRootAvailability('jobs')).toBe('job-activation');
    expect(resolveContextRootHost('vars')).toBe('server');
    expect(resolveContextRootAvailability('vars')).toBe('run-creation');
    expect(resolveContextRootHost('secrets')).toBe('runner');
    expect(resolveContextRootAvailability('secrets')).toBeUndefined();
    expect(resolveContextRootHost('runner')).toBe('runner');
    expect(resolveContextRootAvailability('runner')).toBeUndefined();
    expect(resolveContextRootHost('result')).toBe('server');
    expect(resolveContextRootAvailability('result')).toBe('step-report');
    expect(resolveContextRootHost('unknown')).toBeUndefined();
    expect(resolveContextRootAvailability('unknown')).toBeUndefined();
  });

  describe('workflow field failure policies', () => {
    it('declares the supported failure-policy classes', () => {
      expect(workflowFieldFailurePolicies).toEqual(['fail', 'degrade', 'fail-closed']);
    });

    it('maps interpolation fields to fail or degrade policies', () => {
      expect(getWorkflowInterpolationFieldFailurePolicy('run')).toBe('fail');
      expect(getWorkflowInterpolationFieldFailurePolicy('env.value')).toBe('fail');
      expect(getWorkflowInterpolationFieldFailurePolicy('agent.prompt')).toBe('fail');
      expect(getWorkflowInterpolationFieldFailurePolicy('agent.model')).toBe('fail');
      expect(getWorkflowInterpolationFieldFailurePolicy('agent.provider')).toBe('fail');
      expect(getWorkflowInterpolationFieldFailurePolicy('agent.thinking')).toBe('fail');
      expect(getWorkflowInterpolationFieldFailurePolicy('agent.session')).toBe('fail');
      expect(getWorkflowInterpolationFieldFailurePolicy('job.runner')).toBe('fail');
      expect(getWorkflowInterpolationFieldFailurePolicy('workflow.run_name')).toBe('degrade');
      expect(getWorkflowInterpolationFieldFailurePolicy('job.execution_name')).toBe('degrade');
      expect(getWorkflowInterpolationFieldFailurePolicy('step.name')).toBe('degrade');
      expect(getWorkflowInterpolationFieldFailurePolicy('step.working_directory')).toBe('fail');
      expect(getWorkflowInterpolationFieldFailurePolicy('step.feedback')).toBe('fail');
      expect(getWorkflowInterpolationFieldFailurePolicy('checkout.project')).toBe('fail');
      expect(getWorkflowInterpolationFieldFailurePolicy('checkout.connection')).toBe('fail');
      expect(getWorkflowInterpolationFieldFailurePolicy('checkout.repository')).toBe('fail');
      expect(getWorkflowInterpolationFieldFailurePolicy('checkout.ref')).toBe('fail');
      expect(getWorkflowInterpolationFieldFailurePolicy('checkout.path')).toBe('fail');
      expect(getWorkflowInterpolationFieldFailurePolicy('tool.with')).toBe('fail');
      expect(getWorkflowInterpolationFieldFailurePolicy('tool.outputs')).toBe('fail');
      expect(
        workflowInterpolationFields.map(
          (field) => workflowInterpolationFieldPolicies[field].failurePolicy,
        ),
      ).not.toContain('fail-closed');
    });

    it('declares predicate fields as fail-closed', () => {
      expect(workflowPredicateFields).toEqual([
        'step.success',
        'job.success',
        'trigger.filter',
        'listener.on',
        'listener.until',
        'job.if',
        'step.if',
      ]);
      expect(workflowPredicateFieldFailurePolicy).toBe('fail-closed');
      expect(getWorkflowPredicateFieldMinimumFillTarget('trigger.filter')).toBe('ingest');
      expect(getWorkflowPredicateFieldMinimumFillTarget('listener.on')).toBe('job-activation');
      expect(getWorkflowPredicateFieldMinimumFillTarget('listener.until')).toBe('job-activation');
      expect(getWorkflowPredicateFieldMinimumFillTarget('job.if')).toBe('job-activation');
      expect(getWorkflowPredicateFieldMinimumFillTarget('step.if')).toBe('step-dispatch');
    });

    it('resolves roots for a predicate field from its declared contract', () => {
      expect(contextRootsForField('step.success')).toEqual(['step', 'vars']);
      expect(contextRootsForField('trigger.filter')).toEqual(['event', 'trigger']);
    });

    it('resolves roots for an interpolation field from its accepted hosts', () => {
      expect(contextRootsForField('agent.prompt')).toEqual(
        workflowContextNames.filter((name) => name !== 'secrets'),
      );
      expect(contextRootsForField('run')).toEqual(workflowContextNames);
      expect(contextRootsForField('env.value')).toContain('secrets');
    });

    it('declares explicit roots for tool step fields', () => {
      expect(contextRootsForField('tool.with')).toEqual(
        workflowContextNames.filter((name) => name !== 'secrets'),
      );
      expect(contextRootsForField('tool.outputs')).toEqual(['result', 'vars']);
    });

    it('declares the minimum fill target of every interpolation field', () => {
      expect(getWorkflowInterpolationFieldMinimumFillTarget('tool.with')).toBe('step-dispatch');
      expect(getWorkflowInterpolationFieldMinimumFillTarget('tool.outputs')).toBe('step-report');
      expect(getWorkflowInterpolationFieldMinimumFillTarget('run')).toBeUndefined();
      expect(getWorkflowInterpolationFieldMinimumFillTarget('job.outputs')).toBe(
        'execution-resolution',
      );
    });

    it('declares the runtime roots for every predicate field', () => {
      expect(workflowPredicateContextRoots).toEqual({
        'step.success': ['step', 'vars'],
        'job.success': ['executions', 'jobs', 'vars'],
        'trigger.filter': ['event', 'trigger'],
        'listener.on': ['event', 'workflow', 'run', 'trigger', 'inputs', 'vars', 'job', 'jobs'],
        'listener.until': ['event', 'workflow', 'run', 'trigger', 'inputs', 'vars', 'job', 'jobs'],
        'job.if': ['workflow', 'run', 'trigger', 'event', 'inputs', 'vars', 'jobs', 'needs'],
        'step.if': ['vars', 'jobs', 'execution', 'step', 'steps'],
      });
      expect(getWorkflowPredicateContextRoots('listener.on')).toEqual([
        'event',
        'workflow',
        'run',
        'trigger',
        'inputs',
        'vars',
        'job',
        'jobs',
      ]);
    });

    it.each([
      ['step.success', ['step', 'vars']],
      ['job.success', ['executions', 'jobs', 'vars']],
      ['trigger.filter', ['event', 'trigger']],
      ['listener.on', ['event', 'workflow', 'run', 'trigger', 'inputs', 'vars', 'job', 'jobs']],
      ['listener.until', ['event', 'workflow', 'run', 'trigger', 'inputs', 'vars', 'job', 'jobs']],
      ['job.if', ['workflow', 'run', 'trigger', 'event', 'inputs', 'vars', 'jobs', 'needs']],
      ['step.if', ['vars', 'jobs', 'execution', 'step', 'steps']],
    ] as const)('projects runtime contexts for %s', (field, expectedRoots) => {
      const context = {
        workflow: {id: 'definition-1', name: 'Build'},
        run: {id: 'run-1'},
        trigger: {event: 'push'},
        event: {action: 'opened'},
        inputs: {environment: 'prod'},
        job: {key: 'build'},
        executions: [],
        execution: {status: 'running'},
        jobs: {build: {status: 'succeeded'}},
        needs: [],
        steps: {build: {status: 'succeeded'}},
        step: {status: 'succeeded'},
        vars: {ENABLED: 'true'},
        secrets: {TOKEN: 'secret'},
      };

      expect(Object.keys(projectWorkflowPredicateContext(field, context)).sort()).toEqual(
        [...expectedRoots].sort(),
      );
    });

    it('returns an empty context when no accepted roots are supplied', () => {
      expect(
        projectWorkflowPredicateContext('trigger.filter', {
          jobs: {build: {status: 'succeeded'}},
          secrets: {TOKEN: 'secret'},
        }),
      ).toEqual({});
    });

    it('uses predicate-specific types for runtime-specific properties', () => {
      expect(getWorkflowPredicateFieldTypeEnvironment('step.if', 'execution')).toMatchObject({
        execution: {fields: {failed: 'bool'}},
      });
      expect(getWorkflowPredicateFieldTypeEnvironment('step.if', 'step')).toMatchObject({
        step: {fields: {attempt: 'int', is_retry: 'bool'}},
      });
      expect(getWorkflowPredicateFieldTypeEnvironment('step.success', 'step')).toEqual({
        step: {
          kind: 'object',
          fields: {
            exit_code: 'int',
            status: 'string',
            outputs: {kind: 'map'},
          },
        },
      });
      expect(getWorkflowPredicateFieldTypeEnvironment('step.success', 'step', 'tool')).toEqual({
        step: {
          kind: 'object',
          fields: {
            status: 'string',
            outputs: {kind: 'map'},
          },
        },
      });
      expect(
        getWorkflowPredicateFieldTypeEnvironment('job.success', 'executions'),
      ).not.toHaveProperty('executions.element.fields.failed');
    });
  });

  it('supports CEL type-checking against the known context fields', () => {
    const runExpression = createWorkflowExpression({
      source: 'run.created_at < timestamp("2026-01-01T00:00:00Z")',
      check: {mode: 'typed', typeEnvironment: workflowContextDefinitions.run.typeEnvironment},
    });
    const triggerExpression = createWorkflowExpression({
      source: 'trigger.source == "github" && trigger.event == "pull_request"',
      check: {mode: 'typed', typeEnvironment: workflowContextDefinitions.trigger.typeEnvironment},
    });
    const jobExpression = createWorkflowExpression({
      source: 'job.key == "review"',
      check: {mode: 'typed', typeEnvironment: workflowContextDefinitions.job.typeEnvironment},
    });
    const executionsExpression = createWorkflowExpression({
      source:
        'executions[0].outputs.sha == execution.outputs.sha && executions.map(e, e.outputs.sha).size() >= 0',
      check: {
        mode: 'typed',
        typeEnvironment: {
          ...workflowContextDefinitions.executions.typeEnvironment,
          ...workflowContextDefinitions.execution.typeEnvironment,
        },
      },
    });

    expect(runExpression.check).toBe('typed');
    expect(triggerExpression.check).toBe('typed');
    expect(jobExpression.check).toBe('typed');
    expect(executionsExpression.check).toBe('typed');
  });

  it('syntax-checks open jobs root output and execution references', () => {
    const outputExpression = createWorkflowExpression({
      source: 'jobs.build.outputs.image_sha',
      check: {mode: workflowContextDefinitions.jobs.checkMode},
    });
    const executionsExpression = createWorkflowExpression({
      source: 'jobs.review.executions.map(e, e.outputs.verdict)',
      check: {mode: workflowContextDefinitions.jobs.checkMode},
    });

    expect(outputExpression.check).toBe('syntax');
    expect(executionsExpression.check).toBe('syntax');
  });

  it('type-checks step self-root gate expressions', () => {
    const gateExpression = createWorkflowExpression({
      source:
        'step.attempt >= 1 && step.is_retry == (step.attempt > 1) && step.exit_code == 0 && step.status == "succeeded"',
      check: {
        mode: 'typed',
        typeEnvironment: workflowContextDefinitions.step.typeEnvironment,
        expectedResultType: 'bool',
      },
    });

    expect(gateExpression.check).toBe('typed');
  });

  it('type-checks step restart provenance expressions', () => {
    const restartExpression = createWorkflowExpression({
      source:
        'step.restart.feedback != "" && step.restart.from.outputs.summary != "" && step.restart.from.gate.passed == false',
      check: {
        mode: 'typed',
        typeEnvironment: workflowContextDefinitions.step.typeEnvironment,
        expectedResultType: 'bool',
      },
    });

    expect(restartExpression.check).toBe('typed');
  });

  it('keeps executions event data dynamic after type conversion', () => {
    const eventDataExpression = createWorkflowExpression({
      source: 'executions.all(e, e.events.all(ev, ev.data.ok == true))',
      check: {
        mode: 'typed',
        typeEnvironment: workflowContextDefinitions.executions.typeEnvironment,
        expectedResultType: 'bool',
      },
    });

    expect(eventDataExpression.check).toBe('typed');
  });

  it('type-checks normalized references on execution events', () => {
    const eventReferenceExpression = createWorkflowExpression({
      source: 'execution.events[0].project.id',
      check: {
        mode: 'typed',
        typeEnvironment: workflowContextDefinitions.execution.typeEnvironment,
      },
    });

    expect(eventReferenceExpression.check).toBe('typed');
  });

  it('rejects unknown fields from known context type environments', () => {
    const act = () =>
      createWorkflowExpression({
        source: 'run.source.sha',
        check: {mode: 'typed', typeEnvironment: workflowContextDefinitions.run.typeEnvironment},
      });

    expect(act).toThrow(InvalidWorkflowExpressionError);
  });
});

describe('workflow interpolation field policies', () => {
  it('defines a policy for every interpolatable field', () => {
    expect(workflowInterpolationFields).toEqual([
      'run',
      'env.value',
      'agent.prompt',
      'agent.model',
      'agent.provider',
      'agent.thinking',
      'agent.session',
      'job.runner',
      'job.outputs',
      'workflow.run_name',
      'job.execution_name',
      'step.name',
      'step.working_directory',
      'step.feedback',
      'checkout.project',
      'checkout.connection',
      'checkout.repository',
      'checkout.ref',
      'checkout.path',
      'tool.with',
      'tool.outputs',
    ]);
    expect(Object.keys(workflowInterpolationFieldPolicies)).toEqual(workflowInterpolationFields);
  });

  it('declares dynamic-name self-reference targets in field policies', () => {
    expect(workflowInterpolationFieldPolicies['workflow.run_name'].selfReference).toEqual({
      root: 'run',
      key: 'name',
    });
    expect(workflowInterpolationFieldPolicies['job.execution_name'].selfReference).toEqual({
      root: 'execution',
      key: 'name',
    });
    expect(workflowInterpolationFieldPolicies['step.name'].selfReference).toBeUndefined();
  });

  it.each([
    ['run', ['server', 'runner']],
    ['env.value', ['server', 'runner']],
    ['agent.prompt', ['server']],
    ['agent.model', ['server']],
    ['agent.provider', ['server']],
    ['agent.thinking', ['server']],
    ['agent.session', ['server']],
    ['job.runner', ['server']],
    ['job.outputs', ['server']],
    ['workflow.run_name', ['server']],
    ['job.execution_name', ['server']],
    ['step.name', ['server']],
    ['step.working_directory', ['server']],
    ['step.feedback', ['server']],
    ['checkout.project', ['server']],
    ['checkout.connection', ['server']],
    ['checkout.repository', ['server']],
    ['checkout.ref', ['server']],
    ['checkout.path', ['server']],
    ['tool.with', ['server']],
    ['tool.outputs', ['server']],
  ] satisfies readonly [
    WorkflowInterpolationField,
    readonly string[],
  ][])('allows %s interpolation from the expected hosts', (field, hosts) => {
    expect(workflowInterpolationFieldPolicies[field].acceptedHosts).toEqual(hosts);
  });

  it('rejects runner-host contexts from server-only fields', () => {
    expect(workflowInterpolationFieldAcceptsHost('run', 'runner')).toBe(true);
    expect(workflowInterpolationFieldAcceptsHost('env.value', 'runner')).toBe(true);
    expect(workflowInterpolationFieldAcceptsHost('agent.prompt', 'runner')).toBe(false);
    expect(workflowInterpolationFieldAcceptsHost('agent.model', 'runner')).toBe(false);
    expect(workflowInterpolationFieldAcceptsHost('agent.provider', 'runner')).toBe(false);
    expect(workflowInterpolationFieldAcceptsHost('job.runner', 'runner')).toBe(false);
    expect(workflowInterpolationFieldAcceptsHost('job.outputs', 'runner')).toBe(false);
    expect(workflowInterpolationFieldAcceptsHost('job.runner', 'runner')).toBe(false);
    expect(workflowInterpolationFieldAcceptsHost('step.name', 'runner')).toBe(false);
    expect(workflowInterpolationFieldAcceptsHost('step.working_directory', 'runner')).toBe(false);
    expect(workflowInterpolationFieldAcceptsHost('step.feedback', 'runner')).toBe(false);
    expect(workflowInterpolationFieldAcceptsHost('tool.with', 'runner')).toBe(false);
    expect(workflowInterpolationFieldAcceptsHost('tool.outputs', 'runner')).toBe(false);
  });

  it('uses only registered hosts in field policies', () => {
    for (const policy of Object.values(workflowInterpolationFieldPolicies)) {
      expect(policy.acceptedHosts.length).toBeGreaterThan(0);
      for (const host of policy.acceptedHosts) {
        expect(workflowContextHosts).toContain(host);
      }
    }
  });
});

function availableAtReference(
  availability: AvailabilitySite,
): Readonly<Record<AvailabilitySite, boolean>> {
  const availabilityIndex = availabilitySites.indexOf(availability);
  return Object.fromEntries(
    availabilitySites.map((site) => [site, availabilitySites.indexOf(site) >= availabilityIndex]),
  ) as Record<AvailabilitySite, boolean>;
}

function noServerAvailabilityReference(): Readonly<Record<AvailabilitySite, boolean>> {
  return Object.fromEntries(availabilitySites.map((site) => [site, false])) as Record<
    AvailabilitySite,
    boolean
  >;
}
