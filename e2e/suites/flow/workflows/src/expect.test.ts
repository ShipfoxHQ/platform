import type {LogRecord} from '@shipfox/api-logs-dto';
import type {
  JobDto,
  StepAttemptDto,
  WorkflowRunDetailResponseDto,
  WorkflowRunJobDetailDto,
  WorkflowRunJobExecutionDetailDto,
  WorkflowRunStepDetailDto,
} from '@shipfox/api-workflows-dto';
import {evaluateExpectations, evaluateLogs, logText, parseExpectation} from './expect.js';

const timestamp = '2026-07-02T08:00:00.000Z';

function makeAttempt(overrides: Partial<StepAttemptDto> = {}): StepAttemptDto {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    step_id: '55555555-5555-4555-8555-555555555555',
    attempt: 1,
    execution_order: 1,
    status: 'succeeded',
    exit_code: 0,
    output: null,
    outputs: null,
    response: null,
    error: null,
    gate_result: {kind: 'none'},
    restart_feedback: null,
    started_at: timestamp,
    finished_at: timestamp,
    ...overrides,
  };
}

function makeStep(overrides: Partial<WorkflowRunStepDetailDto> = {}): WorkflowRunStepDetailDto {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    job_execution_id: '66666666-6666-4666-8666-666666666666',
    key: 'greet',
    name: 'Greet',
    source_location: null,
    status: 'succeeded',
    status_reason: null,
    type: 'run',
    config: {},
    evaluation_trace: null,
    error: null,
    position: 0,
    current_attempt: 1,
    exit_code: 0,
    outputs: null,
    response: null,
    gate_result: {kind: 'none'},
    created_at: timestamp,
    updated_at: timestamp,
    attempts: [makeAttempt()],
    ...overrides,
  };
}

function makeJobExecution(
  overrides: Partial<WorkflowRunJobExecutionDetailDto> = {},
): WorkflowRunJobExecutionDetailDto {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    job_id: '77777777-7777-4777-8777-777777777777',
    sequence: 1,
    name: 'build',
    status: 'succeeded',
    status_reason: null,
    runner: null,
    trigger_events: [],
    outputs: null,
    evaluation_trace: null,
    queued_at: timestamp,
    started_at: timestamp,
    finished_at: timestamp,
    timed_out_at: null,
    created_at: timestamp,
    updated_at: timestamp,
    steps: [makeStep()],
    ...overrides,
  };
}

function makeJob(overrides: Partial<WorkflowRunJobDetailDto> = {}): WorkflowRunJobDetailDto {
  const base: JobDto = {
    id: '77777777-7777-4777-8777-777777777777',
    run_attempt_id: '88888888-8888-4888-8888-888888888888',
    key: 'build',
    name: null,
    mode: 'one_shot',
    status: 'succeeded',
    status_reason: null,
    success: null,
    runner: null,
    evaluation_trace: null,
    carried_over: false,
    listening: null,
    listener_status: 'inactive',
    resolution_reason: null,
    outputs: null,
    dependencies: [],
    position: 0,
    created_at: timestamp,
    updated_at: timestamp,
  };
  return {...base, job_executions: [makeJobExecution()], ...overrides};
}

function makeDetail(
  overrides: Partial<WorkflowRunDetailResponseDto> = {},
): WorkflowRunDetailResponseDto {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    project_id: '11111111-1111-4111-8111-111111111111',
    definition_id: '22222222-2222-4222-8222-222222222222',
    number: 1,
    name: 'Hello world',
    workflow_name: 'Hello world',
    status: 'succeeded',
    current_attempt: 1,
    latest_attempt: 1,
    trigger_provider: 'gitea',
    trigger_source: 'gitea',
    trigger_event: 'push',
    trigger_payload: {data: {headCommitSha: 'abc123'}},
    trigger_reference: null,
    inputs: null,
    source_snapshot: null,
    created_at: timestamp,
    updated_at: timestamp,
    started_at: timestamp,
    finished_at: timestamp,
    run_attempt: {
      id: '88888888-8888-4888-8888-888888888888',
      workflow_run_id: '33333333-3333-4333-8333-333333333333',
      attempt: 1,
      status: 'succeeded',
      created_at: timestamp,
      started_at: timestamp,
      finished_at: timestamp,
      rerun_mode: null,
    },
    jobs: [makeJob()],
    has_started_job_execution: true,
    ...overrides,
  };
}

describe('evaluateExpectations', () => {
  test('reports no mismatches when run, job, and step all match', () => {
    const detail = makeDetail();

    const result = evaluateExpectations(detail, parseExpectation({run: {status: 'succeeded'}}));

    expect(result.mismatches).toEqual([]);
  });

  test('collects a log requirement with the step id and current attempt', () => {
    const detail = makeDetail({
      jobs: [
        makeJob({job_executions: [makeJobExecution({steps: [makeStep({current_attempt: 2})]})]}),
      ],
    });

    const result = evaluateExpectations(
      detail,
      parseExpectation({
        run: {status: 'succeeded'},
        jobs: {build: {steps: {greet: {logs: {include: ['hello world']}}}}},
      }),
    );

    expect(result.mismatches).toEqual([]);
    expect(result.logRequirements).toEqual([
      {
        path: 'jobs.build.steps.greet',
        stepId: '55555555-5555-4555-8555-555555555555',
        attempt: 2,
        include: ['hello world'],
        exclude: [],
      },
    ]);
  });

  test('flags a run status mismatch', () => {
    const detail = makeDetail({status: 'failed'});

    const result = evaluateExpectations(detail, parseExpectation({run: {status: 'succeeded'}}));

    expect(result.mismatches).toEqual([
      {path: 'run.status', expected: 'succeeded', actual: 'failed'},
    ]);
  });

  test('matches a step by name when its key is null', () => {
    const detail = makeDetail({
      jobs: [
        makeJob({
          job_executions: [makeJobExecution({steps: [makeStep({key: null, name: 'Greet'})]})],
        }),
      ],
    });

    const result = evaluateExpectations(
      detail,
      parseExpectation({
        run: {status: 'succeeded'},
        jobs: {build: {steps: {Greet: {status: 'succeeded'}}}},
      }),
    );

    expect(result.mismatches).toEqual([]);
  });

  test('flags job status, step status, and exit code mismatches together', () => {
    const detail = makeDetail({
      status: 'failed',
      jobs: [
        makeJob({
          status: 'failed',
          job_executions: [
            makeJobExecution({
              status: 'failed',
              steps: [
                makeStep({
                  status: 'failed',
                  attempts: [makeAttempt({status: 'failed', exit_code: 1})],
                }),
              ],
            }),
          ],
        }),
      ],
    });

    const result = evaluateExpectations(
      detail,
      parseExpectation({
        run: {status: 'succeeded'},
        jobs: {build: {status: 'succeeded', steps: {greet: {status: 'succeeded', exit_code: 0}}}},
      }),
    );

    expect(result.mismatches).toEqual([
      {path: 'run.status', expected: 'succeeded', actual: 'failed'},
      {path: 'jobs.build.status', expected: 'succeeded', actual: 'failed'},
      {path: 'jobs.build.steps.greet.status', expected: 'succeeded', actual: 'failed'},
      {path: 'jobs.build.steps.greet.exit_code', expected: '0', actual: '1'},
    ]);
  });

  test('matches job status reasons and step error details', () => {
    const detail = makeDetail({
      jobs: [
        makeJob({
          status: 'failed',
          status_reason: 'step_failed',
          job_executions: [
            makeJobExecution({
              status: 'failed',
              status_reason: 'step_failed',
              steps: [
                makeStep({
                  status: 'failed',
                  error: {
                    message: 'Could not resolve env.VERSION from steps.build.outputs.version',
                    reason: 'config_unresolvable',
                    field: 'env.VERSION',
                    source: 'steps.build.outputs.version',
                    category: 'user',
                  },
                }),
              ],
            }),
          ],
        }),
      ],
    });

    const result = evaluateExpectations(
      detail,
      parseExpectation({
        run: {status: 'succeeded'},
        jobs: {
          build: {
            status_reason: 'step_failed',
            steps: {
              greet: {
                error: {
                  reason: 'config_unresolvable',
                  field: 'env.VERSION',
                  source: 'build.outputs',
                },
              },
            },
          },
        },
      }),
    );

    expect(result.mismatches).toEqual([]);
  });

  test('reports absent job status reasons and step errors', () => {
    const result = evaluateExpectations(
      makeDetail(),
      parseExpectation({
        run: {status: 'succeeded'},
        jobs: {
          build: {
            status_reason: 'step_failed',
            steps: {greet: {error: {reason: 'config_unresolvable'}}},
          },
        },
      }),
    );

    expect(result.mismatches).toEqual([
      {path: 'jobs.build.status_reason', expected: 'step_failed', actual: 'null'},
      {path: 'jobs.build.steps.greet.error', expected: 'present', actual: 'null'},
    ]);
  });

  test('reports job status reason and step error detail mismatches', () => {
    const detail = makeDetail({
      jobs: [
        makeJob({
          status_reason: 'condition_false',
          job_executions: [
            makeJobExecution({
              status_reason: 'condition_false',
              steps: [
                makeStep({
                  error: {
                    message: 'Agent config could not be resolved',
                    reason: 'agent_config_invalid',
                    category: 'user',
                  },
                }),
              ],
            }),
          ],
        }),
      ],
    });

    const result = evaluateExpectations(
      detail,
      parseExpectation({
        run: {status: 'succeeded'},
        jobs: {
          build: {
            status_reason: 'step_failed',
            steps: {
              greet: {
                error: {
                  reason: 'config_unresolvable',
                  field: 'env.VERSION',
                  source: 'steps.build.outputs.version',
                },
              },
            },
          },
        },
      }),
    );

    expect(result.mismatches).toEqual([
      {path: 'jobs.build.status_reason', expected: 'step_failed', actual: 'condition_false'},
      {
        path: 'jobs.build.steps.greet.error.reason',
        expected: 'config_unresolvable',
        actual: 'agent_config_invalid',
      },
      {path: 'jobs.build.steps.greet.error.field', expected: 'env.VERSION', actual: 'null'},
      {
        path: 'jobs.build.steps.greet.error.source',
        expected: 'include steps.build.outputs.version',
        actual: 'null',
      },
    ]);
  });

  test('reports a step error source mismatch when the source is present', () => {
    const detail = makeDetail({
      jobs: [
        makeJob({
          job_executions: [
            makeJobExecution({
              steps: [
                makeStep({
                  error: {
                    message: 'Could not resolve env.VERSION from steps.build.outputs.version',
                    reason: 'config_unresolvable',
                    field: 'env.VERSION',
                    source: 'steps.build.outputs.version',
                    category: 'user',
                  },
                }),
              ],
            }),
          ],
        }),
      ],
    });

    const result = evaluateExpectations(
      detail,
      parseExpectation({
        run: {status: 'succeeded'},
        jobs: {
          build: {steps: {greet: {error: {source: 'steps.package.outputs.version'}}}},
        },
      }),
    );

    expect(result.mismatches).toEqual([
      {
        path: 'jobs.build.steps.greet.error.source',
        expected: 'include steps.package.outputs.version',
        actual: 'steps.build.outputs.version',
      },
    ]);
  });

  test('matches gate result details on the latest step attempt', () => {
    const detail = makeDetail({
      jobs: [
        makeJob({
          job_executions: [
            makeJobExecution({
              steps: [
                makeStep({
                  attempts: [
                    makeAttempt({
                      gate_result: {
                        kind: 'evaluation_error',
                        reason: 'gate exploded',
                        exit_code: 0,
                      },
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    });

    const result = evaluateExpectations(
      detail,
      parseExpectation({
        run: {status: 'succeeded'},
        jobs: {
          build: {
            steps: {
              greet: {
                gate_result: {
                  kind: 'evaluation_error',
                  reason: 'gate exploded',
                  exit_code: 0,
                },
              },
            },
          },
        },
      }),
    );

    expect(result.mismatches).toEqual([]);
  });

  test('reports absent and mismatched gate result details', () => {
    const absent = evaluateExpectations(
      makeDetail({
        jobs: [
          makeJob({
            job_executions: [
              makeJobExecution({
                steps: [makeStep({attempts: []})],
              }),
            ],
          }),
        ],
      }),
      parseExpectation({
        run: {status: 'succeeded'},
        jobs: {build: {steps: {greet: {gate_result: {kind: 'evaluation_error'}}}}},
      }),
    );
    const mismatched = evaluateExpectations(
      makeDetail(),
      parseExpectation({
        run: {status: 'succeeded'},
        jobs: {
          build: {
            steps: {
              greet: {
                gate_result: {
                  kind: 'evaluation_error',
                  reason: 'gate expression evaluation failed',
                  exit_code: 1,
                },
              },
            },
          },
        },
      }),
    );

    expect(absent.mismatches).toEqual([
      {path: 'jobs.build.steps.greet.gate_result', expected: 'present', actual: 'null'},
    ]);
    expect(mismatched.mismatches).toEqual([
      {
        path: 'jobs.build.steps.greet.gate_result.kind',
        expected: 'evaluation_error',
        actual: 'none',
      },
      {
        path: 'jobs.build.steps.greet.gate_result.reason',
        expected: 'gate expression evaluation failed',
        actual: 'null',
      },
      {
        path: 'jobs.build.steps.greet.gate_result.exit_code',
        expected: '1',
        actual: 'missing',
      },
    ]);
  });

  test('reports a missing job and a missing step', () => {
    const missingJob = evaluateExpectations(
      makeDetail(),
      parseExpectation({run: {status: 'succeeded'}, jobs: {deploy: {status: 'succeeded'}}}),
    );
    const missingStep = evaluateExpectations(
      makeDetail(),
      parseExpectation({
        run: {status: 'succeeded'},
        jobs: {build: {steps: {absent: {status: 'succeeded'}}}},
      }),
    );

    expect(missingJob.mismatches).toEqual([
      {path: 'jobs.deploy', expected: 'present', actual: 'missing'},
    ]);
    expect(missingStep.mismatches).toEqual([
      {path: 'jobs.build.steps.absent', expected: 'present', actual: 'missing'},
    ]);
  });

  test('renders a null exit code when the attempt has none', () => {
    const detail = makeDetail({
      jobs: [
        makeJob({
          job_executions: [
            makeJobExecution({steps: [makeStep({attempts: [makeAttempt({exit_code: null})]})]}),
          ],
        }),
      ],
    });

    const result = evaluateExpectations(
      detail,
      parseExpectation({
        run: {status: 'succeeded'},
        jobs: {build: {steps: {greet: {exit_code: 0}}}},
      }),
    );

    expect(result.mismatches).toEqual([
      {path: 'jobs.build.steps.greet.exit_code', expected: '0', actual: 'null'},
    ]);
  });

  test('evaluates the step from the latest job execution when a job re-executed', () => {
    const detail = makeDetail({
      jobs: [
        makeJob({
          job_executions: [
            makeJobExecution({
              sequence: 1,
              steps: [makeStep({status: 'succeeded', attempts: [makeAttempt({exit_code: 0})]})],
            }),
            makeJobExecution({
              sequence: 2,
              steps: [
                makeStep({
                  status: 'failed',
                  attempts: [makeAttempt({status: 'failed', exit_code: 2})],
                }),
              ],
            }),
          ],
        }),
      ],
    });

    const result = evaluateExpectations(
      detail,
      parseExpectation({
        run: {status: 'succeeded'},
        jobs: {build: {steps: {greet: {status: 'succeeded', exit_code: 0}}}},
      }),
    );

    expect(result.mismatches).toEqual([
      {path: 'jobs.build.steps.greet.status', expected: 'succeeded', actual: 'failed'},
      {path: 'jobs.build.steps.greet.exit_code', expected: '0', actual: '2'},
    ]);
  });
});

describe('evaluateLogs', () => {
  test('passes when includes are present and excludes are absent', () => {
    const mismatches = evaluateLogs({
      path: 'jobs.build.steps.greet',
      text: 'hello world\n',
      include: ['hello world'],
      exclude: ['SECRET'],
    });

    expect(mismatches).toEqual([]);
  });

  test('flags a missing include and a present exclude', () => {
    const mismatches = evaluateLogs({
      path: 'jobs.build.steps.greet',
      text: 'leaked SECRET_VALUE\n',
      include: ['hello world'],
      exclude: ['SECRET_VALUE'],
    });

    expect(mismatches).toEqual([
      {
        path: 'jobs.build.steps.greet.logs.include',
        expected: 'match hello world',
        actual: 'not found',
      },
      {
        path: 'jobs.build.steps.greet.logs.exclude',
        expected: 'absent SECRET_VALUE',
        actual: 'present',
      },
    ]);
  });

  test('treats a slash-wrapped pattern as a regular expression', () => {
    const mismatches = evaluateLogs({
      path: 'p',
      text: 'built in 1234ms\n',
      include: ['/built in \\d+ms/'],
      exclude: [],
    });

    expect(mismatches).toEqual([]);
  });

  test('treats a bare // as a literal substring, not a match-anything regex', () => {
    const mismatches = evaluateLogs({
      path: 'p',
      text: 'no slashes here\n',
      include: ['//'],
      exclude: [],
    });

    expect(mismatches).toEqual([
      {path: 'p.logs.include', expected: 'match //', actual: 'not found'},
    ]);
  });
});

describe('logText', () => {
  test('concatenates output records and ignores control records', () => {
    const records: LogRecord[] = [
      {v: 1, ts: 1, type: 'group_start', group_id: 'g1', parent_group_id: null, name: 'setup'},
      {v: 1, ts: 2, type: 'output', stream: 'stdout', data: 'hello '},
      {v: 1, ts: 3, type: 'output', stream: 'stderr', data: 'world'},
      {v: 1, ts: 4, type: 'end', total_bytes: 11},
    ];

    expect(logText(records)).toBe('hello world');
  });
});

describe('parseExpectation', () => {
  test('applies push and timeout defaults', () => {
    const expectation = parseExpectation({run: {status: 'succeeded'}});

    expect(expectation.trigger).toBe('push');
    expect(expectation.timeout_seconds).toBe(180);
  });

  test('accepts a push commit message override', () => {
    const expectation = parseExpectation({
      push: {message: "literal $(printf I''NJECTED)"},
      run: {status: 'succeeded'},
    });

    expect(expectation.push?.message).toBe("literal $(printf I''NJECTED)");
  });

  test('accepts webhook request options', () => {
    const expectation = parseExpectation({
      trigger: 'webhook',
      webhook: {
        body: {payment_id: 'pay_123'},
        headers: {'x-e2e-event': 'payment.created'},
        query: {mode: 'test'},
      },
      run: {status: 'succeeded'},
    });

    expect(expectation.trigger).toBe('webhook');
    expect(expectation.webhook).toEqual({
      body: {payment_id: 'pay_123'},
      headers: {'x-e2e-event': 'payment.created'},
      query: {mode: 'test'},
    });
  });

  test('accepts runner log expectations', () => {
    const expectation = parseExpectation({
      run: {status: 'succeeded'},
      runner_log: {exclude: ['runtime-secret']},
    });

    expect(expectation.runner_log?.exclude).toEqual(['runtime-secret']);
  });

  test('rejects unknown keys', () => {
    expect(() => parseExpectation({run: {status: 'succeeded'}, unexpected: true})).toThrow();
  });

  test('rejects unknown nested step error keys', () => {
    expect(() =>
      parseExpectation({
        run: {status: 'succeeded'},
        jobs: {build: {steps: {greet: {error: {code: 'config_unresolvable'}}}}},
      }),
    ).toThrow();
  });

  test('rejects unknown nested gate result keys', () => {
    expect(() =>
      parseExpectation({
        run: {status: 'succeeded'},
        jobs: {build: {steps: {greet: {gate_result: {passed: false}}}}},
      }),
    ).toThrow();
  });
});
