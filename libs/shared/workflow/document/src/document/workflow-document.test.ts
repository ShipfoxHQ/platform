import type {
  WorkflowDocument,
  WorkflowDocumentJobCheckout,
  WorkflowDocumentStep,
} from './workflow-document.js';
import {
  WORKFLOW_DOCUMENT_ENV_MAX_ENTRIES,
  WORKFLOW_DOCUMENT_ENV_MAX_SERIALIZED_BYTES,
  WORKFLOW_DOCUMENT_JOB_OUTPUTS_MAX_ENTRIES,
  WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_DEPTH,
  WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_SERIALIZED_BYTES,
  WORKFLOW_DOCUMENT_STEP_OUTPUTS_MAX_ENTRIES,
  WORKFLOW_DOCUMENT_TOOL_WITH_MAX_DEPTH,
  WORKFLOW_DOCUMENT_TOOL_WITH_MAX_SERIALIZED_BYTES,
  workflowDocumentSchema,
  workflowDocumentStepSchema,
  workflowDocumentToolStepWithSchema,
} from './workflow-document.js';

const interpolationOpen = '$' + '{{';
const interpolationClose = '}' + '}';

function interpolation(source: string): string {
  return `${interpolationOpen} ${source} ${interpolationClose}`;
}

describe('workflowDocumentSchema', () => {
  it.each([
    [
      'workflow',
      {
        name: interpolation('inputs.environment'),
        jobs: {deploy: {steps: [{run: 'deploy'}]}},
      },
      'Workflow name must be literal. Move runtime interpolation to run_name.',
    ],
    [
      'job',
      {
        name: 'Deploy application',
        jobs: {
          deploy: {name: interpolation('inputs.environment'), steps: [{run: 'deploy'}]},
        },
      },
      'Job name must be literal. Move runtime interpolation to execution_name.',
    ],
  ] as const)('rejects interpolated static %s names', (_field, document, message) => {
    const result = workflowDocumentSchema.safeParse(document);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toEqual([expect.objectContaining({message})]);
  });

  it('accepts a literal name containing an escaped interpolation-like sequence', () => {
    const escapedInterpolation = `$${interpolation('inputs.environment')}`;
    const result = workflowDocumentSchema.safeParse({
      name: escapedInterpolation,
      jobs: {
        deploy: {name: escapedInterpolation, steps: [{run: 'deploy'}]},
      },
    });

    expect(result.success).toBe(true);
  });

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

  it('types job checkout opt-out', () => {
    const checkout = false satisfies WorkflowDocumentJobCheckout;

    expect(checkout).toBe(false);
  });

  it('accepts working_directory on run, agent, and checkout steps', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'multi-directory build',
      jobs: {
        build: {steps: [{run: 'make test', working_directory: 'api'}]},
        review: {steps: [{prompt: 'Review the API changes.', working_directory: 'api'}]},
        checkout: {steps: [{checkout: {}, working_directory: 'api'}]},
      },
    });

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

  it('rejects too many job output declarations', () => {
    const outputs = Object.fromEntries(
      Array.from({length: WORKFLOW_DOCUMENT_JOB_OUTPUTS_MAX_ENTRIES + 1}, (_, index) => [
        `output_${index}`,
        'value',
      ]),
    );

    const result = workflowDocumentSchema.safeParse({
      name: 'job outputs',
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
          outputs,
        },
      },
    });

    const issue = result.success
      ? undefined
      : result.error.issues.find((candidate) => candidate.path.join('.') === 'jobs.build.outputs');
    expect(issue?.message).toBe(
      `Job outputs cannot define more than ${WORKFLOW_DOCUMENT_JOB_OUTPUTS_MAX_ENTRIES} entries.`,
    );
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

  it('accepts tool output mappings without transforming their expressions', () => {
    const result = workflowDocumentSchema.parse({
      name: 'tool outputs',
      jobs: {
        notify: {
          steps: [
            {
              tool: 'send_message',
              outputs: {message_id: interpolation('result.id')},
            },
          ],
        },
      },
    });

    expect(result.jobs.notify?.steps[0]?.outputs).toEqual({
      message_id: interpolation('result.id'),
    });
  });

  it('rejects declaration outputs on tool steps with the expected form', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'tool outputs',
      jobs: {notify: {steps: [{tool: 'send_message', outputs: {message_id: 'string'}}]}},
    });

    const issue = result.success
      ? undefined
      : result.error.issues.find(
          (candidate) => candidate.path.join('.') === 'jobs.notify.steps.0.outputs',
        );
    expect(issue?.message).toBe('The `outputs` mapping form is required on a tool step.');
  });

  it('rejects mixed output forms on tool steps with the expected form', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'tool outputs',
      jobs: {
        notify: {
          steps: [
            {
              tool: 'send_message',
              outputs: {
                message_id: interpolation('result.id'),
                timestamp: 'string',
              },
            },
          ],
        },
      },
    });

    const issue = result.success
      ? undefined
      : result.error.issues.find(
          (candidate) => candidate.path.join('.') === 'jobs.notify.steps.0.outputs',
        );
    expect(issue?.message).toBe('The `outputs` mapping form is required on a tool step.');
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

  it('counts shared JSON Schema subtrees at each path', () => {
    const sharedSchema = {type: 'string'};
    let deepSchema: Record<string, unknown> = sharedSchema;
    for (let index = 0; index < WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_DEPTH - 1; index += 1) {
      deepSchema = {items: deepSchema};
    }

    const result = workflowDocumentSchema.safeParse({
      name: 'typed outputs',
      jobs: {
        build: {
          steps: [
            {
              run: 'npm run build',
              outputs: {payload: {type: 'json', schema: {deep: deepSchema, shallow: sharedSchema}}},
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
    ['checkout disabled', {checkout: false}],
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

  it('rejects checkout target fields on a job checkout', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'targeted checkout',
      jobs: {
        build: {
          checkout: {
            project: '0192f3a1-0000-0000-0000-000000000000',
            ref: 'refs/heads/main',
            'fetch-depth': 0,
            path: 'target',
            force: true,
            permissions: {contents: 'read'},
            'persist-credentials': false,
          },
          steps: [{run: 'npm test'}],
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it('accepts the shared checkout object on a checkout step', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'targeted checkout',
      jobs: {
        build: {
          checkout: false,
          steps: [
            {
              key: 'fetch-target',
              checkout: {
                connection: 'github',
                repository: 'acme/api',
                ref: 'refs/heads/main',
                'fetch-depth': 0,
                path: 'target',
                permissions: {contents: 'write'},
                'persist-credentials': true,
                force: false,
              },
            },
          ],
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects project with connection or repository in a checkout step', () => {
    for (const checkout of [
      {project: 'project-id', connection: 'github'},
      {project: 'project-id', repository: 'acme/api'},
      {connection: 'github'},
    ]) {
      const result = workflowDocumentSchema.safeParse({
        name: 'invalid checkout target',
        jobs: {
          build: {
            steps: [{checkout}],
          },
        },
      });

      expect(result.success).toBe(false);
    }
  });

  it('parses triggers with the event omitted', () => {
    const workflowDocument = {
      name: 'source subscription',
      triggers: {
        on_any_github_event: {
          source: 'github_acme',
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const result = workflowDocumentSchema.parse(workflowDocument);

    expect(result.triggers?.on_any_github_event).toEqual({source: 'github_acme'});
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
    [
      'checkout disabled with a non-boolean value',
      {
        name: 'simple build',
        jobs: {build: {checkout: true, steps: [{run: 'npm test'}]}},
      },
    ],
    [
      'negative checkout fetch depth',
      {
        name: 'simple build',
        jobs: {build: {checkout: {'fetch-depth': -1}, steps: [{run: 'npm test'}]}},
      },
    ],
    [
      'fractional checkout fetch depth',
      {
        name: 'simple build',
        jobs: {build: {checkout: {'fetch-depth': 1.5}, steps: [{run: 'npm test'}]}},
      },
    ],
    [
      'checkout step with a run command',
      {
        name: 'simple build',
        jobs: {build: {steps: [{checkout: {}, run: 'npm test'}]}},
      },
    ],
    [
      'checkout step with an agent prompt',
      {
        name: 'simple build',
        jobs: {build: {steps: [{checkout: {}, prompt: 'Review the change.'}]}},
      },
    ],
    [
      'checkout step with a session',
      {
        name: 'simple build',
        jobs: {build: {steps: [{checkout: {}, session: 'main'}]}},
      },
    ],
    [
      'checkout step with environment variables',
      {
        name: 'simple build',
        jobs: {build: {steps: [{checkout: {}, env: {CI: true}}]}},
      },
    ],
  ])('rejects %s', (_label, workflowDocument) => {
    const result = workflowDocumentSchema.safeParse(workflowDocument);

    expect(result.success).toBe(false);
  });

  it('rejects an unknown step key', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'simple build',
      jobs: {build: {steps: [{checkout: {path: 'api'}, unknown_step_key: true}]}},
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({code: 'unrecognized_keys', keys: ['unknown_step_key']}),
      ]),
    );
  });

  it.each([
    ['prompt-only agent step', {prompt: 'Fix the failing tests.'}],
    [
      'agent step with working directory',
      {prompt: 'Fix the failing tests.', working_directory: 'api'},
    ],
    ['inline agent step', {model: 'claude-opus-4-8', prompt: 'Fix the failing tests.'}],
    ['agent step with harness', {harness: 'claude', model: 'claude-opus-4-8', prompt: 'Fix it.'}],
    ['agent step with thinking', {model: 'claude-opus-4-8', prompt: 'Fix it.', thinking: 'low'}],
    ['agent step with session', {model: 'claude-opus-4-8', prompt: 'Fix it.', session: 'main'}],
    ['agent step with session object', {prompt: 'Fix it.', session: {key: 'main'}}],
    ['agent step with fork session', {prompt: 'Fix it.', session: {key: 'main', mode: 'fork'}}],
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
    ['agent step with session shorthand', {prompt: 'Fix it.', session: 'main'}],
    [
      'agent step with interpolated session shorthand',
      {prompt: 'Fix it.', session: interpolation('execution_name')},
    ],
    [
      'agent step with interpolated session object',
      {prompt: 'Fix it.', session: {key: interpolation('execution_name'), mode: 'fork'}},
    ],
    [
      'agent step with delimiters inside session interpolation',
      {prompt: 'Fix it.', session: interpolation('{"key": "a}}b"}.key')},
    ],
    [
      'agent step with gate',
      {model: 'claude-opus-4-8', prompt: 'Fix it.', gate: {success: 'step.exit_code == 0'}},
    ],
    ['custom-model-provider model string', {model: 'openrouter/anthropic/claude', prompt: 'Hi.'}],
    ['tool step', {tool: 'send_message'}],
    [
      'tool step with connection and inputs',
      {tool: 'send_message', connection: 'slack_acme', with: {channel_id: 'C0ABC12345'}},
    ],
    [
      'tool step with output mappings',
      {tool: 'get_issue', outputs: {id: interpolation('result.id')}},
    ],
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
    ['tool step on a run step', {run: 'npm test', tool: 'send_message'}],
    ['tool step on an agent step', {tool: 'send_message', prompt: 'Notify the team.'}],
    ['tool step with checkout', {tool: 'send_message', checkout: {}}],
    ['tool step with env', {tool: 'send_message', env: {CI: true}}],
    ['tool step with working directory', {tool: 'send_message', working_directory: 'api'}],
    ['tool step with declaration outputs', {tool: 'send_message', outputs: {id: 'string'}}],
    ['thinking on a run step', {run: 'npm test', thinking: 'high'}],
    ['session on a run step', {run: 'npm test', session: 'main'}],
    ['session on a checkout step', {checkout: {}, session: {key: 'main', mode: 'fork'}}],
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
    ['unknown session mode', {prompt: 'Fix.', session: {key: 'main', mode: 'parallel'}}],
    ['empty session string', {prompt: 'Fix.', session: ''}],
    ['empty session key', {prompt: 'Fix.', session: {key: ''}}],
    ['session key with spaces', {prompt: 'Fix.', session: 'main session'}],
    ['session key with punctuation', {prompt: 'Fix.', session: 'main/session'}],
    ['session key that is too long', {prompt: 'Fix.', session: 'a'.repeat(129)}],
    ['session object key with spaces', {prompt: 'Fix.', session: {key: 'main session'}}],
    [
      'interpolated session key with invalid literal text',
      {prompt: 'Fix.', session: `main session-${interpolation('execution_name')}`},
    ],
    ['session object with unknown key', {prompt: 'Fix.', session: {key: 'main', extra: true}}],
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

  it('accepts tool step fields and preserves the mapping output form', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'tool build',
      jobs: {
        fix: {
          steps: [
            {
              tool: 'send_message',
              connection: 'slack_acme',
              with: {channel_id: 'C0ABC12345'},
              outputs: {ts: interpolation('result.ts')},
            },
          ],
        },
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.jobs.fix?.steps[0]).toMatchObject({
        tool: 'send_message',
        connection: 'slack_acme',
        with: {channel_id: 'C0ABC12345'},
        outputs: {ts: interpolation('result.ts')},
      });
    }
  });

  it.each([
    ['tool', {tool: interpolation('steps.setup.outputs.tool_id')}],
    ['connection', {connection: interpolation('inputs.connection')}],
  ] as const)('rejects an interpolated tool step %s as non-literal with a single issue at the field', (field, step) => {
    const result = workflowDocumentSchema.safeParse({
      name: 'tool build',
      jobs: {fix: {steps: [step]}},
    });

    const issues = result.success ? [] : result.error.issues;
    expect(result.success).toBe(false);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      path: ['jobs', 'fix', 'steps', 0, field],
      message: expect.stringContaining('Interpolation is rejected'),
    });
  });

  it('accepts a literal dotted tool id and connection', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'tool build',
      jobs: {fix: {steps: [{tool: 'issue_read.get', connection: 'github-main'}]}},
    });

    expect(result.success).toBe(true);
  });

  it.each([
    ['run step connection', {run: 'npm test', connection: 'slack_acme'}, 'connection'],
    ['agent step with', {prompt: 'Review the change.', with: {channel_id: 'C0ABC12345'}}, 'with'],
    [
      'checkout step connection',
      {checkout: {repository: 'shipfox/platform'}, connection: 'slack_acme'},
      'connection',
    ],
  ] as const)('rejects tool-only field %s without a tool field', (_label, step, field) => {
    const result = workflowDocumentSchema.safeParse({
      name: 'tool-only field',
      jobs: {build: {steps: [step]}},
    });

    const issues = result.success ? [] : result.error.issues;
    if (_label.startsWith('agent')) {
      expect(issues).toContainEqual(
        expect.objectContaining({
          path: ['jobs', 'build', 'steps', 0, 'tool'],
          message:
            'A tool step requires `tool`; `connection` and `with` are only valid alongside it.',
        }),
      );
      return;
    }

    const issue = issues.find(
      (candidate) => candidate.path.join('.') === `jobs.build.steps.0.${field}`,
    );
    const stepKind = _label.startsWith('checkout') ? 'checkout' : 'run';
    expect(issue?.message).toBe(`"${field}" is not valid on a ${stepKind} step.`);
  });

  it('rejects a method key in a tool step `with` map', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'tool build',
      jobs: {fix: {steps: [{tool: 'issue_write.update', with: {method: 'update'}}]}},
    });

    const issue = result.success
      ? undefined
      : result.error.issues.find(
          (candidate) => candidate.path.join('.') === 'jobs.fix.steps.0.with.method',
        );
    expect(issue?.message).toBe(
      '`method` is not a valid tool input; the server injects it for `family.method` tools.',
    );
  });

  it('rejects tool step `with` maps that exceed the byte cap', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'tool build',
      jobs: {
        fix: {
          steps: [
            {
              tool: 'send_message',
              with: {message: 'x'.repeat(WORKFLOW_DOCUMENT_TOOL_WITH_MAX_SERIALIZED_BYTES)},
            },
          ],
        },
      },
    });

    const issue = result.success
      ? undefined
      : result.error.issues.find(
          (candidate) => candidate.path.join('.') === 'jobs.fix.steps.0.with',
        );
    expect(issue?.message).toBe(
      `Tool \`with\` cannot serialize to more than ${WORKFLOW_DOCUMENT_TOOL_WITH_MAX_SERIALIZED_BYTES} bytes.`,
    );
  });

  it('rejects tool step `with` maps nested deeper than the depth cap', () => {
    let withValue: unknown = {leaf: 'value'};
    for (let index = 0; index < WORKFLOW_DOCUMENT_TOOL_WITH_MAX_DEPTH; index += 1) {
      withValue = {nested: withValue};
    }

    const result = workflowDocumentSchema.safeParse({
      name: 'tool build',
      jobs: {fix: {steps: [{tool: 'get_issue', with: withValue}]}},
    });

    const issue = result.success
      ? undefined
      : result.error.issues.find(
          (candidate) => candidate.path.join('.') === 'jobs.fix.steps.0.with',
        );
    expect(issue?.message).toBe(
      `Tool \`with\` cannot be nested deeper than ${WORKFLOW_DOCUMENT_TOOL_WITH_MAX_DEPTH} levels.`,
    );
  });

  it('accepts a rich tool step `with` shape', () => {
    const result = workflowDocumentToolStepWithSchema.safeParse({
      text: 'value',
      count: 2,
      ready: true,
      missing: null,
      values: ['nested', 3, false],
      record: {enabled: true},
    });

    expect(result.success).toBe(true);
  });

  it('accepts a tool step `with` map at the serialized byte cap', () => {
    const key = 'message';
    const emptyValueBytes = new TextEncoder().encode(JSON.stringify({[key]: ''})).byteLength;
    const result = workflowDocumentToolStepWithSchema.safeParse({
      [key]: 'x'.repeat(WORKFLOW_DOCUMENT_TOOL_WITH_MAX_SERIALIZED_BYTES - emptyValueBytes),
    });

    expect(result.success).toBe(true);
  });

  it('accepts a tool step `with` map at the nesting depth cap', () => {
    const result = workflowDocumentToolStepWithSchema.safeParse(
      nestedToolWith(WORKFLOW_DOCUMENT_TOOL_WITH_MAX_DEPTH),
    );

    expect(result.success).toBe(true);
  });

  it('rejects deeply nested tool inputs without throwing from safeParse', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'deep tool input',
      jobs: {
        build: {
          steps: [{tool: 'send_message', with: nestedToolWith(1000)}],
        },
      },
    });

    const issue = result.success
      ? undefined
      : result.error.issues.find(
          (candidate) => candidate.path.join('.') === 'jobs.build.steps.0.with',
        );
    expect(issue?.message).toBe(
      `Tool \`with\` cannot be nested deeper than ${WORKFLOW_DOCUMENT_TOOL_WITH_MAX_DEPTH} levels.`,
    );
  });

  it('rejects the expression-mapped outputs form on non-tool steps', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'typed outputs',
      jobs: {
        build: {
          steps: [{run: 'npm run build', outputs: {sha: interpolation('steps.build.outputs.sha')}}],
        },
      },
    });

    const issue = result.success
      ? undefined
      : result.error.issues.find(
          (candidate) => candidate.path.join('.') === 'jobs.build.steps.0.outputs',
        );
    expect(issue?.message).toBe('The `outputs` declaration form is required on a run step.');
  });

  it('rejects mixed declaration and expression-mapped outputs on non-tool steps', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'typed outputs',
      jobs: {
        build: {
          steps: [
            {
              run: 'npm run build',
              outputs: {
                sha: 'string',
                ref: interpolation('steps.build.outputs.ref'),
              },
            },
          ],
        },
      },
    });

    const issue = result.success
      ? undefined
      : result.error.issues.find(
          (candidate) => candidate.path.join('.') === 'jobs.build.steps.0.outputs',
        );
    expect(issue?.message).toBe('The `outputs` declaration form is required on a run step.');
  });

  it.each([
    ['run', {run: 'npm run build'}, 'a run'],
    ['agent', {prompt: 'Review the build.'}, 'an agent'],
    ['checkout', {checkout: {}}, 'a checkout'],
  ] as const)('rejects expression-mapped outputs on %s steps', (_kind, step, articleAndKind) => {
    const result = workflowDocumentSchema.safeParse({
      name: 'typed outputs',
      jobs: {
        build: {
          steps: [{...step, outputs: {value: interpolation('result.value')}}],
        },
      },
    });

    const issue = result.success
      ? undefined
      : result.error.issues.find(
          (candidate) => candidate.path.join('.') === 'jobs.build.steps.0.outputs',
        );
    expect(issue?.message).toBe(
      `The \`outputs\` declaration form is required on ${articleAndKind} step.`,
    );
  });

  it('explains the available kind when a step has no kind', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'missing kind',
      jobs: {build: {steps: [{name: 'noop'}]}},
    });

    const issue = result.success ? undefined : result.error.issues[0];
    expect(issue?.message).toBe(
      'A step must define either "run", an agent "prompt", a "checkout", or a "tool".',
    );
  });

  it('reports a non-expression output string at its value path', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'typed outputs',
      jobs: {
        build: {
          steps: [{run: 'npm run build', outputs: {sha: 'not a declaration'}}],
        },
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({path: ['jobs', 'build', 'steps', 0, 'outputs', 'sha']}),
      );
      expect(result.error.issues).not.toContainEqual(
        expect.objectContaining({
          message: 'The `outputs` declaration form is required on a run step.',
        }),
      );
    }
  });

  it('keeps exported document types aligned with schema parse results', () => {
    const document: WorkflowDocument = workflowDocumentSchema.parse({
      name: 'typed workflow',
      jobs: {
        build: {
          steps: [{run: 'npm run build', outputs: {status: 'string'}}],
        },
      },
    });
    const step: WorkflowDocumentStep = workflowDocumentStepSchema.parse({run: 'npm run build'});
    const toolStep: WorkflowDocumentStep = workflowDocumentStepSchema.parse({
      tool: 'send_message',
      outputs: {message_id: interpolation('result.id')},
    });

    expect(document.jobs.build?.steps[0]?.outputs).toEqual({status: {type: 'string'}});
    expect(step.run).toBe('npm run build');
    expect(toolStep.tool).toBe('send_message');
    expect(toolStep.outputs).toEqual({message_id: interpolation('result.id')});
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

  it('reports a run-step session message on the session path', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'agent build',
      jobs: {fix: {steps: [{run: 'npm test', session: 'main'}]}},
    });

    const sessionIssue = result.success
      ? undefined
      : result.error.issues.find((issue) => issue.path.includes('session'));
    expect(sessionIssue?.message).toBe('"session" is not valid on a run step.');
  });

  it('reports a checkout-step conflict on the conflicting field', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'checkout build',
      jobs: {build: {steps: [{checkout: {}, run: 'npm test'}]}},
    });

    const runIssue = result.success
      ? undefined
      : result.error.issues.find((issue) => issue.path.includes('run'));
    expect(runIssue?.message).toBe('"run" is not valid on a checkout step.');
  });
});

function nestedToolWith(depth: number): Record<string, unknown> {
  let value: unknown = {leaf: 'value'};
  for (let currentDepth = 1; currentDepth < depth; currentDepth += 1) {
    value = {nested: value};
  }
  return value as Record<string, unknown>;
}
