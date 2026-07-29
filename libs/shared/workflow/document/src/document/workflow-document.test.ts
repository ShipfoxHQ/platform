import {
  WORKFLOW_DOCUMENT_ENV_MAX_ENTRIES,
  WORKFLOW_DOCUMENT_ENV_MAX_SERIALIZED_BYTES,
  WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_DEPTH,
  WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_SERIALIZED_BYTES,
  WORKFLOW_DOCUMENT_STEP_OUTPUTS_MAX_ENTRIES,
  workflowDocumentSchema,
} from './workflow-document.js';

const interpolationOpen = '$' + '{{';
const interpolationClose = '}' + '}';

function interpolation(source: string): string {
  return `${interpolationOpen} ${source} ${interpolationClose}`;
}

describe('workflowDocumentSchema', () => {
  it('accepts dynamic workflow and job execution names', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'Deploy application',
      run_name: interpolation('inputs.environment'),
      jobs: {
        deploy: {
          name: 'Deploy',
          execution_name: interpolation('inputs.environment'),
          steps: [{run: 'deploy'}],
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it('accepts a valid minimal workflow document', () => {
    const workflowDocument = {
      name: 'simple build',
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const result = workflowDocumentSchema.safeParse(workflowDocument);

    expect(result.success).toBe(true);
  });

  it('accepts job and step if predicates as document fields', () => {
    const workflowDocument = {
      name: 'conditional build',
      jobs: {
        build: {
          if: interpolation('true'),
          steps: [
            {if: interpolation('event.action == "opened"'), run: 'npm run build'},
            {if: interpolation('step.is_retry'), prompt: 'Review the retry.'},
          ],
        },
      },
    };

    const result = workflowDocumentSchema.safeParse(workflowDocument);

    expect(result.success).toBe(true);
  });

  it('accepts job output mappings', () => {
    const workflowDocument = {
      name: 'job outputs',
      jobs: {
        build: {
          steps: [{key: 'build', run: 'npm run build'}],
          outputs: {
            image_sha: interpolation('steps.build.outputs.sha'),
            registry: 'registry.example.com',
          },
        },
      },
    };

    const result = workflowDocumentSchema.safeParse(workflowDocument);

    expect(result.success).toBe(true);
  });

  it('accepts and desugars step output declarations', () => {
    const workflowDocument = {
      name: 'typed outputs',
      jobs: {
        build: {
          steps: [
            {
              key: 'build',
              run: 'npm run build',
              outputs: {
                sha: 'string',
                count: 'number',
                ready: {type: 'boolean'},
                meta: {
                  type: 'json',
                  schema: {
                    type: 'object',
                    properties: {registry: {type: 'string'}},
                    required: ['registry'],
                    additionalProperties: false,
                  },
                },
              },
            },
          ],
        },
      },
    };

    const result = workflowDocumentSchema.parse(workflowDocument);

    expect(result.jobs.build?.steps[0]?.outputs).toEqual({
      sha: {type: 'string'},
      count: {type: 'number'},
      ready: {type: 'boolean'},
      meta: {
        type: 'json',
        schema: {
          type: 'object',
          properties: {registry: {type: 'string'}},
          required: ['registry'],
          additionalProperties: false,
        },
      },
    });
  });

  it('accepts boolean JSON Schemas in step output declarations', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'typed outputs',
      jobs: {
        build: {
          steps: [{run: 'npm run build', outputs: {payload: {type: 'json', schema: true}}}],
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects typed output keys that are not CEL identifiers', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'typed outputs',
      jobs: {
        build: {
          steps: [{run: 'npm run build', outputs: {'image-sha': 'string'}}],
        },
      },
    });

    const issue = result.success
      ? undefined
      : result.error.issues.find(
          (candidate) => candidate.path.join('.') === 'jobs.build.steps.0.outputs.image-sha',
        );
    expect(issue?.message).toBe('Output keys must be CEL identifiers.');
  });

  it('rejects unknown step output types', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'typed outputs',
      jobs: {
        build: {
          steps: [{run: 'npm run build', outputs: {sha: 'integer'}}],
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects schemas on non-json step outputs', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'typed outputs',
      jobs: {
        build: {
          steps: [{run: 'npm run build', outputs: {sha: {type: 'string', schema: {}}}}],
        },
      },
    });

    const issue = result.success
      ? undefined
      : result.error.issues.find(
          (candidate) => candidate.path.join('.') === 'jobs.build.steps.0.outputs.sha.schema',
        );
    expect(issue?.message).toBe('`schema` is only supported for json outputs.');
  });

  it.each([
    ['string', 'not a schema'],
    ['number', 1],
    ['null', null],
    ['array', [{type: 'string'}]],
  ])('rejects %s step output JSON Schemas', (_label, schema) => {
    const result = workflowDocumentSchema.safeParse({
      name: 'typed outputs',
      jobs: {
        build: {
          steps: [{run: 'npm run build', outputs: {payload: {type: 'json', schema}}}],
        },
      },
    });

    const issue = result.success
      ? undefined
      : result.error.issues.find(
          (candidate) => candidate.path.join('.') === 'jobs.build.steps.0.outputs.payload.schema',
        );
    expect(issue?.message).toBe('Schema must be a valid JSON Schema document.');
  });

  it('rejects too many step output declarations', () => {
    const outputs = Object.fromEntries(
      Array.from({length: WORKFLOW_DOCUMENT_STEP_OUTPUTS_MAX_ENTRIES + 1}, (_, index) => [
        `output_${index}`,
        'string',
      ]),
    );

    const result = workflowDocumentSchema.safeParse({
      name: 'typed outputs',
      jobs: {
        build: {
          steps: [{run: 'npm run build', outputs}],
        },
      },
    });

    const issue = result.success
      ? undefined
      : result.error.issues.find(
          (candidate) => candidate.path.join('.') === 'jobs.build.steps.0.outputs',
        );
    expect(issue?.message).toBe(
      `Step outputs cannot define more than ${WORKFLOW_DOCUMENT_STEP_OUTPUTS_MAX_ENTRIES} entries.`,
    );
  });

  it('rejects step output JSON Schemas that exceed the byte cap', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'typed outputs',
      jobs: {
        build: {
          steps: [
            {
              run: 'npm run build',
              outputs: {
                payload: {
                  type: 'json',
                  schema: {
                    description: 'x'.repeat(
                      WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_SERIALIZED_BYTES,
                    ),
                  },
                },
              },
            },
          ],
        },
      },
    });

    const issue = result.success
      ? undefined
      : result.error.issues.find(
          (candidate) => candidate.path.join('.') === 'jobs.build.steps.0.outputs.payload.schema',
        );
    expect(issue?.message).toBe(
      `Output JSON Schema cannot serialize to more than ${WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_SERIALIZED_BYTES} bytes.`,
    );
  });

  it('rejects step output JSON Schemas that exceed the depth cap', () => {
    let schema: unknown = {type: 'string'};
    for (let index = 0; index < WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_DEPTH + 1; index += 1) {
      schema = {items: schema};
    }

    const result = workflowDocumentSchema.safeParse({
      name: 'typed outputs',
      jobs: {
        build: {
          steps: [{run: 'npm run build', outputs: {payload: {type: 'json', schema}}}],
        },
      },
    });

    const issue = result.success
      ? undefined
      : result.error.issues.find(
          (candidate) => candidate.path.join('.') === 'jobs.build.steps.0.outputs.payload.schema',
        );
    expect(issue?.message).toBe(
      `Output JSON Schema cannot be nested deeper than ${WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_DEPTH} levels.`,
    );
  });

  it.each([
    [
      'top-level string runner',
      {name: 'simple build', runner: 'ubuntu-latest', jobs: {build: {steps: [{run: 'npm test'}]}}},
    ],
    [
      'top-level runner array',
      {
        name: 'simple build',
        runner: ['ubuntu-latest', 'node-22'],
        jobs: {build: {steps: [{run: 'npm test'}]}},
      },
    ],
    [
      'job string runner',
      {
        name: 'simple build',
        jobs: {build: {runner: 'ubuntu-latest', steps: [{run: 'npm test'}]}},
      },
    ],
    [
      'job runner array',
      {
        name: 'simple build',
        jobs: {build: {runner: ['ubuntu-latest', 'node-22'], steps: [{run: 'npm test'}]}},
      },
    ],
    [
      'string dependency',
      {name: 'simple build', jobs: {build: {needs: 'install', steps: [{run: 'npm test'}]}}},
    ],
    [
      'dependency array',
      {
        name: 'simple build',
        jobs: {build: {needs: ['install', 'lint'], steps: [{run: 'npm test'}]}},
      },
    ],
  ])('accepts %s shorthand', (_label, workflowDocument) => {
    const result = workflowDocumentSchema.safeParse(workflowDocument);

    expect(result.success).toBe(true);
  });

  it.each([
    [
      'checkout contents write',
      {
        checkout: {
          permissions: {
            contents: 'write',
          },
        },
      },
    ],
    ['checkout persist credentials false', {checkout: {'persist-credentials': false}}],
    ['empty checkout', {checkout: {}}],
    ['omitted checkout', {}],
  ])('accepts %s', (_label, jobOverride) => {
    const result = workflowDocumentSchema.safeParse({
      name: 'simple build',
      jobs: {
        build: {
          ...jobOverride,
          steps: [{run: 'npm test'}],
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it('keeps trigger filters as strings', () => {
    const workflowDocument = {
      name: 'simple build',
      triggers: {
        main_push: {
          source: 'github',
          event: 'push',
          filter: 'event.ref == "refs/heads/main"',
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const result = workflowDocumentSchema.parse(workflowDocument);

    expect(result.triggers?.main_push?.filter).toBe('event.ref == "refs/heads/main"');
  });

  it('keeps cron trigger config values', () => {
    const workflowDocument = {
      name: 'nightly build',
      triggers: {
        nightly: {
          source: 'cron',
          event: 'tick',
          config: {
            schedule: '0 2 * * *',
            timezone: 'Europe/Paris',
          },
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const result = workflowDocumentSchema.parse(workflowDocument);

    expect(result.triggers?.nightly?.config).toEqual({
      schedule: '0 2 * * *',
      timezone: 'Europe/Paris',
    });
  });

  it('rejects config for a source with no registered config schema', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'simple build',
      triggers: {
        main_push: {
          source: 'github',
          event: 'push',
          config: {branch: 'main'},
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    });

    const issue = result.success
      ? undefined
      : result.error.issues.find(
          (candidate) => candidate.path.join('.') === 'triggers.main_push.config',
        );
    expect(issue?.message).toBe('`config` is not supported for source `github`.');
  });

  it('rejects unknown cron config fields', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'nightly build',
      triggers: {
        nightly: {
          source: 'cron',
          event: 'tick',
          config: {
            schedule: '0 2 * * *',
            offset: '5m',
          },
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    });

    const issue = result.success
      ? undefined
      : result.error.issues.find(
          (candidate) => candidate.path.join('.') === 'triggers.nightly.config',
        );
    expect(issue?.message).toBe('Unrecognized key: "offset"');
  });

  it('rejects non-string cron config schedule values', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'nightly build',
      triggers: {
        nightly: {
          source: 'cron',
          event: 'tick',
          config: {
            schedule: 5,
          },
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    });

    const issue = result.success
      ? undefined
      : result.error.issues.find(
          (candidate) => candidate.path.join('.') === 'triggers.nightly.config.schedule',
        );
    expect(issue?.message).toBe('Invalid input: expected string, received number');
  });

  it('accepts listening job configuration under a listening block', () => {
    const workflowDocument = {
      name: 'listen for reviews',
      jobs: {
        review: {
          listening: {
            on: [{source: 'github', event: 'pull_request_review'}],
            until: [{source: 'github', event: 'pull_request'}],
            timeout: '30d',
            max_executions: 3,
            batch: {debounce: '5s', max_size: 10, max_wait: '1h'},
            on_resolve: 'cancel',
          },
          steps: [{prompt: 'Review'}],
        },
      },
    };

    const result = workflowDocumentSchema.safeParse(workflowDocument);

    expect(result.success).toBe(true);
  });

  it.each(['on', 'until'] as const)('rejects listening %s trigger config', (listeningField) => {
    const result = workflowDocumentSchema.safeParse({
      name: 'listen for reviews',
      jobs: {
        review: {
          listening: {
            on: [{source: 'github', event: 'pull_request_review'}],
            [listeningField]: [
              {
                source: 'cron',
                event: 'tick',
                config: {schedule: '0 2 * * *'},
              },
            ],
          },
          steps: [{prompt: 'Review'}],
        },
      },
    });

    const issues = result.success
      ? []
      : result.error.issues.filter(
          (candidate) =>
            candidate.path.join('.') === `jobs.review.listening.${listeningField}.0.config`,
        );
    const issue = issues.at(0);
    expect(issues).toHaveLength(1);
    expect(issue?.message).toBe('`config` is only supported on top-level triggers.');
  });

  it('rejects an empty listening batch block', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'listen for reviews',
      jobs: {
        review: {
          listening: {
            on: [{source: 'github', event: 'pull_request_review'}],
            batch: {},
          },
          steps: [{prompt: 'Review'}],
        },
      },
    });

    const issue = result.success
      ? undefined
      : result.error.issues.find(
          (candidate) => candidate.path.join('.') === 'jobs.review.listening.batch',
        );
    expect(issue?.message).toBe('Expected debounce, max_size, or max_wait');
  });

  it('rejects flat listening fields on a job', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'listen for reviews',
      jobs: {
        review: {
          on: [{source: 'github', event: 'pull_request_review'}],
          steps: [{prompt: 'Review'}],
        },
      },
    });

    const issue = result.success
      ? undefined
      : result.error.issues.find((candidate) => candidate.path.join('.') === 'jobs.review');
    expect(issue?.message).toContain('Unrecognized key');
    expect(issue?.message).toContain('on');
  });

  it('accepts env maps at workflow, job, and run-step scope', () => {
    const workflowDocument = {
      name: 'env build',
      env: {NODE_ENV: 'test', PORT: 3000, CI: true},
      jobs: {
        build: {
          env: {JOB_SCOPE: 'build'},
          steps: [{run: 'npm test', env: {STEP_SCOPE: 'test'}}],
        },
      },
    };

    const result = workflowDocumentSchema.safeParse(workflowDocument);

    expect(result.success).toBe(true);
  });

  it.each([
    [
      'workflow',
      (env: Record<string, string>) => ({
        name: 'env build',
        env,
        jobs: {build: {steps: [{run: 'npm test'}]}},
      }),
      'env',
    ],
    [
      'job',
      (env: Record<string, string>) => ({
        name: 'env build',
        jobs: {build: {env, steps: [{run: 'npm test'}]}},
      }),
      'jobs.build.env',
    ],
    [
      'run step',
      (env: Record<string, string>) => ({
        name: 'env build',
        jobs: {build: {steps: [{run: 'npm test', env}]}},
      }),
      'jobs.build.steps.0.env',
    ],
  ])('rejects %s env with too many entries', (_scope, buildDocument, issuePath) => {
    const env = Object.fromEntries(
      Array.from({length: WORKFLOW_DOCUMENT_ENV_MAX_ENTRIES + 1}, (_, index) => [
        `KEY_${index}`,
        'value',
      ]),
    );

    const result = workflowDocumentSchema.safeParse(buildDocument(env));

    const issue = result.success
      ? undefined
      : result.error.issues.find((candidate) => candidate.path.join('.') === issuePath);
    expect(issue?.message).toBe(
      `Env cannot define more than ${WORKFLOW_DOCUMENT_ENV_MAX_ENTRIES} entries.`,
    );
  });

  it('rejects env maps that exceed the serialized byte limit', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'env build',
      jobs: {
        build: {
          steps: [
            {
              run: 'npm test',
              env: {LARGE_VALUE: 'x'.repeat(WORKFLOW_DOCUMENT_ENV_MAX_SERIALIZED_BYTES)},
            },
          ],
        },
      },
    });

    const issue = result.success
      ? undefined
      : result.error.issues.find(
          (candidate) => candidate.path.join('.') === 'jobs.build.steps.0.env',
        );
    expect(issue?.message).toBe(
      `Env cannot serialize to more than ${WORKFLOW_DOCUMENT_ENV_MAX_SERIALIZED_BYTES} bytes.`,
    );
  });

  it.each([
    ['has a key that starts with a digit', {env: {'1PORT': '3000'}}],
    ['has a key containing a dash', {env: {'NODE-ENV': 'test'}}],
    ['has a key containing a dot', {env: {'node.env': 'test'}}],
    ['has a string value containing a null byte', {env: {NODE_ENV: 'test\u0000prod'}}],
    ['has a null value', {env: {NODE_ENV: null}}],
    ['has an object value', {env: {NODE_ENV: {value: 'test'}}}],
  ])('rejects env that %s', (_label, override) => {
    const result = workflowDocumentSchema.safeParse({
      name: 'env build',
      jobs: {
        build: {
          steps: [{run: 'npm test', ...override}],
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it('reports a clear message for env on an agent step', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'agent build',
      jobs: {
        fix: {
          steps: [{model: 'claude-opus-4-8', prompt: 'Fix it.', env: {NODE_ENV: 'test'}}],
        },
      },
    });

    const envIssue = result.success
      ? undefined
      : result.error.issues.find((issue) => issue.path.includes('env'));
    expect(envIssue?.message).toBe('"env" is supported only on run steps.');
  });

  it('accepts a step gate with success and on_failure feedback', () => {
    const workflowDocument = {
      name: 'review loop',
      jobs: {
        review: {
          steps: [
            {name: 'producer', run: 'npm run build'},
            {
              name: 'reviewer',
              run: 'npm run review',
              gate: {
                success: 'step.outputs.pass == true',
                on_failure: {
                  restart_from: 'producer',
                  feedback: 'Review failed',
                },
              },
            },
          ],
        },
      },
    };

    const result = workflowDocumentSchema.safeParse(workflowDocument);

    expect(result.success).toBe(true);
  });

  it.each([
    ['missing required top-level fields', {}],
    ['empty jobs map', {name: 'simple build', jobs: {}}],
    [
      'empty triggers map',
      {name: 'simple build', triggers: {}, jobs: {build: {steps: [{run: 'npm test'}]}}},
    ],
    ['empty steps array', {name: 'simple build', jobs: {build: {steps: []}}}],
    [
      'unsupported top-level on field',
      {name: 'simple build', on: 'push', jobs: {build: {steps: [{run: 'npm test'}]}}},
    ],
    [
      'unsupported trigger on field',
      {
        name: 'simple build',
        triggers: {github: {source: 'github', event: 'push', on: 'pull_request'}},
        jobs: {build: {steps: [{run: 'npm test'}]}},
      },
    ],
    [
      'trigger without event',
      {
        name: 'simple build',
        triggers: {github: {source: 'github'}},
        jobs: {build: {steps: [{run: 'npm test'}]}},
      },
    ],
    [
      'unknown fields',
      {name: 'simple build', jobs: {build: {steps: [{run: 'npm test', shell: 'bash'}]}}},
    ],
    ['empty gate', {name: 'simple build', jobs: {build: {steps: [{run: 'npm test', gate: {}}]}}}],
    [
      'gate unknown field',
      {
        name: 'simple build',
        jobs: {build: {steps: [{run: 'npm test', gate: {if: 'exit_code == 0'}}]}},
      },
    ],
    [
      'legacy gate success_if field',
      {
        name: 'simple build',
        jobs: {build: {steps: [{run: 'npm test', gate: {success_if: 'step.exit_code == 0'}}]}},
      },
    ],
    [
      'gate on_failure without restart_from',
      {
        name: 'simple build',
        jobs: {build: {steps: [{run: 'npm test', gate: {on_failure: {}}}]}},
      },
    ],
    [
      'legacy gate on_failure output field',
      {
        name: 'simple build',
        jobs: {
          build: {
            steps: [
              {name: 'producer', run: 'npm test'},
              {
                run: 'npm test',
                gate: {on_failure: {restart_from: 'producer', output: 'Review failed'}},
              },
            ],
          },
        },
      },
    ],
    [
      'unknown checkout field',
      {
        name: 'simple build',
        jobs: {build: {checkout: {token: true}, steps: [{run: 'npm test'}]}},
      },
    ],
    [
      'unknown checkout permissions field',
      {
        name: 'simple build',
        jobs: {
          build: {
            checkout: {permissions: {pull_requests: 'write'}},
            steps: [{run: 'npm test'}],
          },
        },
      },
    ],
    [
      'invalid checkout contents',
      {
        name: 'simple build',
        jobs: {
          build: {
            checkout: {permissions: {contents: 'admin'}},
            steps: [{run: 'npm test'}],
          },
        },
      },
    ],
    [
      'non-boolean checkout persist credentials',
      {
        name: 'simple build',
        jobs: {
          build: {
            checkout: {'persist-credentials': 'false'},
            steps: [{run: 'npm test'}],
          },
        },
      },
    ],
  ])('rejects %s', (_label, workflowDocument) => {
    const result = workflowDocumentSchema.safeParse(workflowDocument);

    expect(result.success).toBe(false);
  });

  it.each([
    ['prompt-only agent step', {prompt: 'Fix the failing tests.'}],
    ['inline agent step', {model: 'claude-opus-4-8', prompt: 'Fix the failing tests.'}],
    ['agent step with harness', {harness: 'claude', model: 'claude-opus-4-8', prompt: 'Fix it.'}],
    ['agent step with thinking', {model: 'claude-opus-4-8', prompt: 'Fix it.', thinking: 'low'}],
    ['agent step with provider', {model: 'gpt-5.5-pro', prompt: 'Fix it.', provider: 'openai'}],
    ['agent step with provider only', {provider: 'openai', prompt: 'Fix it.'}],
    [
      'agent step with tools',
      {harness: 'pi', prompt: 'Fetch docs.', tools: ['read', 'fetch_content']},
    ],
    [
      'agent step with integrations',
      {
        harness: 'claude',
        prompt: 'Triage the pull request.',
        integrations: [
          {
            connection: 'github-main',
            include: ['issue_read.get', 'pull_request_read.get_files'],
            exclude: ['actions_run_trigger.run_workflow'],
            allow_write: false,
          },
        ],
      },
    ],
    [
      'agent step with whole-family integration selection',
      {
        prompt: 'Review the issue.',
        integrations: [{include: ['issue_read', 'actions_run_trigger'], allow_write: true}],
      },
    ],
    ['agent step with name', {name: 'fix', model: 'claude-opus-4-8', prompt: 'Fix it.'}],
    [
      'agent step with gate',
      {model: 'claude-opus-4-8', prompt: 'Fix it.', gate: {success: 'step.exit_code == 0'}},
    ],
    ['custom-model-provider model string', {model: 'openrouter/anthropic/claude', prompt: 'Hi.'}],
  ])('accepts %s', (_label, step) => {
    const result = workflowDocumentSchema.safeParse({
      name: 'agent build',
      jobs: {fix: {steps: [step]}},
    });

    expect(result.success).toBe(true);
  });

  it.each([
    ['agent step missing prompt', {model: 'claude-opus-4-8'}],
    ['prompt on a run step', {run: 'npm test', prompt: 'Fix.'}],
    ['model on a run step', {run: 'npm test', model: 'claude-opus-4-8'}],
    ['neither run nor agent', {name: 'noop'}],
    ['reserved agent keyword', {agent: 'producer', model: 'claude-opus-4-8', prompt: 'Fix.'}],
    ['thinking on a run step', {run: 'npm test', thinking: 'high'}],
    ['harness on a run step', {run: 'npm test', harness: 'pi'}],
    ['provider on a run step', {run: 'npm test', provider: 'openai'}],
    ['tools on a run step', {run: 'npm test', tools: ['read']}],
    ['integrations on a run step', {run: 'npm test', integrations: [{include: ['issue_read']}]}],
    ['tools without prompt', {tools: ['read']}],
    ['integrations without prompt', {integrations: [{include: ['issue_read']}]}],
    ['empty tools array', {prompt: 'Fix.', tools: []}],
    ['empty tool name', {prompt: 'Fix.', tools: ['']}],
    ['empty integrations array', {prompt: 'Fix.', integrations: []}],
    ['empty integration include', {prompt: 'Fix.', integrations: [{include: []}]}],
    [
      'empty integration include name',
      {prompt: 'Fix.', integrations: [{include: ['issue_read', '']}]},
    ],
    ['empty integration exclude', {prompt: 'Fix.', integrations: [{include: ['*'], exclude: []}]}],
    [
      'empty integration connection',
      {prompt: 'Fix.', integrations: [{connection: '', include: ['issue_read']}]},
    ],
    [
      'non-boolean integration allow_write',
      {prompt: 'Fix.', integrations: [{include: ['issue_read'], allow_write: 'true'}]},
    ],
    ['unknown harness value', {model: 'claude-opus-4-8', prompt: 'Fix.', harness: 'codex'}],
    ['unknown thinking value', {model: 'claude-opus-4-8', prompt: 'Fix.', thinking: 'ultra'}],
    ['empty model string', {model: '', prompt: 'Fix.'}],
    ['empty provider string', {model: 'gpt-5.5-pro', prompt: 'Fix.', provider: ''}],
  ])('rejects %s', (_label, step) => {
    const result = workflowDocumentSchema.safeParse({
      name: 'agent build',
      jobs: {fix: {steps: [step]}},
    });

    expect(result.success).toBe(false);
  });

  it('reports a clear message for the reserved agent keyword', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'agent build',
      jobs: {fix: {steps: [{agent: 'producer'}]}},
    });

    const messages = result.success ? [] : result.error.issues.map((issue) => issue.message);
    expect(messages.some((message) => message.includes('reserved'))).toBe(true);
  });

  it('reports a missing-prompt message on the prompt path', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'agent build',
      jobs: {fix: {steps: [{model: 'claude-opus-4-8'}]}},
    });

    const promptIssue = result.success
      ? undefined
      : result.error.issues.find((issue) => issue.path.includes('prompt'));
    expect(promptIssue?.message).toContain('prompt');
  });

  it('reports a run-step tools message on the tools path', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'agent build',
      jobs: {fix: {steps: [{run: 'npm test', tools: ['read']}]}},
    });

    const toolsIssue = result.success
      ? undefined
      : result.error.issues.find((issue) => issue.path.includes('tools'));
    expect(toolsIssue?.message).toBe('"tools" is not valid on a run step.');
  });

  it('reports a run-step integrations message on the integrations path', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'agent build',
      jobs: {fix: {steps: [{run: 'npm test', integrations: [{include: ['issue_read']}]}]}},
    });

    const integrationsIssue = result.success
      ? undefined
      : result.error.issues.find((issue) => issue.path.includes('integrations'));
    expect(integrationsIssue?.message).toBe('"integrations" is not valid on a run step.');
  });
});
