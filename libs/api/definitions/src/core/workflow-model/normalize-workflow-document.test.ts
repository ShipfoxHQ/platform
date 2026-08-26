import type {AgentValidationCatalog} from '@shipfox/api-agent-dto/inter-module';
import type {WorkflowDocument} from '@shipfox/workflow-document';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import type {IntegrationValidationContext} from '../entities/integration-context.js';
import type {WorkflowModel} from '../entities/workflow-model.js';
import {
  InvalidWorkflowModelError,
  type WorkflowModelValidationIssue,
} from './invalid-workflow-model-error.js';
import {DEFAULT_JOB_CHECKOUT} from './normalize-job-checkout.js';
import {normalizeWorkflowDocument as normalizeWorkflowDocumentBase} from './normalize-workflow-document.js';

function normalizeWorkflowDocument(
  document: WorkflowDocument,
  options?: Omit<Parameters<typeof normalizeWorkflowDocumentBase>[1], 'agentValidationCatalog'> &
    Partial<Pick<Parameters<typeof normalizeWorkflowDocumentBase>[1], 'agentValidationCatalog'>>,
) {
  return normalizeWorkflowDocumentBase(
    {runner: 'ubuntu-latest', ...document},
    {
      agentValidationCatalog: options?.agentValidationCatalog ?? agentValidationCatalog,
      ...options,
    },
  );
}

function expectInvalid(
  document: WorkflowDocument,
  options?: Omit<Parameters<typeof normalizeWorkflowDocumentBase>[1], 'agentValidationCatalog'> &
    Partial<Pick<Parameters<typeof normalizeWorkflowDocumentBase>[1], 'agentValidationCatalog'>>,
): InvalidWorkflowModelError {
  try {
    normalizeWorkflowDocument(document, options);
    expect.fail('Expected InvalidWorkflowModelError');
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidWorkflowModelError);
    return error as InvalidWorkflowModelError;
  }
}

function normalizeWithDiagnostics(
  document: WorkflowDocument,
  options?: Omit<Parameters<typeof normalizeWorkflowDocumentBase>[1], 'agentValidationCatalog'> &
    Partial<Pick<Parameters<typeof normalizeWorkflowDocumentBase>[1], 'agentValidationCatalog'>>,
): {model: WorkflowModel; diagnostics: WorkflowModelValidationIssue[]} {
  const diagnostics: WorkflowModelValidationIssue[] = [];
  const model = normalizeWorkflowDocument(document, {...options, diagnostics});
  return {model, diagnostics};
}

function interpolation(source: string): string {
  return '$'.concat('{{ ', source, ' }}');
}

const workflowInterpolation = interpolation;

const integrationValidationContext = {
  agentToolSelectionCatalogs: new Map([
    [
      'github',
      {
        selectors: [
          {token: 'issue_read', kind: 'family', sensitivity: 'read', sensitive: false},
          {token: 'issue_read.*', kind: 'family_wildcard', sensitivity: 'read', sensitive: false},
          {token: 'issue_read.get', kind: 'method', sensitivity: 'read', sensitive: false},
          {token: 'issue_write', kind: 'family', sensitivity: 'write', sensitive: false},
          {token: 'issue_write.create', kind: 'method', sensitivity: 'write', sensitive: false},
          {token: 'list_issues', kind: 'standalone', sensitivity: 'read', sensitive: false},
          {
            token: 'merge_pull_request',
            kind: 'standalone',
            sensitivity: 'write',
            sensitive: true,
          },
        ],
      },
    ],
    [
      'linear',
      {
        selectors: [
          {token: 'get_issue', kind: 'standalone', sensitivity: 'read', sensitive: false},
          {token: 'save_comment', kind: 'standalone', sensitivity: 'write', sensitive: false},
        ],
      },
    ],
    [
      'jira',
      {
        selectors: [
          {token: 'get_issue', kind: 'standalone', sensitivity: 'read', sensitive: false},
          {token: 'add_comment', kind: 'standalone', sensitivity: 'write', sensitive: false},
        ],
      },
    ],
  ]),
  agentToolCatalogs: new Map([
    [
      'github',
      {
        tools: [
          {
            id: 'issue_read',
            description: 'Read issues',
            sensitivity: 'read',
            sensitive: false,
            requiredScope: 'read',
            inputSchema: {
              type: 'object',
              properties: {
                owner: {type: 'string'},
                repo: {type: 'string'},
                number: {type: 'integer'},
              },
              required: ['owner', 'repo'],
            },
            methods: [
              {
                id: 'get',
                description: 'Get an issue',
                sensitivity: 'read',
                sensitive: false,
                requiredScope: 'read',
              },
              {
                id: 'create',
                description: 'Create an issue',
                sensitivity: 'write',
                sensitive: false,
                requiredScope: 'write',
              },
            ],
          },
          {
            id: 'issue_write',
            description: 'Write issues',
            sensitivity: 'write',
            sensitive: false,
            requiredScope: 'write',
            inputSchema: {
              type: 'object',
              properties: {
                owner: {type: 'string'},
                repo: {type: 'string'},
                title: {type: 'string'},
                labels: {type: 'array', items: {type: 'string'}},
              },
              required: ['owner', 'repo'],
              additionalProperties: false,
            },
            methods: [
              {
                id: 'create',
                description: 'Create an issue',
                sensitivity: 'write',
                sensitive: false,
                requiredScope: 'write',
              },
            ],
            outputSchema: {
              type: 'object',
              properties: {number: {type: 'integer'}},
              required: ['number'],
              additionalProperties: false,
            },
          },
          {
            id: 'list_issues',
            description: 'List issues',
            sensitivity: 'read',
            sensitive: false,
            requiredScope: 'read',
            inputSchema: {
              type: 'object',
              properties: {limit: {type: 'integer'}},
            },
          },
          {
            id: 'merge_pull_request',
            description: 'Merge a pull request',
            sensitivity: 'write',
            sensitive: true,
            requiredScope: 'write',
            inputSchema: {
              type: 'object',
              properties: {
                owner: {type: 'string'},
                repo: {type: 'string'},
                pull_number: {type: 'integer'},
                merge_method: {type: 'string'},
              },
              required: ['owner', 'repo', 'pull_number'],
            },
          },
        ],
      },
    ],
    [
      'linear',
      {
        tools: [
          {
            id: 'get_issue',
            description: 'Get an issue',
            sensitivity: 'read',
            sensitive: false,
            requiredScope: 'read',
            inputSchema: {
              type: 'object',
              properties: {id: {type: 'string'}},
              required: ['id'],
            },
            outputSchema: {
              type: 'object',
              properties: {
                identifier: {type: 'string'},
                description: {type: 'string'},
                state: {type: 'string'},
              },
            },
          },
          {
            id: 'save_comment',
            description: 'Save a comment',
            sensitivity: 'write',
            sensitive: false,
            requiredScope: 'write',
            inputSchema: {
              type: 'object',
              properties: {issueId: {type: 'string'}, body: {type: 'string'}},
              required: ['issueId', 'body'],
            },
          },
        ],
      },
    ],
    [
      'jira',
      {
        tools: [
          {
            id: 'get_issue',
            description: 'Get an issue',
            sensitivity: 'read',
            sensitive: false,
            requiredScope: 'read',
            inputSchema: {type: 'object', properties: {id: {type: 'string'}}},
          },
          {
            id: 'add_comment',
            description: 'Add a comment',
            sensitivity: 'write',
            sensitive: false,
            requiredScope: 'write',
            inputSchema: {
              type: 'object',
              properties: {id: {type: 'string'}, body: {type: 'string'}},
            },
          },
        ],
      },
    ],
  ]),
  workspaceConnectionSnapshot: new Map([
    ['github-main', {id: 'conn_1', provider: 'github', capabilities: ['agent_tools']}],
    ['sentry-main', {id: 'conn_2', provider: 'sentry', capabilities: []}],
    ['linear-main', {id: 'conn_3', provider: 'linear', capabilities: ['agent_tools']}],
    ['jira-main', {id: 'conn_4', provider: 'jira', capabilities: ['agent_tools']}],
    ['deploy-hook', {id: 'conn_5', provider: 'webhook', capabilities: []}],
  ]),
  eventCatalogs: new Map([
    ['github', new Set(['push', 'pull_request.opened'])],
    ['sentry', new Set(['issue.created'])],
    ['linear', new Set(['Issue'])],
    ['jira', new Set(['jira:issue_created'])],
    ['webhook', new Set(['received'])],
  ]),
  fixedEventProviders: new Set(['webhook']),
  defaultConnectionSlug: 'github-main',
} satisfies IntegrationValidationContext;

describe('normalizeWorkflowDocument', () => {
  it('rejects interpolated workflow names in favor of run_name', () => {
    const error = expectInvalid({
      name: interpolation('inputs.environment'),
      jobs: {build: {steps: [{run: 'build'}]}},
    });

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-interpolation-template',
        message: 'Workflow name must be literal. Move runtime interpolation to run_name.',
        path: ['name'],
      }),
    ]);
  });

  it('rejects unterminated workflow-name templates with the migration guidance', () => {
    const error = expectInvalid({
      name: '$' + '{{ unterminated',
      jobs: {build: {steps: [{run: 'build'}]}},
    });

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-interpolation-template',
        message: 'Workflow name must be literal. Move runtime interpolation to run_name.',
        path: ['name'],
        details: expect.objectContaining({reason: 'unterminated opener'}),
      }),
    ]);
  });

  it('rejects unterminated job-name templates with the migration guidance', () => {
    const error = expectInvalid({
      name: 'Deploy',
      jobs: {
        build: {name: '$' + '{{ unterminated', steps: [{run: 'build'}]},
      },
    });

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-interpolation-template',
        message: 'Job name must be literal. Move runtime interpolation to execution_name.',
        path: ['jobs', 'build', 'name'],
        details: expect.objectContaining({reason: 'unterminated opener'}),
      }),
    ]);
  });

  it('normalizes workflow run and job execution name templates', () => {
    const model = normalizeWorkflowDocument({
      name: 'Deploy application',
      run_name: `Deploy ${interpolation('inputs.environment')}`,
      jobs: {
        deploy: {
          name: 'Deploy',
          execution_name: `Deploy ${interpolation('event.environment')}`,
          steps: [{run: 'deploy'}],
        },
      },
    });

    expect(model.runName).toMatchObject([
      {kind: 'literal', value: 'Deploy '},
      {kind: 'deferred', roots: ['inputs'], fillTarget: 'run-creation'},
    ]);
    expect(model.jobs[0]?.executionName).toMatchObject([
      {kind: 'literal', value: 'Deploy '},
      {kind: 'deferred', roots: ['event'], fillTarget: 'execution-creation'},
    ]);
  });

  it('preserves literal workflow run and job execution names', () => {
    const model = normalizeWorkflowDocument({
      name: 'Workflow',
      run_name: 'Static run name',
      jobs: {
        build: {
          execution_name: 'Static execution name',
          steps: [{run: 'build'}],
        },
      },
    });

    expect(model.runName).toEqual([{kind: 'literal', value: 'Static run name'}]);
    expect(model.jobs[0]?.executionName).toEqual([
      {kind: 'literal', value: 'Static execution name'},
    ]);
  });

  it('unescapes literal workflow and job names', () => {
    const escapedName = `$${interpolation('inputs.environment')}`;
    const model = normalizeWorkflowDocument({
      name: escapedName,
      jobs: {
        build: {name: escapedName, steps: [{run: 'build'}]},
      },
    });

    expect(model.name).toBe(interpolation('inputs.environment'));
    expect(model.jobs[0]?.name).toBe(interpolation('inputs.environment'));
  });

  it.each([
    [
      'run_name',
      {
        name: 'Workflow',
        run_name: interpolation('steps.build.outputs.name'),
        jobs: {build: {steps: [{run: 'build'}]}},
      },
    ],
    [
      'execution_name',
      {
        name: 'Workflow',
        jobs: {
          build: {
            execution_name: interpolation('steps.build.outputs.name'),
            steps: [{run: 'build'}],
          },
        },
      },
    ],
  ] as const)('rejects unavailable context in %s', (_field, document) => {
    const error = expectInvalid(document as unknown as WorkflowDocument);
    expect(error.issues).toEqual([
      expect.objectContaining({code: 'context-unavailable-at-fill-site'}),
    ]);
  });

  it('allows computed access to unrelated dynamic-name context fields', () => {
    const model = normalizeWorkflowDocument({
      name: 'Workflow',
      run_name: interpolation('run["id"]'),
      jobs: {
        build: {
          execution_name: interpolation('execution["status"]'),
          steps: [{run: 'build'}],
        },
      },
    });

    expect(model.runName).toMatchObject([{kind: 'deferred', roots: ['run']}]);
    expect(model.jobs[0]?.executionName).toMatchObject([{kind: 'deferred', roots: ['execution']}]);
  });

  it.each([
    [
      'run_name',
      {
        name: 'Workflow',
        run_name: interpolation('run.name'),
        jobs: {build: {steps: [{run: 'build'}]}},
      },
    ],
    [
      'run_name bracket access',
      {
        name: 'Workflow',
        run_name: interpolation('run["name"]'),
        jobs: {build: {steps: [{run: 'build'}]}},
      },
    ],
    [
      'execution_name',
      {
        name: 'Workflow',
        jobs: {
          build: {
            execution_name: interpolation('execution.name'),
            steps: [{run: 'build'}],
          },
        },
      },
    ],
    [
      'execution_name bracket access',
      {
        name: 'Workflow',
        jobs: {
          build: {
            execution_name: interpolation('execution["name"]'),
            steps: [{run: 'build'}],
          },
        },
      },
    ],
  ] as const)('rejects dynamic-name self-reference in %s', (_field, document) => {
    const error = expectInvalid(document as unknown as WorkflowDocument);
    expect(error.issues).toEqual([expect.objectContaining({code: 'dynamic-name-self-reference'})]);
  });

  it('normalizes a workflow document into a WorkflowModel', () => {
    const document: WorkflowDocument = {
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
          steps: [{run: 'npm install'}, {key: 'build', run: 'npm run build'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model).toEqual({
      kind: 'workflow',
      name: 'simple build',
      triggers: [
        {
          id: 'main-push',
          key: 'main_push',
          source: 'github',
          event: 'push',
          filter: 'event.ref == "refs/heads/main"',
        },
      ],
      jobs: [
        {
          id: 'build',
          mode: 'one_shot',
          key: 'build',
          runner: ['ubuntu-latest'],
          checkout: DEFAULT_JOB_CHECKOUT,
          dependencies: [],
          steps: [
            {
              id: 'build-step-1',
              kind: 'run',
              command: {kind: 'shell', value: 'npm install'},
            },
            {
              id: 'build-build',
              key: 'build',
              kind: 'run',
              command: {kind: 'shell', value: 'npm run build'},
            },
          ],
        },
      ],
      dependencies: [],
    });
  });

  it('normalizes inline agent steps without resolving contextual defaults', () => {
    const document: WorkflowDocument = {
      name: 'agent build',
      jobs: {
        fix: {
          steps: [
            {key: 'plan', prompt: 'Plan the fix.'},
            {
              key: 'implement',
              harness: 'claude',
              model: 'claude-opus-4-8',
              prompt: 'Fix the failing tests.',
              tools: ['Read', 'Grep'],
            },
            {
              key: 'review',
              harness: 'claude',
              model: 'claude-opus-4-8',
              provider: 'anthropic',
              prompt: 'Review the fix.',
              thinking: 'low',
              gate: {success: 'step.exit_code == 0', on_failure: {restart_from: 'implement'}},
            },
          ],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[0]).toEqual({
      id: 'fix-plan',
      key: 'plan',
      kind: 'agent',
      prompt: 'Plan the fix.',
    });
    expect(model.jobs[0]?.steps[1]).toEqual({
      id: 'fix-implement',
      key: 'implement',
      kind: 'agent',
      harness: 'claude',
      model: 'claude-opus-4-8',
      prompt: 'Fix the failing tests.',
      tools: ['Read', 'Grep'],
    });
    expect(model.jobs[0]?.steps[2]).toMatchObject({
      id: 'fix-review',
      kind: 'agent',
      harness: 'claude',
      provider: 'anthropic',
      thinking: 'low',
      gate: {onFailure: {restartFrom: 'implement'}},
    });
  });

  it('normalizes agent step session shorthand into a resume session', () => {
    const model = normalizeWorkflowDocument({
      name: 'session build',
      jobs: {
        plan: {
          steps: [{key: 'plan', prompt: 'Draft a plan.', session: 'main'}],
        },
      },
    });

    expect(model.jobs[0]?.steps[0]).toMatchObject({
      id: 'plan-plan',
      kind: 'agent',
      session: {key: [{kind: 'literal', value: 'main'}], mode: 'resume'},
    });
  });

  it('normalizes agent step session object forms with explicit and default modes', () => {
    const model = normalizeWorkflowDocument({
      name: 'session build',
      jobs: {
        plan: {
          steps: [
            {key: 'resume', prompt: 'Plan.', session: {key: 'main', mode: 'resume'}},
            {key: 'fork', prompt: 'Plan.', session: {key: 'main', mode: 'fork'}},
            {key: 'default', prompt: 'Plan.', session: {key: 'main'}},
          ],
        },
      },
    });

    const steps = model.jobs[0]?.steps;
    expect(steps?.[0]).toMatchObject({
      session: {key: [{kind: 'literal', value: 'main'}], mode: 'resume'},
    });
    expect(steps?.[1]).toMatchObject({
      session: {key: [{kind: 'literal', value: 'main'}], mode: 'fork'},
    });
    expect(steps?.[2]).toMatchObject({
      session: {key: [{kind: 'literal', value: 'main'}], mode: 'resume'},
    });
  });

  it.each([
    ['contains spaces', 'main session'],
    ['contains punctuation', 'main/session'],
    ['exceeds the maximum length', 'a'.repeat(129)],
  ])('rejects a literal agent session key that %s', (_reason, key) => {
    const error = expectInvalid({
      name: 'session build',
      jobs: {
        plan: {
          steps: [{prompt: 'Plan.', session: key}],
        },
      },
    });

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-agent-session-key',
        path: ['jobs', 'plan', 'steps', 0, 'session'],
      }),
    ]);
  });

  it('rejects an invalid literal object-form agent session key on the key path', () => {
    const error = expectInvalid({
      name: 'session build',
      jobs: {
        plan: {
          steps: [{prompt: 'Plan.', session: {key: 'main session', mode: 'fork'}}],
        },
      },
    });

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-agent-session-key',
        path: ['jobs', 'plan', 'steps', 0, 'session', 'key'],
      }),
    ]);
  });

  it.each([
    ['contains spaces', `main session-${interpolation('event.issue.number')}`],
    [
      'exceeds the maximum literal length',
      `${'a'.repeat(129)}-${interpolation('event.issue.number')}`,
    ],
  ])('rejects an interpolated agent session key whose literal text %s', (_reason, key) => {
    const error = expectInvalid({
      name: 'session build',
      jobs: {
        triage: {
          steps: [{prompt: 'Triage.', session: key}],
        },
      },
    });

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-agent-session-key',
        path: ['jobs', 'triage', 'steps', 0, 'session'],
      }),
    ]);
  });

  it('parses interpolated agent session keys as step-dispatch templates', () => {
    const model = normalizeWorkflowDocument({
      name: 'session build',
      jobs: {
        triage: {
          steps: [{prompt: 'Triage.', session: `triage-${interpolation('event.issue.number')}`}],
        },
      },
    });

    expect(model.jobs[0]?.steps[0]).toMatchObject({
      kind: 'agent',
      session: {
        key: [
          {kind: 'literal', value: 'triage-'},
          {kind: 'deferred', expression: {source: 'event.issue.number'}, roots: ['event']},
        ],
        mode: 'resume',
      },
    });
  });

  it('accepts session interpolation with delimiters inside an expression', () => {
    const model = normalizeWorkflowDocument({
      name: 'session build',
      jobs: {
        triage: {
          steps: [
            {
              prompt: 'Triage.',
              session: interpolation('{"key": "a}}b"}.key'),
            },
          ],
        },
      },
    });

    expect(model.jobs[0]?.steps[0]).toMatchObject({
      kind: 'agent',
      session: {
        key: [
          {
            kind: 'deferred',
            expression: {source: '{"key": "a}}b"}.key'},
          },
        ],
        mode: 'resume',
      },
    });
  });

  it('reports invalid interpolation in agent session keys on the session path', () => {
    const error = expectInvalid({
      name: 'session build',
      jobs: {
        triage: {
          steps: [{prompt: 'Triage.', session: 'triage-${{ broken'}],
        },
      },
    });

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-interpolation-template',
        path: ['jobs', 'triage', 'steps', 0, 'session'],
      }),
    ]);
  });

  it('parses interpolated object-form agent session keys on the key path', () => {
    const model = normalizeWorkflowDocument({
      name: 'session build',
      jobs: {
        triage: {
          steps: [
            {
              prompt: 'Triage.',
              session: {key: `triage-${interpolation('event.issue.number')}`, mode: 'fork'},
            },
          ],
        },
      },
    });

    expect(model.jobs[0]?.steps[0]).toMatchObject({
      kind: 'agent',
      session: {
        key: [
          {kind: 'literal', value: 'triage-'},
          {kind: 'deferred', expression: {source: 'event.issue.number'}, roots: ['event']},
        ],
        mode: 'fork',
      },
    });
  });

  it('reports invalid interpolation in object-form agent session keys on the key path', () => {
    const error = expectInvalid({
      name: 'session build',
      jobs: {
        triage: {
          steps: [{prompt: 'Triage.', session: {key: 'triage-${{ broken'}}],
        },
      },
    });

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-interpolation-template',
        path: ['jobs', 'triage', 'steps', 0, 'session', 'key'],
      }),
    ]);
  });

  describe('agent session sharing', () => {
    it('reports parallel resume of a static session key across unordered jobs', () => {
      const error = expectInvalid({
        name: 'session sharing',
        jobs: {
          plan: {
            steps: [{key: 'plan', prompt: 'Draft a plan.', session: 'main'}],
          },
          implement: {
            steps: [{key: 'implement', prompt: 'Implement the plan.', session: 'main'}],
          },
        },
      });

      expect(error.issues).toEqual([
        {
          code: 'agent-session-parallel-resume',
          message:
            'Agent steps "plan" (job "plan") and "implement" (job "implement") both resume session key "main", but their jobs have no transitive "needs" ancestry, so they can run in parallel and would conflict on the session. Add a "needs" edge between the jobs, fork the session on one step, or use distinct session keys.',
          path: ['jobs', 'implement', 'steps', 0, 'session'],
          details: {
            key: 'main',
            jobs: ['plan', 'implement'],
            stepIndexes: [0, 0],
          },
          severity: 'error',
          scope: 'definition',
        },
      ]);
    });

    it('labels unkeyed steps by index in the parallel resume issue', () => {
      const error = expectInvalid({
        name: 'session sharing',
        jobs: {
          plan: {
            steps: [{prompt: 'Plan.', session: 'main'}],
          },
          implement: {
            steps: [{prompt: 'Implement.', session: 'main'}],
          },
        },
      });

      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'agent-session-parallel-resume',
          message:
            'Agent steps 0 (job "plan") and 0 (job "implement") both resume session key "main", but their jobs have no transitive "needs" ancestry, so they can run in parallel and would conflict on the session. Add a "needs" edge between the jobs, fork the session on one step, or use distinct session keys.',
        }),
      ]);
    });

    it('allows shared resume keys when one job directly needs the other', () => {
      const model = normalizeWorkflowDocument({
        name: 'session sharing',
        jobs: {
          plan: {
            steps: [{key: 'plan', prompt: 'Draft a plan.', session: 'main'}],
          },
          implement: {
            needs: 'plan',
            steps: [{key: 'implement', prompt: 'Implement the plan.', session: 'main'}],
          },
        },
      });

      expect(model.jobs).toHaveLength(2);
    });

    it('allows shared resume keys across transitively ordered jobs', () => {
      const model = normalizeWorkflowDocument({
        name: 'session sharing',
        jobs: {
          plan: {
            steps: [{key: 'plan', prompt: 'Plan.', session: 'main'}],
          },
          review: {
            needs: 'plan',
            steps: [{key: 'review', prompt: 'Review.', session: 'main'}],
          },
          implement: {
            needs: 'review',
            steps: [{key: 'implement', prompt: 'Implement.', session: 'main'}],
          },
        },
      });

      expect(model.jobs).toHaveLength(3);
    });

    it('does not report parallel resume when one step forks the session', () => {
      const model = normalizeWorkflowDocument({
        name: 'session sharing',
        jobs: {
          plan: {
            steps: [{key: 'plan', prompt: 'Plan.', session: {key: 'main', mode: 'fork'}}],
          },
          implement: {
            steps: [{key: 'implement', prompt: 'Implement.', session: 'main'}],
          },
        },
      });

      expect(model.jobs).toHaveLength(2);
    });

    it('compares interpolated session key templates literally for parallel resume', () => {
      const key = `triage-${interpolation('event.issue.number')}`;
      const error = expectInvalid({
        name: 'session sharing',
        jobs: {
          triage: {
            steps: [{key: 'triage', prompt: 'Triage.', session: key}],
          },
          comment: {
            steps: [{key: 'comment', prompt: 'Comment.', session: key}],
          },
        },
      });

      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'agent-session-parallel-resume',
          path: ['jobs', 'comment', 'steps', 0, 'session'],
          details: {key, jobs: ['triage', 'comment'], stepIndexes: [0, 0]},
        }),
      ]);
    });

    it('ignores runtime-only collisions between distinct session key templates', () => {
      const model = normalizeWorkflowDocument({
        name: 'session sharing',
        jobs: {
          triage: {
            steps: [
              {
                key: 'triage',
                prompt: 'Triage.',
                session: `triage-${interpolation('event.issue.number')}`,
              },
            ],
          },
          comment: {
            steps: [
              {
                key: 'comment',
                prompt: 'Comment.',
                session: `comment-${interpolation('event.issue.number')}`,
              },
            ],
          },
        },
      });

      expect(model.jobs).toHaveLength(2);
    });

    it('reports literal harness disagreement between steps sharing a static session key', () => {
      const error = expectInvalid({
        name: 'session sharing',
        jobs: {
          plan: {
            steps: [{key: 'plan', prompt: 'Plan.', session: 'main', harness: 'pi'}],
          },
          implement: {
            needs: 'plan',
            steps: [{key: 'implement', prompt: 'Implement.', session: 'main', harness: 'claude'}],
          },
        },
      });

      expect(error.issues).toEqual([
        {
          code: 'agent-session-harness-mismatch',
          message:
            'Agent steps "plan" (job "plan") and "implement" (job "implement") share session key "main" but declare different harnesses: "pi" and "claude". A session is pinned to the harness that created it. Declare the same harness on every step that shares the session key.',
          path: ['jobs', 'implement', 'steps', 0, 'session'],
          details: {
            key: 'main',
            jobs: ['plan', 'implement'],
            stepIndexes: [0, 0],
            harnesses: ['pi', 'claude'],
          },
          severity: 'error',
          scope: 'definition',
        },
      ]);
    });

    it('accepts steps sharing a static session key with the same harness', () => {
      const model = normalizeWorkflowDocument({
        name: 'session sharing',
        jobs: {
          plan: {
            steps: [{key: 'plan', prompt: 'Plan.', session: 'main', harness: 'pi'}],
          },
          implement: {
            needs: 'plan',
            steps: [{key: 'implement', prompt: 'Implement.', session: 'main', harness: 'pi'}],
          },
        },
      });

      expect(model.jobs).toHaveLength(2);
    });

    it('does not report harness disagreement when one step omits the harness', () => {
      const model = normalizeWorkflowDocument({
        name: 'session sharing',
        jobs: {
          plan: {
            steps: [{key: 'plan', prompt: 'Plan.', session: 'main', harness: 'pi'}],
          },
          implement: {
            needs: 'plan',
            steps: [{key: 'implement', prompt: 'Implement.', session: 'main'}],
          },
        },
      });

      expect(model.jobs).toHaveLength(2);
    });

    it('reports both parallel resume and harness disagreement for a conflicting pair', () => {
      const error = expectInvalid({
        name: 'session sharing',
        jobs: {
          plan: {
            steps: [{key: 'plan', prompt: 'Plan.', session: 'main', harness: 'pi'}],
          },
          implement: {
            steps: [{key: 'implement', prompt: 'Implement.', session: 'main', harness: 'claude'}],
          },
        },
      });

      expect(error.issues.map(({code}) => code)).toEqual([
        'agent-session-parallel-resume',
        'agent-session-harness-mismatch',
      ]);
    });

    it('does not report parallel resume for statically invalid session keys', () => {
      const error = expectInvalid({
        name: 'session sharing',
        jobs: {
          plan: {
            steps: [{prompt: 'Plan.', session: 'main session'}],
          },
          implement: {
            steps: [{prompt: 'Implement.', session: 'main session'}],
          },
        },
      });

      expect(error.issues.map(({code}) => code)).toEqual([
        'invalid-agent-session-key',
        'invalid-agent-session-key',
      ]);
    });

    it('treats a listening job as ordered relative to its needs dependents', () => {
      const model = normalizeWorkflowDocument({
        name: 'session sharing',
        jobs: {
          plan: {
            steps: [{key: 'plan', prompt: 'Plan.', session: 'main'}],
          },
          review: {
            needs: 'plan',
            listening: {
              on: [{source: 'github', event: 'pull_request_review'}],
              until: [
                {source: 'github', event: 'pull_request', filter: 'event.action == "closed"'},
              ],
            },
            steps: [{key: 'address', prompt: 'Address the review.', session: 'main'}],
          },
        },
      });

      expect(model.jobs).toHaveLength(2);
    });

    it('reports parallel resume between a listening job and an unordered sibling', () => {
      const error = expectInvalid({
        name: 'session sharing',
        jobs: {
          plan: {
            steps: [{key: 'plan', prompt: 'Plan.', session: 'main'}],
          },
          review: {
            needs: 'plan',
            listening: {
              on: [{source: 'github', event: 'pull_request_review'}],
              until: [
                {source: 'github', event: 'pull_request', filter: 'event.action == "closed"'},
              ],
            },
            steps: [{key: 'address', prompt: 'Address the review.', session: 'main'}],
          },
          comment: {
            needs: 'plan',
            steps: [{key: 'comment', prompt: 'Comment.', session: 'main'}],
          },
        },
      });

      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'agent-session-parallel-resume',
          path: ['jobs', 'comment', 'steps', 0, 'session'],
          details: {key: 'main', jobs: ['review', 'comment'], stepIndexes: [0, 0]},
        }),
      ]);
    });

    it('reports harness disagreement between steps of one job', () => {
      const error = expectInvalid({
        name: 'session sharing',
        jobs: {
          implement: {
            steps: [
              {key: 'plan', prompt: 'Plan.', session: 'main', harness: 'pi'},
              {key: 'implement', prompt: 'Implement.', session: 'main', harness: 'claude'},
            ],
          },
        },
      });

      expect(error.issues).toEqual([
        {
          code: 'agent-session-harness-mismatch',
          message:
            'Agent steps "plan" (job "implement") and "implement" (job "implement") share session key "main" but declare different harnesses: "pi" and "claude". A session is pinned to the harness that created it. Declare the same harness on every step that shares the session key.',
          path: ['jobs', 'implement', 'steps', 1, 'session'],
          details: {
            key: 'main',
            jobs: ['implement', 'implement'],
            stepIndexes: [0, 1],
            harnesses: ['pi', 'claude'],
          },
          severity: 'error',
          scope: 'definition',
        },
      ]);
    });

    it('treats object-form sessions with an implicit resume mode as resume across jobs', () => {
      const error = expectInvalid({
        name: 'session sharing',
        jobs: {
          plan: {
            steps: [{key: 'plan', prompt: 'Plan.', session: {key: 'main'}}],
          },
          implement: {
            steps: [{key: 'implement', prompt: 'Implement.', session: {key: 'main'}}],
          },
        },
      });

      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'agent-session-parallel-resume',
          path: ['jobs', 'implement', 'steps', 0, 'session'],
          details: {key: 'main', jobs: ['plan', 'implement'], stepIndexes: [0, 0]},
        }),
      ]);
    });

    it('treats object-form sessions with an explicit resume mode as resume across jobs', () => {
      const error = expectInvalid({
        name: 'session sharing',
        jobs: {
          plan: {
            steps: [{key: 'plan', prompt: 'Plan.', session: {key: 'main', mode: 'resume'}}],
          },
          implement: {
            steps: [
              {key: 'implement', prompt: 'Implement.', session: {key: 'main', mode: 'resume'}},
            ],
          },
        },
      });

      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'agent-session-parallel-resume',
          path: ['jobs', 'implement', 'steps', 0, 'session'],
          details: {key: 'main', jobs: ['plan', 'implement'], stepIndexes: [0, 0]},
        }),
      ]);
    });

    it('reports harness disagreement between fork-mode steps sharing a static session key', () => {
      const error = expectInvalid({
        name: 'session sharing',
        jobs: {
          plan: {
            steps: [
              {key: 'plan', prompt: 'Plan.', session: {key: 'main', mode: 'fork'}, harness: 'pi'},
            ],
          },
          implement: {
            steps: [
              {
                key: 'implement',
                prompt: 'Implement.',
                session: {key: 'main', mode: 'fork'},
                harness: 'claude',
              },
            ],
          },
        },
      });

      expect(error.issues).toEqual([
        expect.objectContaining({code: 'agent-session-harness-mismatch'}),
      ]);
    });

    it('reports harness disagreement between a fork-mode step and a resume-mode step', () => {
      const error = expectInvalid({
        name: 'session sharing',
        jobs: {
          plan: {
            steps: [
              {key: 'plan', prompt: 'Plan.', session: {key: 'main', mode: 'fork'}, harness: 'pi'},
            ],
          },
          implement: {
            steps: [{key: 'implement', prompt: 'Implement.', session: 'main', harness: 'claude'}],
          },
        },
      });

      expect(error.issues).toEqual([
        expect.objectContaining({code: 'agent-session-harness-mismatch'}),
      ]);
    });

    it('does not stack sharing issues on keys with invalid interpolation expressions', () => {
      const key = `triage-${interpolation('event.issue.number +')}`;
      const error = expectInvalid({
        name: 'session sharing',
        jobs: {
          triage: {
            steps: [{key: 'triage', prompt: 'Triage.', session: key}],
          },
          comment: {
            steps: [{key: 'comment', prompt: 'Comment.', session: key}],
          },
        },
      });

      expect(error.issues.map(({code}) => code)).toEqual([
        'invalid-interpolation-template',
        'invalid-interpolation-template',
      ]);
    });

    it('does not report parallel resume for identical templates referencing per-job context', () => {
      const key = `triage-${interpolation('steps.assign.outputs.task_id')}`;
      const model = normalizeWorkflowDocument({
        name: 'session sharing',
        jobs: {
          triage: {
            steps: [
              {key: 'assign', run: 'assign the task'},
              {key: 'triage', prompt: 'Triage.', session: key},
            ],
          },
          comment: {
            steps: [
              {key: 'assign', run: 'assign the task'},
              {key: 'comment', prompt: 'Comment.', session: key},
            ],
          },
        },
      });

      expect(model.jobs).toHaveLength(2);
    });

    it('bounds issue generation for large documents sharing one session key', () => {
      const jobs: Record<string, {steps: {key: string; prompt: string; session: string}[]}> = {};
      for (let index = 0; index < 3000; index += 1) {
        jobs[`job_${index}`] = {
          steps: [{key: `step_${index}`, prompt: `Prompt ${index}.`, session: 'main'}],
        };
      }

      const error = expectInvalid({name: 'session sharing', jobs});
      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'agent-session-parallel-resume',
          details: {key: 'main', jobs: ['job_0', 'job_1'], stepIndexes: [0, 0]},
        }),
      ]);
    });

    it('still examines a shared key after many unrelated session keys', () => {
      // Each unrelated key is shared by two jobs so its pair is actually
      // evaluated (a single-step key never forms a pair), and the second job
      // needs the first so those pairs stay conflict-free. Grouping confines
      // pair evaluation to same-key pairs, so the ~501 pairs of this document
      // stay far below MAX_SESSION_SHARING_PAIR_EVALUATIONS and the last key
      // is reached; a naive all-pairs loop would evaluate every step pair
      // (~501k), trip the budget, and return before the 'main' group, so this
      // guards the grouping that keeps later shared keys visible.
      const jobs: Record<
        string,
        {steps: {key: string; prompt: string; session: string}[]; needs?: string}
      > = {};
      for (let index = 0; index < 500; index += 1) {
        jobs[`job_${index}_a`] = {
          steps: [
            {key: `step_${index}_a`, prompt: `Prompt ${index}.`, session: `session_${index}`},
          ],
        };
        jobs[`job_${index}_b`] = {
          needs: `job_${index}_a`,
          steps: [
            {key: `step_${index}_b`, prompt: `Prompt ${index}.`, session: `session_${index}`},
          ],
        };
      }
      jobs.triage = {steps: [{key: 'triage', prompt: 'Triage.', session: 'main'}]};
      jobs.comment = {steps: [{key: 'comment', prompt: 'Comment.', session: 'main'}]};

      const error = expectInvalid({name: 'session sharing', jobs});
      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'agent-session-parallel-resume',
          path: ['jobs', 'comment', 'steps', 0, 'session'],
          details: {key: 'main', jobs: ['triage', 'comment'], stepIndexes: [0, 0]},
        }),
      ]);
    });

    it('keeps a job first resume step in the window when an earlier step forks the session', () => {
      // With at least MAX_SESSION_SHARING_STEPS_PER_KEY distinct jobs sharing
      // one key, a job whose first sharing step forks the session would lose
      // its later resume step to the window and hide a real parallel-resume
      // conflict with the first unordered sibling; the window must reserve
      // the first resume step per job independently of the fork step.
      const jobs: Record<
        string,
        {
          steps: {key: string; prompt: string; session: string | {key: string; mode: 'fork'}}[];
          needs?: string;
        }
      > = {
        plan: {
          steps: [
            {key: 'fork', prompt: 'Fork.', session: {key: 'main', mode: 'fork'}},
            {key: 'resume', prompt: 'Resume.', session: 'main'},
          ],
        },
      };
      for (let index = 0; index < 99; index += 1) {
        const job: {steps: {key: string; prompt: string; session: string}[]; needs?: string} = {
          steps: [{key: `follow_${index}`, prompt: `Follow ${index}.`, session: 'main'}],
        };
        if (index > 0) job.needs = `follow_${index - 1}`;
        jobs[`follow_${index}`] = job;
      }

      const error = expectInvalid({name: 'session sharing', jobs});
      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'agent-session-parallel-resume',
          path: ['jobs', 'follow_0', 'steps', 0, 'session'],
          details: {key: 'main', jobs: ['plan', 'follow_0'], stepIndexes: [1, 0]},
        }),
      ]);
    });
  });

  it('normalizes agent step integrations after catalog validation', () => {
    const document: WorkflowDocument = {
      name: 'agent integrations',
      jobs: {
        fix: {
          steps: [
            {
              prompt: 'Fix the issue.',
              integrations: [
                {
                  include: [
                    'issue_read',
                    'issue_read',
                    'issue_read.*',
                    'issue_read.get',
                    'list_issues',
                  ],
                  exclude: ['issue_read.get', 'issue_read.get'],
                },
              ],
            },
          ],
        },
      },
    };

    const model = normalizeWorkflowDocument(document, {integrationValidationContext});

    expect(model.jobs[0]?.steps[0]).toMatchObject({
      kind: 'agent',
      integrations: [
        {
          include: ['issue_read', 'issue_read.*', 'issue_read.get', 'list_issues'],
          exclude: ['issue_read.get'],
          allowWrite: false,
        },
      ],
    });
  });

  it('validates authored Linear integration selections against the Linear catalog', () => {
    const document: WorkflowDocument = {
      name: 'linear integrations',
      jobs: {
        fix: {
          steps: [
            {
              prompt: 'Use Linear context.',
              integrations: [{connection: 'linear-main', include: ['get_issue']}],
            },
          ],
        },
      },
    };

    const model = normalizeWorkflowDocument(document, {integrationValidationContext});

    expect(model.jobs[0]?.steps[0]).toMatchObject({
      kind: 'agent',
      integrations: [
        {
          connection: 'linear-main',
          include: ['get_issue'],
          allowWrite: false,
        },
      ],
    });
  });

  it('skips integration catalog and connection checks when no context is injected', () => {
    const document: WorkflowDocument = {
      name: 'validate only',
      jobs: {
        fix: {
          steps: [{prompt: 'Fix.', integrations: [{include: ['unknown.write']}]}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[0]).toMatchObject({
      kind: 'agent',
      integrations: [{include: ['unknown.write'], allowWrite: false}],
    });
  });

  it('classifies unknown integration tools and methods', () => {
    const document: WorkflowDocument = {
      name: 'bad integrations',
      jobs: {
        fix: {
          steps: [
            {
              prompt: 'Fix.',
              integrations: [{include: ['issue_read.missing', 'list_issues.extra']}],
            },
          ],
        },
      },
    };

    const error = expectInvalid(document, {integrationValidationContext});

    expect(error.issues.map((issue) => issue.code)).toEqual([
      'unknown-integration-method',
      'unknown-integration-tool',
    ]);
  });

  it('anchors unknown integration tokens to authored selection indexes', () => {
    const document: WorkflowDocument = {
      name: 'bad integrations',
      jobs: {
        fix: {
          steps: [
            {
              prompt: 'Fix.',
              integrations: [
                {
                  include: ['issue_read', 'issue_read', 'issue_read.missing'],
                  exclude: ['issue_read.get', 'issue_read.get', 'list_issues.extra'],
                },
              ],
            },
          ],
        },
      },
    };

    const error = expectInvalid(document, {integrationValidationContext});

    expect(error.issues).toMatchObject([
      {
        code: 'unknown-integration-method',
        path: ['jobs', 'fix', 'steps', 0, 'integrations', 0, 'include', 2],
      },
      {
        code: 'unknown-integration-tool',
        path: ['jobs', 'fix', 'steps', 0, 'integrations', 0, 'exclude', 2],
      },
    ]);
  });

  it('requires allow_write for write-capable authored include tokens', () => {
    const document: WorkflowDocument = {
      name: 'write integrations',
      jobs: {
        fix: {
          steps: [
            {
              prompt: 'Fix.',
              integrations: [{include: ['issue_write', 'merge_pull_request']}],
            },
          ],
        },
      },
    };

    const error = expectInvalid(document, {integrationValidationContext});

    expect(error.issues).toMatchObject([
      {
        code: 'integration-write-not-allowed',
        details: {tokens: ['issue_write', 'merge_pull_request']},
      },
    ]);
  });

  it('does not let exclude mask a write-capable include token', () => {
    const document: WorkflowDocument = {
      name: 'write integrations',
      jobs: {
        fix: {
          steps: [
            {
              prompt: 'Fix.',
              integrations: [{include: ['issue_write'], exclude: ['issue_write']}],
            },
          ],
        },
      },
    };

    const error = expectInvalid(document, {integrationValidationContext});

    expect(error.issues.map((issue) => issue.code)).toEqual(['integration-write-not-allowed']);
  });

  it('accepts write-capable include tokens when allow_write is true', () => {
    const document: WorkflowDocument = {
      name: 'write integrations',
      jobs: {
        fix: {
          steps: [
            {
              prompt: 'Fix.',
              integrations: [{include: ['issue_write.create'], allow_write: true}],
            },
          ],
        },
      },
    };

    const model = normalizeWorkflowDocument(document, {integrationValidationContext});

    expect(model.jobs[0]?.steps[0]).toMatchObject({
      kind: 'agent',
      integrations: [{include: ['issue_write.create'], allowWrite: true}],
    });
  });

  it('requires allow_write for Linear write tools', () => {
    const document: WorkflowDocument = {
      name: 'linear write integrations',
      jobs: {
        fix: {
          steps: [
            {
              prompt: 'Comment on the issue.',
              integrations: [{connection: 'linear-main', include: ['save_comment']}],
            },
          ],
        },
      },
    };

    const error = expectInvalid(document, {integrationValidationContext});

    expect(error.issues).toMatchObject([
      {
        code: 'integration-write-not-allowed',
        details: {tokens: ['save_comment']},
      },
    ]);
  });

  it('accepts Linear write tools when allow_write is true', () => {
    const document: WorkflowDocument = {
      name: 'linear write integrations',
      jobs: {
        fix: {
          steps: [
            {
              prompt: 'Comment on the issue.',
              integrations: [
                {connection: 'linear-main', include: ['save_comment'], allow_write: true},
              ],
            },
          ],
        },
      },
    };

    const model = normalizeWorkflowDocument(document, {integrationValidationContext});

    expect(model.jobs[0]?.steps[0]).toMatchObject({
      kind: 'agent',
      integrations: [{connection: 'linear-main', include: ['save_comment'], allowWrite: true}],
    });
  });

  it('requires allow_write for Jira write tools', () => {
    const document: WorkflowDocument = {
      name: 'jira write integrations',
      jobs: {
        fix: {
          steps: [
            {
              prompt: 'Comment on the issue.',
              integrations: [{connection: 'jira-main', include: ['add_comment']}],
            },
          ],
        },
      },
    };

    const error = expectInvalid(document, {integrationValidationContext});

    expect(error.issues).toMatchObject([
      {
        code: 'integration-write-not-allowed',
        details: {tokens: ['add_comment']},
      },
    ]);
  });

  it('accepts Jira write tools when allow_write is true', () => {
    const document: WorkflowDocument = {
      name: 'jira write integrations',
      jobs: {
        fix: {
          steps: [
            {
              prompt: 'Comment on the issue.',
              integrations: [
                {connection: 'jira-main', include: ['add_comment'], allow_write: true},
              ],
            },
          ],
        },
      },
    };

    const model = normalizeWorkflowDocument(document, {integrationValidationContext});

    expect(model.jobs[0]?.steps[0]).toMatchObject({
      kind: 'agent',
      integrations: [{connection: 'jira-main', include: ['add_comment'], allowWrite: true}],
    });
  });

  it('reports connection failures before token checks', () => {
    const document: WorkflowDocument = {
      name: 'missing connection',
      jobs: {
        fix: {
          steps: [
            {
              prompt: 'Fix.',
              integrations: [{connection: 'missing', include: ['bad.token']}],
            },
          ],
        },
      },
    };

    const error = expectInvalid(document, {integrationValidationContext});

    expect(error.issues.map((issue) => issue.code)).toEqual(['integration-connection-not-found']);
  });

  it('requires an explicit connection when no default exists', () => {
    const document: WorkflowDocument = {
      name: 'missing default',
      jobs: {
        fix: {
          steps: [{prompt: 'Fix.', integrations: [{include: ['issue_read']}]}],
        },
      },
    };
    const context = {...integrationValidationContext, defaultConnectionSlug: undefined};

    const error = expectInvalid(document, {integrationValidationContext: context});

    expect(error.issues.map((issue) => issue.code)).toEqual(['missing-connection-for-integration']);
  });

  it('rejects connections whose provider has no agent tools catalog', () => {
    const document: WorkflowDocument = {
      name: 'non-capable connection',
      jobs: {
        fix: {
          steps: [
            {prompt: 'Fix.', integrations: [{connection: 'sentry-main', include: ['issue_read']}]},
          ],
        },
      },
    };

    const error = expectInvalid(document, {integrationValidationContext});

    expect(error.issues.map((issue) => issue.code)).toEqual(['integration-connection-not-capable']);
  });

  it('reports unsupported explicit providers', () => {
    const document: WorkflowDocument = {
      name: 'agent build',
      jobs: {
        fix: {
          steps: [{provider: 'github-copilot', prompt: 'Fix it.'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'invalid-provider',
        message: 'Provider "github-copilot" is not supported.',
        path: ['jobs', 'fix', 'steps', 0, 'provider'],
        details: {provider: 'github-copilot'},
        severity: 'error',
        scope: 'definition',
      },
    ]);
  });

  it('allows explicit custom providers for pi agent steps', () => {
    const document: WorkflowDocument = {
      name: 'agent build',
      jobs: {
        fix: {
          steps: [
            {
              harness: 'pi',
              provider: 'workspace-openai-compatible',
              model: 'workspace-model',
              prompt: 'Fix it.',
            },
          ],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[0]).toMatchObject({
      kind: 'agent',
      harness: 'pi',
      provider: 'workspace-openai-compatible',
      model: 'workspace-model',
    });
  });

  it('reports unsupported literal models', () => {
    const document: WorkflowDocument = {
      name: 'agent build',
      jobs: {
        fix: {
          steps: [{harness: 'pi', provider: 'anthropic', model: 'not-a-model', prompt: 'Fix it.'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'invalid-model',
        message:
          'Agent model "not-a-model" is not available for harness "pi" and provider "anthropic".',
        path: ['jobs', 'fix', 'steps', 0, 'model'],
        details: {harness: 'pi', provider: 'anthropic', model: 'not-a-model'},
        severity: 'error',
        scope: 'definition',
      },
    ]);
  });

  it('allows custom providers without an explicit harness', () => {
    const document: WorkflowDocument = {
      name: 'agent build',
      jobs: {
        fix: {
          steps: [
            {
              provider: 'workspace-openai-compatible',
              model: 'workspace-model',
              prompt: 'Fix it.',
            },
          ],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[0]).toMatchObject({
      kind: 'agent',
      provider: 'workspace-openai-compatible',
      model: 'workspace-model',
    });
  });

  it('defers harness-specific validation when harness is omitted', () => {
    const document: WorkflowDocument = {
      name: 'workspace-default harness',
      jobs: {
        fix: {
          steps: [
            {
              provider: 'anthropic',
              model: 'claude-sonnet-4-6',
              prompt: 'Fix it.',
            },
          ],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[0]).toMatchObject({
      kind: 'agent',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    });
  });

  it('reports explicit harness/provider incompatibility', () => {
    const document: WorkflowDocument = {
      name: 'agent build',
      jobs: {
        fix: {
          steps: [{harness: 'claude', provider: 'openai', prompt: 'Fix it.'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'harness-provider-incompatible',
        message:
          'Harness "claude" does not support provider: openai. Supported providers: anthropic.',
        path: ['jobs', 'fix', 'steps', 0, 'provider'],
        details: {harness: 'claude', provider: 'openai', supportedProviders: ['anthropic']},
        severity: 'error',
        scope: 'definition',
      },
    ]);
  });

  it('reports explicit harness/tool incompatibility with a precise tool path', () => {
    const document: WorkflowDocument = {
      name: 'agent build',
      jobs: {
        fix: {
          steps: [{harness: 'pi', prompt: 'Search it.', tools: ['read', 'WebSearch']}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'harness-tool-incompatible',
        message:
          'Harness "pi" does not support tool: WebSearch. Supported tools: read, bash, edit, write, grep, find, ls, web_search, fetch_content, get_search_content.',
        path: ['jobs', 'fix', 'steps', 0, 'tools', 1],
        details: {
          harness: 'pi',
          tool: 'WebSearch',
          supportedTools: [
            'read',
            'bash',
            'edit',
            'write',
            'grep',
            'find',
            'ls',
            'web_search',
            'fetch_content',
            'get_search_content',
          ],
        },
        severity: 'error',
        scope: 'definition',
      },
    ]);
  });

  it('accepts Claude WebSearch as a harness-native tool name', () => {
    const document: WorkflowDocument = {
      name: 'agent build',
      jobs: {
        fix: {
          steps: [{harness: 'claude', prompt: 'Search it.', tools: ['Read', 'WebSearch']}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[0]).toMatchObject({
      kind: 'agent',
      harness: 'claude',
      tools: ['Read', 'WebSearch'],
    });
  });

  it('rejects tools without an explicit harness', () => {
    const document: WorkflowDocument = {
      name: 'agent build',
      jobs: {
        fix: {
          steps: [{prompt: 'Search it.', tools: ['Read']}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'missing-harness-for-tools',
        message:
          'Agent step tools require an explicit harness because tool names are harness-specific.',
        path: ['jobs', 'fix', 'steps', 0, 'tools'],
        details: {tools: ['Read']},
        severity: 'error',
        scope: 'definition',
      },
    ]);
  });

  it('rejects Pi search tools when deployment search is disabled but keeps fetch_content', () => {
    const document: WorkflowDocument = {
      name: 'agent build',
      jobs: {
        fix: {
          steps: [
            {
              harness: 'pi',
              prompt: 'Fetch without search.',
              tools: ['fetch_content', 'web_search', 'get_search_content'],
            },
          ],
        },
      },
    };

    const error = expectInvalid(document, {
      agentValidationCatalog: {
        ...agentValidationCatalog,
        harnesses: agentValidationCatalog.harnesses.map((harness) =>
          harness.id === 'pi'
            ? {
                ...harness,
                effective_tools: harness.effective_tools.filter(
                  (tool) =>
                    tool === 'fetch_content' ||
                    !['web_search', 'get_search_content'].includes(tool),
                ),
              }
            : harness,
        ),
      },
    });

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'harness-tool-incompatible',
        path: ['jobs', 'fix', 'steps', 0, 'tools', 1],
        details: expect.objectContaining({
          tool: 'web_search',
          supportedTools: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'fetch_content'],
        }),
      }),
      expect.objectContaining({
        code: 'harness-tool-incompatible',
        path: ['jobs', 'fix', 'steps', 0, 'tools', 2],
        details: expect.objectContaining({
          tool: 'get_search_content',
          supportedTools: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'fetch_content'],
        }),
      }),
    ]);
  });

  it('reports harness/thinking incompatibility even with a templated provider', () => {
    const document: WorkflowDocument = {
      name: 'agent build',
      jobs: {
        fix: {
          steps: [
            {
              harness: 'claude',
              provider: workflowInterpolation('vars.provider'),
              prompt: 'Fix it.',
              thinking: 'off',
            },
          ],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toContainEqual({
      code: 'harness-thinking-incompatible',
      message:
        'Harness "claude" does not support thinking: off. Supported levels: low, medium, high, xhigh, max.',
      path: ['jobs', 'fix', 'steps', 0, 'thinking'],
      details: {
        harness: 'claude',
        thinking: 'off',
        supportedLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      },
      severity: 'error',
      scope: 'definition',
    });
  });

  it('accepts max thinking for the Pi harness', () => {
    const document: WorkflowDocument = {
      name: 'agent build',
      jobs: {
        fix: {
          steps: [{harness: 'pi', prompt: 'Fix it.', thinking: 'max'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[0]).toMatchObject({
      kind: 'agent',
      harness: 'pi',
      thinking: 'max',
    });
  });

  it('defers an interpolated thinking level to dispatch', () => {
    const document: WorkflowDocument = {
      name: 'agent build',
      jobs: {
        fix: {
          steps: [
            {
              harness: 'claude',
              prompt: 'Fix it.',
              thinking: workflowInterpolation('vars.THINKING'),
            },
          ],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);
    const step = model.jobs[0]?.steps[0];

    if (step?.kind !== 'agent') throw new Error('Expected an agent step');
    expect(step.templates?.thinking).toMatchObject([{kind: 'deferred', roots: ['vars']}]);
  });

  it('normalizes job success expressions and execution timeouts', () => {
    const document: WorkflowDocument = {
      name: 'job controls',
      jobs: {
        test: {
          success: 'executions.exists(e, e.index == 0 && e.status == "succeeded")',
          execution_timeout: '90m',
          steps: [{run: 'npm test'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]).toMatchObject({
      success: 'executions.exists(e, e.index == 0 && e.status == "succeeded")',
      executionTimeoutMs: 90 * 60 * 1000,
    });
  });

  it('normalizes job and step if predicates', () => {
    const document: WorkflowDocument = {
      name: 'conditional controls',
      jobs: {
        build: {
          steps: [
            {key: 'compile', run: 'npm run build'},
            {
              if: interpolation('steps.compile.status == "succeeded" && !execution.failed'),
              run: 'npm test',
            },
          ],
        },
        notify: {
          needs: 'build',
          if: interpolation('needs.exists(n, n.key == "build" && n.status == "failed")'),
          steps: [{prompt: 'Notify the team.'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[1]?.if).toEqual({
      language: 'cel',
      source: 'steps.compile.status == "succeeded" && !execution.failed',
      check: 'typed',
      resultType: 'bool',
    });
    expect(model.jobs[1]?.if).toEqual({
      language: 'cel',
      source: 'needs.exists(n, n.key == "build" && n.status == "failed")',
      check: 'typed',
      resultType: 'bool',
    });
  });

  it('defaults omitted job checkout to read permissions and persisted credentials', () => {
    const document: WorkflowDocument = {
      name: 'default checkout',
      jobs: {
        build: {
          steps: [{run: 'npm test'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.checkout).toEqual(DEFAULT_JOB_CHECKOUT);
  });

  it('defaults empty job checkout to read permissions and persisted credentials', () => {
    const document: WorkflowDocument = {
      name: 'empty checkout',
      jobs: {
        build: {
          checkout: {},
          steps: [{run: 'npm test'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.checkout).toEqual(DEFAULT_JOB_CHECKOUT);
  });

  it('preserves the job checkout opt-out in the model', () => {
    const model = normalizeWorkflowDocument({
      name: 'checkout disabled',
      jobs: {
        build: {
          checkout: false,
          steps: [{run: 'npm test'}],
        },
      },
    });

    expect(model.jobs[0]?.checkout).toBe(false);
  });

  it('normalizes checkout-step targets from earlier step outputs', () => {
    const model = normalizeWorkflowDocument({
      name: 'templated checkout step',
      jobs: {
        build: {
          steps: [
            {
              key: 'route',
              run: 'echo route',
              outputs: {
                connection: {type: 'string'},
                repository: {type: 'string'},
                ref: {type: 'string'},
                path: {type: 'string'},
              },
            },
            {
              key: 'checkout',
              checkout: {
                connection: interpolation('inputs.connection'),
                repository: interpolation('steps.route.outputs.repository'),
                ref: interpolation('steps.route.outputs.ref'),
                path: interpolation('steps.route.outputs.path'),
              },
            },
          ],
        },
      },
    });

    expect(model.jobs[0]?.steps[1]).toMatchObject({
      kind: 'checkout',
      checkout: {
        connection: interpolation('inputs.connection'),
        repository: interpolation('steps.route.outputs.repository'),
        ref: interpolation('steps.route.outputs.ref'),
        path: interpolation('steps.route.outputs.path'),
        fetchDepth: 1,
        permissions: {contents: 'read'},
        persistCredentials: true,
        templates: {
          connection: [{kind: 'deferred', roots: ['inputs'], fillTarget: 'run-creation'}],
          repository: [{kind: 'deferred', roots: ['steps'], fillTarget: 'step-dispatch'}],
          ref: [{kind: 'deferred', roots: ['steps'], fillTarget: 'step-dispatch'}],
          path: [{kind: 'deferred', roots: ['steps'], fillTarget: 'step-dispatch'}],
        },
      },
    });
  });

  it('reports invalid checkout target combinations from model normalization', () => {
    const error = expectInvalid({
      name: 'invalid checkout target',
      jobs: {
        build: {
          steps: [{checkout: {project: 'project-id', repository: 'acme/api'}}],
        },
      },
    });

    expect(error.issues).toContainEqual(
      expect.objectContaining({
        code: 'checkout-target-invalid',
        path: ['jobs', 'build', 'steps', 0, 'checkout', 'repository'],
      }),
    );

    const missingRepository = expectInvalid({
      name: 'missing checkout repository',
      jobs: {
        build: {
          steps: [{checkout: {connection: 'github'}}],
        },
      },
    });

    expect(missingRepository.issues).toContainEqual(
      expect.objectContaining({
        code: 'checkout-target-invalid',
        path: ['jobs', 'build', 'steps', 0, 'checkout', 'repository'],
        details: {fields: ['connection', 'repository']},
      }),
    );
  });

  it('normalizes checkout steps and their static defaults', () => {
    const model = normalizeWorkflowDocument({
      name: 'checkout step',
      jobs: {
        build: {
          steps: [
            {
              key: 'fetch-target',
              checkout: {
                repository: 'acme/api',
                ref: 'refs/heads/main',
                'fetch-depth': 0,
                path: 'target',
                permissions: {contents: 'write'},
                'persist-credentials': false,
                force: true,
              },
            },
          ],
        },
      },
    });

    expect(model.jobs[0]?.steps[0]).toMatchObject({
      id: expect.stringContaining('fetch-target'),
      key: 'fetch-target',
      kind: 'checkout',
      checkout: {
        repository: 'acme/api',
        ref: 'refs/heads/main',
        fetchDepth: 0,
        path: 'target',
        permissions: {contents: 'write'},
        persistCredentials: false,
        force: true,
      },
    });
  });

  it('normalizes checkout contents write and defaults persisted credentials', () => {
    const document: WorkflowDocument = {
      name: 'write checkout',
      jobs: {
        build: {
          checkout: {
            permissions: {
              contents: 'write',
            },
          },
          steps: [{run: 'npm test'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.checkout).toEqual({
      permissions: {contents: 'write'},
      persistCredentials: true,
    });
  });

  it('normalizes checkout persist credentials false and defaults contents read', () => {
    const document: WorkflowDocument = {
      name: 'no persisted credentials',
      jobs: {
        build: {
          checkout: {'persist-credentials': false},
          steps: [{run: 'npm test'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.checkout).toEqual({
      permissions: {contents: 'read'},
      persistCredentials: false,
    });
  });

  it('normalizes listening job configuration', () => {
    const displayName = ['PR review $', '{{ execution.index }}'].join('');
    const promptTemplate = ['Review $', '{{ execution.events[0].data.body }}'].join('');
    const document: WorkflowDocument = {
      name: 'listen for reviews',
      jobs: {
        review: {
          execution_name: displayName,
          listening: {
            on: [
              {
                source: 'github',
                event: 'pull_request_review',
                filter: 'event.action == "submitted"',
              },
            ],
            until: [{source: 'github', event: 'pull_request', filter: 'event.action == "closed"'}],
            timeout: '30d',
            max_executions: 10,
            batch: {debounce: '5s', max_size: 20, max_wait: '1h'},
            on_resolve: 'cancel',
          },
          steps: [{prompt: promptTemplate}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]).toMatchObject({
      mode: 'listening',
      listening: {
        on: [
          {source: 'github', event: 'pull_request_review', filter: 'event.action == "submitted"'},
        ],
        until: [{source: 'github', event: 'pull_request', filter: 'event.action == "closed"'}],
        timeoutMs: 30 * 24 * 60 * 60 * 1000,
        maxExecutions: 10,
        batch: {debounceMs: 5000, maxSize: 20, maxWaitMs: 60 * 60 * 1000},
        onResolve: 'cancel',
      },
    });
    expect(model.jobs[0]?.executionName?.[1]).toMatchObject({
      kind: 'deferred',
      expression: {source: 'execution.index', check: 'typed'},
    });
  });

  it('reports listening jobs without a resolution source', () => {
    const document: WorkflowDocument = {
      name: 'listen forever',
      jobs: {
        review: {
          listening: {
            on: [{source: 'github', event: 'pull_request_review'}],
          },
          steps: [{run: 'echo ok'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'listening-job-missing-resolution-source',
        path: ['jobs', 'review', 'listening'],
      }),
    ]);
  });

  it('reports missing resolution sources when every until matcher is inert', () => {
    const document: WorkflowDocument = {
      name: 'listen forever',
      jobs: {
        review: {
          listening: {
            on: [{source: 'github', event: 'pull_request_review'}],
            until: [{source: 'github', event: 'pull_request', filter: 'event.action'}],
          },
          steps: [{run: 'echo ok'}],
        },
      },
    };

    const diagnostics: WorkflowModelValidationIssue[] = [];
    let error: InvalidWorkflowModelError | undefined;
    try {
      normalizeWorkflowDocument(document, {diagnostics});
      expect.fail('Expected InvalidWorkflowModelError');
    } catch (caught) {
      expect(caught).toBeInstanceOf(InvalidWorkflowModelError);
      error = caught as InvalidWorkflowModelError;
    }

    expect(error?.issues).toEqual([
      expect.objectContaining({
        code: 'listening-job-missing-resolution-source',
        path: ['jobs', 'review', 'listening'],
      }),
    ]);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'invalid-listener-filter',
        path: ['jobs', 'review', 'listening', 'until', 0, 'filter'],
        severity: 'error',
        scope: 'trigger',
      }),
    ]);
  });

  it('drops inert until matchers from the model when a timeout resolves the job', () => {
    const document: WorkflowDocument = {
      name: 'listen with timeout',
      jobs: {
        review: {
          listening: {
            on: [{source: 'github', event: 'pull_request_review'}],
            until: [{source: 'github', event: 'pull_request', filter: 'event.action'}],
            timeout: '1h',
          },
          steps: [{run: 'echo ok'}],
        },
      },
    };

    const {model, diagnostics} = normalizeWithDiagnostics(document);

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'invalid-listener-filter',
        path: ['jobs', 'review', 'listening', 'until', 0, 'filter'],
        severity: 'error',
        scope: 'trigger',
      }),
    ]);
    expect(model.jobs[0]?.listening).toMatchObject({
      on: [{source: 'github', event: 'pull_request_review'}],
      timeoutMs: 60 * 60 * 1000,
    });
    expect(model.jobs[0]?.listening).not.toHaveProperty('until');
  });

  it('reports listening timeouts above the run timeout', () => {
    const document: WorkflowDocument = {
      name: 'too long',
      jobs: {
        review: {
          listening: {
            on: [{source: 'github', event: 'pull_request_review'}],
            timeout: '31d',
          },
          steps: [{run: 'echo ok'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'listening-timeout-exceeds-run-timeout',
        path: ['jobs', 'review', 'listening', 'timeout'],
      }),
    ]);
  });

  it('validates listener filters against their persisted snapshot roots', () => {
    const document: WorkflowDocument = {
      name: 'listener filter roots',
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
        review: {
          needs: ['build'],
          listening: {
            on: [
              {
                source: 'github',
                event: 'pull_request_review',
                filter:
                  'run.id != "" && trigger.event == "pull_request_review" && inputs.target == event.issue.number && vars.ENABLED == "true" && job.key == "review" && jobs.build.outputs.pr_number == event.issue.number',
              },
            ],
            until: [
              {
                source: 'github',
                event: 'pull_request',
                filter: 'event.action == "closed"',
              },
            ],
          },
          steps: [{run: 'echo ok'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[1]?.listening?.on[0]?.filter).toBe(
      'run.id != "" && trigger.event == "pull_request_review" && inputs.target == event.issue.number && vars.ENABLED == "true" && job.key == "review" && jobs.build.outputs.pr_number == event.issue.number',
    );
    expect(model.jobs[1]?.listening?.until?.[0]?.filter).toBe('event.action == "closed"');
  });

  it.each([
    ['step root', 'step.status == "succeeded"', 'context-unavailable-at-predicate-site'],
    ['steps root', 'steps.build.outputs.sha == "abc"', 'context-unavailable-at-predicate-site'],
    ['executions root', 'executions.size() > 0', 'context-unavailable-at-predicate-site'],
    ['matrix root', 'matrix.os == "linux"', 'context-unavailable-at-predicate-site'],
    ['runner root', 'runner.os == "linux"', 'runner-context-in-server-predicate'],
  ] as const)('reports invalid listener on filters for %s', (_label, filter, code) => {
    const document: WorkflowDocument = {
      name: 'invalid listener filter',
      jobs: {
        review: {
          listening: {
            on: [{source: 'github', event: 'pull_request_review', filter}],
            max_executions: 1,
          },
          steps: [{run: 'echo ok'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code,
        path: ['jobs', 'review', 'listening', 'on', 0, 'filter'],
        details: expect.objectContaining({
          field: 'listener.on',
          source: filter,
        }),
      }),
    ]);
  });

  it('rejects a listening job whose only on matcher is inert', () => {
    const document: WorkflowDocument = {
      name: 'invalid listener filter',
      jobs: {
        review: {
          listening: {
            on: [{source: 'github', event: 'pull_request_review', filter: 'event.action'}],
            max_executions: 1,
          },
          steps: [{run: 'echo ok'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'listening-job-no-active-matcher',
        path: ['jobs', 'review', 'listening', 'on'],
      }),
    ]);
  });

  it('makes an invalid listener on matcher inert and keeps the others active', () => {
    const document: WorkflowDocument = {
      name: 'invalid listener filter',
      jobs: {
        review: {
          listening: {
            on: [
              {source: 'github', event: 'pull_request_review', filter: 'event.action'},
              {
                source: 'github',
                event: 'pull_request_review',
                filter: 'event.action == "submitted"',
              },
            ],
            max_executions: 1,
          },
          steps: [{run: 'echo ok'}],
        },
      },
    };

    const {model, diagnostics} = normalizeWithDiagnostics(document);

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'invalid-listener-filter',
        path: ['jobs', 'review', 'listening', 'on', 0, 'filter'],
        details: expect.objectContaining({
          field: 'listener.on',
          source: 'event.action',
        }),
        severity: 'error',
        scope: 'trigger',
      }),
    ]);
    expect(model.jobs[0]?.listening?.on).toEqual([
      {source: 'github', event: 'pull_request_review', filter: 'event.action == "submitted"'},
    ]);
  });

  it('warns about an unknown listener on source and keeps the matcher active', () => {
    const document: WorkflowDocument = {
      name: 'unknown matcher source',
      jobs: {
        review: {
          listening: {
            on: [{source: 'unknown_slug', event: 'received'}],
            max_executions: 1,
          },
          steps: [{run: 'echo ok'}],
        },
      },
    };

    const {model, diagnostics} = normalizeWithDiagnostics(document, {
      integrationValidationContext,
    });

    expect(diagnostics).toEqual([
      {
        code: 'unknown-trigger-source',
        message:
          'Source "unknown_slug" matches no connection in this workspace; the trigger stays active and fires once a connection with this slug exists.',
        path: ['jobs', 'review', 'listening', 'on', 0],
        details: {source: 'unknown_slug'},
        severity: 'warning',
        scope: 'trigger',
      },
    ]);
    expect(model.jobs[0]?.listening?.on).toEqual([{source: 'unknown_slug', event: 'received'}]);
  });

  it('makes an on matcher with a non-fire manual event inert', () => {
    const document: WorkflowDocument = {
      name: 'inert on matcher',
      jobs: {
        review: {
          listening: {
            on: [
              {source: 'manual', event: 'run'},
              {source: 'github-main', event: 'push'},
            ],
            max_executions: 1,
          },
          steps: [{run: 'echo ok'}],
        },
      },
    };

    const {model, diagnostics} = normalizeWithDiagnostics(document, {
      integrationValidationContext,
    });

    expect(diagnostics).toEqual([
      {
        code: 'invalid-trigger-event',
        message: 'A manual trigger must use event "fire"; found "run".',
        path: ['jobs', 'review', 'listening', 'on', 0, 'event'],
        details: {event: 'run', source: 'manual'},
        severity: 'error',
        scope: 'trigger',
      },
    ]);
    expect(model.jobs[0]?.listening?.on).toEqual([{source: 'github-main', event: 'push'}]);
  });

  it('warns about an unlisted until matcher event and keeps the matcher active', () => {
    const document: WorkflowDocument = {
      name: 'unlisted until event',
      jobs: {
        review: {
          listening: {
            on: [{source: 'github-main', event: 'push'}],
            until: [{source: 'github-main', event: 'deployment.created'}],
          },
          steps: [{run: 'echo ok'}],
        },
      },
    };

    const {model, diagnostics} = normalizeWithDiagnostics(document, {
      integrationValidationContext,
    });

    expect(diagnostics).toEqual([
      {
        code: 'unknown-trigger-event',
        message:
          'Event "deployment.created" is not in the github event catalog; the trigger stays active because this deployment\'s provider app may deliver it.',
        path: ['jobs', 'review', 'listening', 'until', 0, 'event'],
        details: {event: 'deployment.created', source: 'github-main', provider: 'github'},
        severity: 'warning',
        scope: 'trigger',
      },
    ]);
    expect(model.jobs[0]?.listening?.until).toEqual([
      {source: 'github-main', event: 'deployment.created'},
    ]);
  });

  it('rejects listener filters that reference jobs without a direct needs edge', () => {
    const document: WorkflowDocument = {
      name: 'listener missing needs',
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
        review: {
          listening: {
            on: [
              {
                source: 'github',
                event: 'pull_request_review',
                filter: 'jobs.build.outputs.pr_number == event.issue.number',
              },
            ],
            max_executions: 1,
          },
          steps: [{run: 'echo ok'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'missing-job-needs-edge',
        path: ['jobs', 'review', 'listening', 'on', 0, 'filter'],
        details: expect.objectContaining({
          field: 'listener.on',
          job: 'build',
        }),
      }),
    ]);
  });

  it('rejects computed job keys in listener until filters', () => {
    const document: WorkflowDocument = {
      name: 'computed listener job key',
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
        review: {
          needs: ['build'],
          listening: {
            on: [{source: 'github', event: 'pull_request_review'}],
            until: [
              {
                source: 'github',
                event: 'pull_request',
                filter: 'jobs[event.job].outputs.sha == "abc"',
              },
            ],
          },
          steps: [{run: 'echo ok'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'computed-context-key',
        path: ['jobs', 'review', 'listening', 'until', 0, 'filter'],
        details: expect.objectContaining({
          field: 'listener.until',
        }),
      }),
    ]);
  });

  it('accepts explicit model ids present in the harness catalog', () => {
    const document: WorkflowDocument = {
      name: 'agent build',
      jobs: {
        fix: {
          steps: [{harness: 'pi', provider: 'openai', model: 'gpt-4.1', prompt: 'Fix it.'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[0]).toMatchObject({
      kind: 'agent',
      provider: 'openai',
      model: 'gpt-4.1',
      prompt: 'Fix it.',
    });
  });

  it('applies top-level runner defaults to jobs without runner overrides', () => {
    const document: WorkflowDocument = {
      name: 'runner defaults',
      runner: ['ubuntu-latest', 'node-22'],
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
        test: {
          runner: 'ubuntu-latest',
          steps: [{run: 'npm test'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs).toMatchObject([
      {id: 'build', runner: ['node-22', 'ubuntu-latest']},
      {id: 'test', runner: ['ubuntu-latest']},
    ]);
  });

  it('canonicalizes runner labels', () => {
    const document: WorkflowDocument = {
      name: 'canonical runners',
      runner: [' Ubuntu-Latest ', 'gpu', 'ubuntu-latest', ' Node-22 '],
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs).toMatchObject([{id: 'build', runner: ['gpu', 'node-22', 'ubuntu-latest']}]);
  });

  it('reports a missing runner label when no default exists', () => {
    const document: WorkflowDocument = {
      name: 'missing runner',
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    try {
      normalizeWorkflowDocumentBase(document, {agentValidationCatalog});
      expect.fail('Expected InvalidWorkflowModelError');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidWorkflowModelError);
      expect((error as InvalidWorkflowModelError).issues).toEqual([
        expect.objectContaining({
          code: 'missing-runner-label',
          path: ['jobs', 'build', 'runner'],
        }),
      ]);
    }
  });

  it('uses canonicalized default runner labels when no runner is declared', () => {
    const document: WorkflowDocument = {
      name: 'default runner',
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const model = normalizeWorkflowDocumentBase(document, {
      agentValidationCatalog,
      defaultRunnerLabels: [' Ubuntu ', 'ubuntu'],
    });

    expect(model.jobs).toMatchObject([{id: 'build', runner: ['ubuntu']}]);
  });

  it('does not fall back to defaults for explicit whitespace-only runner labels', () => {
    const document: WorkflowDocument = {
      name: 'empty explicit runner',
      runner: ' ',
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    try {
      normalizeWorkflowDocumentBase(document, {
        agentValidationCatalog,
        defaultRunnerLabels: ['ubuntu-latest'],
      });
      expect.fail('Expected InvalidWorkflowModelError');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidWorkflowModelError);
      expect((error as InvalidWorkflowModelError).issues).toEqual([
        expect.objectContaining({
          code: 'missing-runner-label',
          path: ['jobs', 'build', 'runner'],
        }),
      ]);
    }
  });

  it('canonicalizes job-level runner overrides over workflow-level runner labels', () => {
    const document: WorkflowDocument = {
      name: 'runner overrides',
      runner: ['ubuntu-latest'],
      jobs: {
        build: {
          runner: [' Node-22 ', 'node-22', 'GPU'],
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs).toMatchObject([{id: 'build', runner: ['gpu', 'node-22']}]);
  });

  it('reports invalid runner labels', () => {
    const document: WorkflowDocument = {
      name: 'invalid runner',
      runner: 'ci,gpu',
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    try {
      normalizeWorkflowDocumentBase(document, {agentValidationCatalog});
      expect.fail('Expected InvalidWorkflowModelError');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidWorkflowModelError);
      expect((error as InvalidWorkflowModelError).issues).toEqual([
        expect.objectContaining({
          code: 'invalid-runner-label',
          path: ['jobs', 'build', 'runner'],
          details: {labels: ['ci,gpu']},
        }),
      ]);
    }
  });

  it('reports too many runner labels', () => {
    const document: WorkflowDocument = {
      name: 'too many runners',
      runner: Array.from({length: 21}, (_, index) => `label-${index}`),
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    try {
      normalizeWorkflowDocumentBase(document, {agentValidationCatalog});
      expect.fail('Expected InvalidWorkflowModelError');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidWorkflowModelError);
      expect((error as InvalidWorkflowModelError).issues).toEqual([
        expect.objectContaining({
          code: 'too-many-runner-labels',
          path: ['jobs', 'build', 'runner'],
        }),
      ]);
    }
  });

  it('counts runner templates toward the runner label limit', () => {
    const document: WorkflowDocument = {
      name: 'too many templated runners',
      runner: [
        ...Array.from({length: 20}, (_, index) => `label-${index}`),
        workflowInterpolation('execution.name'),
      ],
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'too-many-runner-labels',
        path: ['jobs', 'build', 'runner'],
      }),
    ]);
  });

  it('reports invalid runner templates without redundant label issues', () => {
    const document: WorkflowDocument = {
      name: 'invalid templated runner',
      runner: workflowInterpolation('missing.runner'),
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'unknown-interpolation-context',
        path: ['jobs', 'build', 'runner', 0],
      }),
    ]);
  });

  it('reports invalid labels and too many labels together', () => {
    const document: WorkflowDocument = {
      name: 'invalid and too many runners',
      runner: ['has space', ...Array.from({length: 20}, (_, index) => `label-${index}`)],
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    try {
      normalizeWorkflowDocumentBase(document, {agentValidationCatalog});
      expect.fail('Expected InvalidWorkflowModelError');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidWorkflowModelError);
      expect((error as InvalidWorkflowModelError).issues).toEqual([
        expect.objectContaining({
          code: 'invalid-runner-label',
          path: ['jobs', 'build', 'runner'],
          details: {labels: ['has space']},
        }),
        expect.objectContaining({
          code: 'too-many-runner-labels',
          path: ['jobs', 'build', 'runner'],
        }),
      ]);
    }
  });

  it('accepts the maximum runner label count', () => {
    const document: WorkflowDocument = {
      name: 'maximum runner count',
      runner: Array.from({length: 20}, (_, index) => `label-${index}`),
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const model = normalizeWorkflowDocumentBase(document, {agentValidationCatalog});

    expect(model.jobs[0]?.runner).toHaveLength(20);
  });

  it('expands a top-level runner string shorthand', () => {
    const document: WorkflowDocument = {
      name: 'runner shorthand',
      runner: 'ubuntu-latest',
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs).toMatchObject([{id: 'build', runner: ['ubuntu-latest']}]);
  });

  it('stringifies env at workflow, job, and run-step scope', () => {
    const document: WorkflowDocument = {
      name: 'env build',
      env: {NODE_ENV: 'test', PORT: 3000, CI: true},
      jobs: {
        build: {
          env: {JOB_SCOPE: 'build'},
          steps: [{run: 'npm test', env: {STEP_SCOPE: 'test', DEBUG: false}}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.env).toEqual({NODE_ENV: 'test', PORT: '3000', CI: 'true'});
    expect(model.jobs[0]?.env).toEqual({JOB_SCOPE: 'build'});
    expect(model.jobs[0]?.steps[0]).toMatchObject({
      kind: 'run',
      env: {STEP_SCOPE: 'test', DEBUG: 'false'},
    });
  });

  it('omits empty env maps and does not attach inherited env to agent steps', () => {
    const document: WorkflowDocument = {
      name: 'agent env',
      env: {},
      jobs: {
        fix: {
          env: {JOB_SCOPE: 'fix'},
          steps: [{model: 'claude-opus-4-8', prompt: 'Fix it.'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model).not.toHaveProperty('env');
    expect(model.jobs[0]?.env).toEqual({JOB_SCOPE: 'fix'});
    expect(model.jobs[0]?.steps[0]).not.toHaveProperty('env');
  });

  it('expands needs into job dependencies and explicit graph edges', () => {
    const document: WorkflowDocument = {
      name: 'graph',
      jobs: {
        'build app': {
          steps: [{run: 'npm run build'}],
        },
        test: {
          needs: 'build app',
          steps: [{run: 'npm test'}],
        },
        deploy: {
          needs: ['build app', 'test'],
          steps: [{run: 'npm run deploy'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs.map((job) => ({id: job.id, dependencies: job.dependencies}))).toEqual([
      {id: 'build-app', dependencies: []},
      {id: 'test', dependencies: ['build-app']},
      {id: 'deploy', dependencies: ['build-app', 'test']},
    ]);
    expect(model.dependencies).toEqual([
      {from: 'build-app', to: 'test'},
      {from: 'build-app', to: 'deploy'},
      {from: 'test', to: 'deploy'},
    ]);
  });

  it('deduplicates repeated needs before building graph edges', () => {
    const document: WorkflowDocument = {
      name: 'dedupe graph',
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
        test: {
          needs: ['build', 'build'],
          steps: [{run: 'npm test'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs).toMatchObject([
      {id: 'build', dependencies: []},
      {id: 'test', dependencies: ['build']},
    ]);
    expect(model.dependencies).toEqual([{from: 'build', to: 'test'}]);
  });

  it('normalizes step gates with success conditions and failure actions', () => {
    const reviewFeedback = 'Agent rejected the PR $' + '{{ step.outputs.review }}';
    const document: WorkflowDocument = {
      name: 'review loop',
      jobs: {
        review: {
          steps: [
            {key: 'producer', run: 'npm run build'},
            {
              key: 'reviewer',
              run: 'npm run review',
              gate: {
                success: 'step.exit_code == 0',
                on_failure: {
                  restart_from: 'producer',
                  feedback: reviewFeedback,
                },
              },
            },
          ],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[1]).toMatchObject({
      id: 'review-reviewer',
      key: 'reviewer',
      gate: {
        success: {
          language: 'cel',
          source: 'step.exit_code == 0',
          check: 'typed',
          resultType: 'bool',
        },
        onFailure: {
          restartFrom: 'producer',
          feedback: reviewFeedback,
          feedbackTemplate: [
            {kind: 'literal', value: 'Agent rejected the PR '},
            expect.objectContaining({kind: 'deferred'}),
          ],
        },
      },
    });
  });

  it('normalizes run step exit-code gates', () => {
    const document: WorkflowDocument = {
      name: 'simple build',
      jobs: {
        build: {
          steps: [{name: 'build', run: 'npm run build', gate: {success: 'step.exit_code == 0'}}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[0]?.gate?.success).toEqual({
      language: 'cel',
      source: 'step.exit_code == 0',
      check: 'typed',
      resultType: 'bool',
    });
  });

  it('accepts step.status in a gate success', () => {
    const document: WorkflowDocument = {
      name: 'status gate',
      jobs: {
        build: {
          steps: [{run: 'npm run build', gate: {success: 'step.status == "succeeded"'}}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[0]?.gate?.success).toEqual({
      language: 'cel',
      source: 'step.status == "succeeded"',
      check: 'typed',
      resultType: 'bool',
    });
  });

  it('rejects server roots omitted from the gate success context', () => {
    const document: WorkflowDocument = {
      name: 'server-context gate',
      jobs: {
        build: {steps: [{run: 'npm run build', gate: {success: 'run.id != ""'}}]},
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'context-unavailable-at-predicate-site',
        message: expect.stringContaining('Step gate success references context "run"'),
        path: ['jobs', 'build', 'steps', 0, 'gate', 'success'],
        details: expect.objectContaining({
          field: 'step.success',
          source: 'run.id != ""',
          unavailableRoots: ['run'],
          site: 'step-report',
        }),
      }),
    ]);
  });

  it('rejects runner-host roots in gate success with a server-predicate issue', () => {
    const document: WorkflowDocument = {
      name: 'runner-context gate',
      jobs: {
        build: {
          steps: [{run: 'npm run build', gate: {success: 'runner.os == "linux"'}}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'runner-context-in-server-predicate',
        message: expect.stringContaining('cannot reference runner context "runner"'),
        path: ['jobs', 'build', 'steps', 0, 'gate', 'success'],
        details: expect.objectContaining({
          field: 'step.success',
          source: 'runner.os == "linux"',
          runnerRoots: ['runner'],
          site: 'step-report',
        }),
      }),
    ]);
  });

  it('accepts vars in gate success', () => {
    const document: WorkflowDocument = {
      name: 'vars-context gate',
      jobs: {
        build: {
          steps: [{run: 'npm run build', gate: {success: 'vars.REQUIRED == "true"'}}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[0]?.gate?.success).toMatchObject({
      source: 'vars.REQUIRED == "true"',
      check: 'syntax',
    });
  });

  it('rejects jobs root references omitted from the gate success context', () => {
    const document: WorkflowDocument = {
      name: 'jobs-context gate',
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
        deploy: {
          needs: ['build'],
          steps: [{run: 'npm run deploy', gate: {success: 'jobs.build.status == "succeeded"'}}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'context-unavailable-at-predicate-site',
        message: expect.stringContaining('Step gate success references context "jobs"'),
        path: ['jobs', 'deploy', 'steps', 0, 'gate', 'success'],
        details: expect.objectContaining({
          field: 'step.success',
          source: 'jobs.build.status == "succeeded"',
          unavailableRoots: ['jobs'],
          site: 'step-report',
        }),
      }),
    ]);
  });

  it('parses job output mappings at execution resolution', () => {
    const document: WorkflowDocument = {
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

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.outputs).toEqual({
      image_sha: [
        {
          kind: 'deferred',
          expression: {
            language: 'cel',
            source: 'steps.build.outputs.sha',
            check: 'syntax',
          },
          roots: ['steps'],
          fillTarget: 'execution-resolution',
        },
      ],
      registry: [{kind: 'literal', value: 'registry.example.com'}],
    });
  });

  it('normalizes typed step output declarations', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['digest'],
      properties: {digest: {type: 'string'}},
    };
    const document: WorkflowDocument = {
      name: 'typed outputs',
      jobs: {
        build: {
          steps: [
            {
              key: 'build',
              run: 'npm run build',
              outputs: {
                count: {type: 'number'},
                metadata: {type: 'json', schema},
              },
            },
          ],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[0]).toMatchObject({
      outputs: {
        count: {type: 'number'},
        metadata: {type: 'json', schema},
      },
    });
  });

  it('reports invalid JSON schemas on typed step outputs', () => {
    const document: WorkflowDocument = {
      name: 'bad output schema',
      jobs: {
        build: {
          steps: [
            {
              key: 'build',
              run: 'npm run build',
              outputs: {
                metadata: {type: 'json', schema: {type: 'wat'}},
              },
            },
          ],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-output-schema',
        path: ['jobs', 'build', 'steps', 0, 'outputs', 'metadata', 'schema'],
      }),
    ]);
  });

  it('type-checks declared step outputs in later step config', () => {
    const document: WorkflowDocument = {
      name: 'typed step output config',
      jobs: {
        build: {
          steps: [
            {
              key: 'collect',
              run: 'npm run collect',
              outputs: {
                count: {type: 'number'},
                ready: {type: 'boolean'},
              },
            },
            {
              prompt: `Review ${interpolation('steps.collect.outputs.count > 5')}`,
            },
            {
              run: 'echo ok',
              env: {READY: interpolation('steps.collect.outputs.ready')},
            },
          ],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[1]).toMatchObject({
      kind: 'agent',
      templates: {
        prompt: [
          {kind: 'literal', value: 'Review '},
          {
            kind: 'deferred',
            expression: {
              source: 'steps.collect.outputs.count > 5',
              check: 'typed',
              resultType: 'bool',
            },
            roots: ['steps'],
          },
        ],
      },
    });
    expect(model.jobs[0]?.steps[2]).toMatchObject({
      kind: 'run',
      templates: {
        env: {
          READY: [
            {
              kind: 'deferred',
              expression: {
                source: 'steps.collect.outputs.ready',
                check: 'typed',
                resultType: 'bool',
              },
              roots: ['steps'],
            },
          ],
        },
      },
    });
  });

  it('rejects undeclared typed step output keys', () => {
    const document: WorkflowDocument = {
      name: 'bad typed output key',
      jobs: {
        build: {
          steps: [
            {key: 'collect', run: 'npm run collect', outputs: {count: {type: 'number'}}},
            {run: 'echo ok', env: {COUNT: interpolation('steps.collect.outputs.missing')}},
          ],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-interpolation-expression',
        path: ['jobs', 'build', 'steps', 1, 'env', 'COUNT'],
      }),
    ]);
  });

  it('rejects typed step output references to unknown steps', () => {
    const document: WorkflowDocument = {
      name: 'bad typed step key',
      jobs: {
        build: {
          steps: [
            {key: 'collect', run: 'npm run collect', outputs: {count: {type: 'number'}}},
            {run: 'echo ok', env: {COUNT: interpolation('steps.other.outputs.count')}},
          ],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-interpolation-expression',
        path: ['jobs', 'build', 'steps', 1, 'env', 'COUNT'],
      }),
    ]);
  });

  it('rejects typed step output references to later steps', () => {
    const document: WorkflowDocument = {
      name: 'later typed step output',
      jobs: {
        build: {
          steps: [
            {run: 'echo ok', env: {COUNT: interpolation('steps.collect.outputs.count')}},
            {key: 'collect', run: 'npm run collect', outputs: {count: {type: 'number'}}},
          ],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-interpolation-expression',
        path: ['jobs', 'build', 'steps', 0, 'env', 'COUNT'],
      }),
    ]);
  });

  it('allows typed step self outputs in gate success expressions', () => {
    const document: WorkflowDocument = {
      name: 'typed self gate',
      jobs: {
        build: {
          steps: [
            {
              key: 'collect',
              run: 'npm run collect',
              outputs: {count: {type: 'number'}},
              gate: {success: 'step.outputs.count > 5'},
            },
          ],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[0]?.gate?.success).toEqual({
      language: 'cel',
      source: 'step.outputs.count > 5',
      check: 'typed',
      resultType: 'bool',
    });
  });

  it('allows integer equality literals for number step outputs in gate success expressions', () => {
    const document: WorkflowDocument = {
      name: 'number output equality',
      jobs: {
        build: {
          steps: [
            {
              key: 'collect',
              run: 'npm run collect',
              outputs: {issue_number: {type: 'number'}},
              gate: {success: 'step.outputs.issue_number == 1'},
            },
          ],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[0]?.gate?.success).toEqual({
      language: 'cel',
      source: 'step.outputs.issue_number == 1',
      check: 'typed',
      resultType: 'bool',
    });
  });

  it('allows step outputs in run fields', () => {
    const document: WorkflowDocument = {
      name: 'untrusted step output',
      jobs: {
        build: {
          steps: [
            {key: 'collect', run: 'npm run collect', outputs: {value: {type: 'string'}}},
            {run: `echo ${interpolation('steps.collect.outputs.value')}`},
          ],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[1]).toMatchObject({
      kind: 'run',
      templates: {
        command: [
          {kind: 'literal', value: 'echo '},
          {kind: 'deferred', roots: ['steps']},
        ],
      },
    });
  });

  it('infers typed job output scalars for downstream job overlays', () => {
    const document: WorkflowDocument = {
      name: 'typed job outputs',
      jobs: {
        build: {
          steps: [{key: 'collect', run: 'npm run collect', outputs: {count: {type: 'number'}}}],
          outputs: {
            count: interpolation('steps.collect.outputs.count'),
          },
        },
        deploy: {
          needs: 'build',
          success: 'jobs.build.outputs.count > 5',
          steps: [{prompt: `Deploy ${interpolation('jobs.build.outputs.count')}`}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.outputTypes).toEqual({count: 'double'});
    expect(model.jobs[1]?.steps[0]).toMatchObject({
      kind: 'agent',
      templates: {
        prompt: [
          {kind: 'literal', value: 'Deploy '},
          {
            kind: 'deferred',
            expression: {
              source: 'jobs.build.outputs.count',
              check: 'typed',
              resultType: 'double',
            },
            roots: ['jobs'],
          },
        ],
      },
    });
  });

  it('rejects downstream references to undeclared typed job outputs', () => {
    const document: WorkflowDocument = {
      name: 'bad typed job output',
      jobs: {
        build: {
          steps: [{key: 'collect', run: 'npm run collect', outputs: {count: {type: 'number'}}}],
          outputs: {
            count: interpolation('steps.collect.outputs.count'),
          },
        },
        deploy: {
          needs: 'build',
          steps: [
            {
              prompt: interpolation('jobs.build.outputs.missing'),
            },
          ],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-interpolation-expression',
        path: ['jobs', 'deploy', 'steps', 0, 'prompt'],
      }),
    ]);
  });

  it('keeps untyped direct-needs outputs open when another upstream job is typed', () => {
    const document: WorkflowDocument = {
      name: 'mixed upstream output typing',
      jobs: {
        build: {
          steps: [{key: 'collect', run: 'npm run collect', outputs: {count: {type: 'number'}}}],
          outputs: {
            count: interpolation('steps.collect.outputs.count'),
          },
        },
        lint: {
          steps: [{run: 'npm run lint'}],
          outputs: {
            summary: interpolation('steps.step_1.outputs.summary'),
          },
        },
        deploy: {
          needs: ['build', 'lint'],
          steps: [
            {
              prompt: interpolation('jobs.lint.outputs.summary'),
            },
          ],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[2]?.steps[0]).toMatchObject({
      kind: 'agent',
      templates: {
        prompt: [
          {
            kind: 'deferred',
            expression: {source: 'jobs.lint.outputs.summary', check: 'typed'},
            roots: ['jobs'],
          },
        ],
      },
    });
  });

  it('infers structured typed job output mappings', () => {
    const document: WorkflowDocument = {
      name: 'structured job output type',
      jobs: {
        build: {
          steps: [
            {
              key: 'collect',
              run: 'npm run collect',
              outputs: {
                metadata: {
                  type: 'json',
                  schema: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['severity'],
                      properties: {severity: {type: 'string'}},
                    },
                  },
                },
              },
            },
          ],
          outputs: {
            metadata: interpolation('steps.collect.outputs.metadata'),
          },
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.outputTypes).toEqual({
      metadata: {
        kind: 'list',
        element: {
          kind: 'object',
          fields: {severity: 'string'},
        },
      },
    });
  });

  it('authorizes indexed reads from structured job outputs', () => {
    const document: WorkflowDocument = {
      name: 'indexed structured job output',
      jobs: {
        review: {
          steps: [
            {
              key: 'inspect',
              run: 'npm run inspect',
              outputs: {
                findings: {
                  type: 'json',
                  schema: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['severity'],
                      properties: {severity: {type: 'string'}},
                    },
                  },
                },
              },
            },
          ],
          outputs: {
            findings: interpolation('steps.inspect.outputs.findings'),
          },
        },
        summarize: {
          needs: ['review'],
          steps: [
            {
              run: `printf '%s\\n' ${interpolation('jobs.review.outputs.findings[0].severity')}`,
            },
          ],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);
    const summarize = model.jobs.find((job) => job.key === 'summarize');

    expect(summarize?.steps[0]).toMatchObject({
      kind: 'run',
      templates: {
        command: [
          {kind: 'literal', value: "printf '%s\\n' "},
          {
            kind: 'deferred',
            expression: {
              source: 'jobs.review.outputs.findings[0].severity',
              check: 'typed',
            },
            roots: ['jobs'],
          },
        ],
      },
    });
  });

  it('rejects job output references without a direct needs edge', () => {
    const document: WorkflowDocument = {
      name: 'missing output edge',
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
        deploy: {
          steps: [{run: 'npm run deploy'}],
          outputs: {
            image_sha: interpolation('jobs.build.outputs.image_sha'),
          },
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'missing-job-needs-edge',
        path: ['jobs', 'deploy', 'outputs', 'image_sha'],
        details: expect.objectContaining({
          field: 'job.outputs',
          job: 'build',
        }),
      }),
    ]);
  });

  it('rejects config references without a direct needs edge', () => {
    const document: WorkflowDocument = {
      name: 'missing config edge',
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
        deploy: {
          env: {IMAGE_SHA: interpolation('jobs.build.outputs.image_sha')},
          steps: [{run: 'npm run deploy'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'missing-job-needs-edge',
        path: ['jobs', 'deploy', 'env', 'IMAGE_SHA'],
        details: expect.objectContaining({
          field: 'env.value',
          job: 'build',
        }),
      }),
    ]);
  });

  it('accepts execution fields and event data in job success expressions', () => {
    const document: WorkflowDocument = {
      name: 'full-shape job success',
      jobs: {
        build: {
          success:
            'executions.all(e, e.name != "") && executions.all(e, e.events.all(ev, ev.data.ok == true))',
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.success).toBe(
      'executions.all(e, e.name != "") && executions.all(e, e.events.all(ev, ev.data.ok == true))',
    );
  });

  it('rejects unwrapped if predicates', () => {
    const document: WorkflowDocument = {
      name: 'unwrapped condition',
      jobs: {
        build: {
          if: 'true',
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-job-if',
        path: ['jobs', 'build', 'if'],
        details: expect.objectContaining({
          field: 'job.if',
          source: 'true',
        }),
      }),
    ]);
  });

  it('rejects non-boolean if predicates', () => {
    const document: WorkflowDocument = {
      name: 'non boolean condition',
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
        deploy: {
          needs: 'build',
          if: interpolation('jobs.build.status'),
          steps: [{run: 'npm run deploy'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-job-if',
        path: ['jobs', 'deploy', 'if'],
        details: expect.objectContaining({
          field: 'job.if',
          source: 'jobs.build.status',
        }),
      }),
    ]);
  });

  it('rejects runner and secrets roots in if predicates', () => {
    const document: WorkflowDocument = {
      name: 'server-only conditions',
      jobs: {
        build: {
          if: interpolation('secrets.local.TOKEN != ""'),
          steps: [{if: interpolation('runner.os == "linux"'), run: 'npm run build'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'runner-context-in-server-predicate',
          path: ['jobs', 'build', 'if'],
          details: expect.objectContaining({field: 'job.if', runnerRoots: ['secrets']}),
        }),
        expect.objectContaining({
          code: 'runner-context-in-server-predicate',
          path: ['jobs', 'build', 'steps', 0, 'if'],
          details: expect.objectContaining({field: 'step.if', runnerRoots: ['runner']}),
        }),
      ]),
    );
  });

  it('accepts vars in job and step if predicates', () => {
    const document: WorkflowDocument = {
      name: 'vars condition',
      jobs: {
        build: {
          if: interpolation('vars.REQUIRED == "true"'),
          steps: [{if: interpolation('vars.REQUIRED == "true"'), run: 'npm run build'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.if).toMatchObject({
      source: 'vars.REQUIRED == "true"',
      check: 'typed',
      resultType: 'bool',
    });
    expect(model.jobs[0]?.steps[0]?.if).toMatchObject({
      source: 'vars.REQUIRED == "true"',
      check: 'typed',
      resultType: 'bool',
    });
  });

  it('rejects if job references without a direct needs edge', () => {
    const document: WorkflowDocument = {
      name: 'missing condition edge',
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
        deploy: {
          if: interpolation('jobs.build.status == "succeeded"'),
          steps: [{run: 'npm run deploy'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'missing-job-needs-edge',
        path: ['jobs', 'deploy', 'if'],
        details: expect.objectContaining({
          field: 'job.if',
          job: 'build',
        }),
      }),
    ]);
  });

  it('rejects needs aggregation when the job has no direct needs', () => {
    const document: WorkflowDocument = {
      name: 'missing needs',
      jobs: {
        notify: {
          if: interpolation('needs.exists(n, n.status == "failed")'),
          steps: [{run: 'npm run notify'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-job-if',
        path: ['jobs', 'notify', 'if'],
        details: expect.objectContaining({
          field: 'job.if',
          rejectedRoots: ['needs'],
        }),
      }),
    ]);
  });

  it('rejects step if references to later steps', () => {
    const document: WorkflowDocument = {
      name: 'forward condition',
      jobs: {
        build: {
          steps: [
            {if: interpolation('steps.deploy.status == "succeeded"'), run: 'npm test'},
            {key: 'deploy', run: 'npm run deploy'},
          ],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-step-if',
        path: ['jobs', 'build', 'steps', 0, 'if'],
        details: expect.objectContaining({
          field: 'step.if',
          source: 'steps.deploy.status == "succeeded"',
        }),
      }),
    ]);
  });

  it('rejects execution.failed before step dispatch', () => {
    const document: WorkflowDocument = {
      name: 'early execution failed',
      jobs: {
        build: {
          if: interpolation('execution.failed'),
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'context-unavailable-at-predicate-site',
        path: ['jobs', 'build', 'if'],
        details: expect.objectContaining({
          field: 'job.if',
          unavailableRoots: ['execution'],
        }),
      }),
    ]);
  });

  it('reports invalid job success expressions', () => {
    const document: WorkflowDocument = {
      name: 'invalid job success',
      jobs: {
        build: {
          success: 'executions.exists(e, e.status == )',
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-job-success',
        path: ['jobs', 'build', 'success'],
        details: expect.objectContaining({source: 'executions.exists(e, e.status == )'}),
      }),
    ]);
  });

  it('reports non-boolean job success expressions', () => {
    const document: WorkflowDocument = {
      name: 'non-boolean job success',
      jobs: {
        build: {
          success: 'executions.size()',
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-job-success',
        path: ['jobs', 'build', 'success'],
        details: expect.objectContaining({
          source: 'executions.size()',
          reason: expect.stringContaining('must return bool'),
        }),
      }),
    ]);
  });

  it('reports rootless non-boolean job success expressions', () => {
    const document: WorkflowDocument = {
      name: 'rootless non-boolean job success',
      jobs: {
        build: {
          success: '1 + 2',
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-job-success',
        path: ['jobs', 'build', 'success'],
        details: expect.objectContaining({
          source: '1 + 2',
          reason: expect.stringContaining('must return bool'),
        }),
      }),
    ]);
  });

  it('reports misspelled execution fields in job success expressions', () => {
    const document: WorkflowDocument = {
      name: 'misspelled job success',
      jobs: {
        build: {
          success: 'executions.all(e, e.statsu == "succeeded")',
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-job-success',
        path: ['jobs', 'build', 'success'],
        details: expect.objectContaining({
          source: 'executions.all(e, e.statsu == "succeeded")',
          reason: expect.stringContaining('statsu'),
        }),
      }),
    ]);
  });

  it('rejects runner-host roots in job success with a server-predicate issue', () => {
    const document: WorkflowDocument = {
      name: 'runner-context job success',
      jobs: {
        build: {
          success: 'runner.os == "linux"',
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'runner-context-in-server-predicate',
        message: expect.stringContaining('cannot reference runner context "runner"'),
        path: ['jobs', 'build', 'success'],
        details: expect.objectContaining({
          field: 'job.success',
          source: 'runner.os == "linux"',
          runnerRoots: ['runner'],
          site: 'job-resolution',
        }),
      }),
    ]);
  });

  it('accepts vars in job success', () => {
    const document: WorkflowDocument = {
      name: 'vars-context job success',
      jobs: {
        build: {
          success: 'vars.ENVIRONMENT == "prod"',
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.success).toBe('vars.ENVIRONMENT == "prod"');
  });

  it('reports malformed job execution timeouts', () => {
    const document: WorkflowDocument = {
      name: 'invalid timeout',
      jobs: {
        build: {
          execution_timeout: 'ten minutes',
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'invalid-duration',
        message: 'Duration must be an integer followed by ms, s, m, h, or d.',
        path: ['jobs', 'build', 'execution_timeout'],
        details: {source: 'ten minutes'},
        severity: 'error',
        scope: 'definition',
      },
    ]);
  });

  it('reports job execution timeouts below 1s', () => {
    const document: WorkflowDocument = {
      name: 'short timeout',
      jobs: {
        build: {
          execution_timeout: '999ms',
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'invalid-duration',
        message: 'Duration must be between 1s and 24h.',
        path: ['jobs', 'build', 'execution_timeout'],
        details: {source: '999ms', min_ms: 1000, max_ms: 24 * 60 * 60 * 1000},
        severity: 'error',
        scope: 'definition',
      },
    ]);
  });

  it('reports job execution timeouts above 24h', () => {
    const document: WorkflowDocument = {
      name: 'long timeout',
      jobs: {
        build: {
          execution_timeout: '25h',
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'invalid-duration',
        message: 'Duration must be between 1s and 24h.',
        path: ['jobs', 'build', 'execution_timeout'],
        details: {source: '25h', min_ms: 1000, max_ms: 24 * 60 * 60 * 1000},
        severity: 'error',
        scope: 'definition',
      },
    ]);
  });

  it('reports day-based job execution timeouts above 24h', () => {
    const document: WorkflowDocument = {
      name: 'long timeout',
      jobs: {
        build: {
          execution_timeout: '30d',
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'invalid-duration',
        message: 'Duration must be between 1s and 24h.',
        path: ['jobs', 'build', 'execution_timeout'],
        details: {source: '30d', min_ms: 1000, max_ms: 24 * 60 * 60 * 1000},
        severity: 'error',
        scope: 'definition',
      },
    ]);
  });

  it('normalizes on_failure-only gates', () => {
    const document: WorkflowDocument = {
      name: 'retry build',
      jobs: {
        build: {
          steps: [
            {key: 'install', run: 'npm install'},
            {key: 'build', run: 'npm run build', gate: {on_failure: {restart_from: 'install'}}},
          ],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[1]?.gate).toEqual({
      onFailure: {restartFrom: 'install'},
    });
  });

  it('accepts step outputs in gate success expressions', () => {
    const document: WorkflowDocument = {
      name: 'output gate',
      jobs: {
        build: {
          steps: [{run: 'npm run build', gate: {success: 'step.outputs.pass == true'}}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[0]?.gate?.success).toEqual({
      language: 'cel',
      source: 'step.outputs.pass == true',
      check: 'typed',
      resultType: 'bool',
    });
  });

  it('reports non-boolean gate success expressions', () => {
    const document: WorkflowDocument = {
      name: 'non-boolean gate',
      jobs: {
        build: {
          steps: [{run: 'npm run build', gate: {success: 'step.exit_code + 1'}}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-step-gate-success',
        path: ['jobs', 'build', 'steps', 0, 'gate', 'success'],
        details: expect.objectContaining({
          source: 'step.exit_code + 1',
          reason: expect.stringContaining('must return bool'),
        }),
      }),
    ]);
  });

  it('reports gate restart_from references to unknown steps', () => {
    const document: WorkflowDocument = {
      name: 'invalid gate',
      jobs: {
        build: {
          steps: [
            {
              key: 'review',
              run: 'npm run review',
              gate: {on_failure: {restart_from: 'producer'}},
            },
          ],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'invalid-step-gate-restart-from',
        message: 'Step "build-review" must restart from an earlier keyed step; found "producer".',
        path: ['jobs', 'build', 'steps', 0, 'gate', 'on_failure'],
        details: {stepId: 'build-review', restartFrom: 'producer'},
        severity: 'error',
        scope: 'definition',
      },
    ]);
  });

  it('reports gate restart_from references to the same step', () => {
    const document: WorkflowDocument = {
      name: 'invalid gate',
      jobs: {
        build: {
          steps: [
            {
              key: 'review',
              run: 'npm run review',
              gate: {on_failure: {restart_from: 'review'}},
            },
          ],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'invalid-step-gate-restart-from',
        message: 'Step "build-review" must restart from an earlier keyed step; found "review".',
        path: ['jobs', 'build', 'steps', 0, 'gate', 'on_failure'],
        details: {stepId: 'build-review', restartFrom: 'review'},
        severity: 'error',
        scope: 'definition',
      },
    ]);
  });

  it('reports gate restart_from references to later steps', () => {
    const document: WorkflowDocument = {
      name: 'invalid gate',
      jobs: {
        build: {
          steps: [
            {
              key: 'review',
              run: 'npm run review',
              gate: {on_failure: {restart_from: 'producer'}},
            },
            {key: 'producer', run: 'npm run build'},
          ],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'invalid-step-gate-restart-from',
        message: 'Step "build-review" must restart from an earlier keyed step; found "producer".',
        path: ['jobs', 'build', 'steps', 0, 'gate', 'on_failure'],
        details: {stepId: 'build-review', restartFrom: 'producer'},
        severity: 'error',
        scope: 'definition',
      },
    ]);
  });

  it('reports unknown dependencies', () => {
    const document: WorkflowDocument = {
      name: 'unknown dependency',
      jobs: {
        test: {
          needs: 'build',
          steps: [{run: 'npm test'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'unknown-job-dependency',
        message: 'Job "test" depends on unknown job "build".',
        path: ['jobs', 'test', 'needs'],
        details: {job: 'test', dependency: 'build'},
        severity: 'error',
        scope: 'definition',
      },
    ]);
  });

  it('reports self dependencies', () => {
    const document: WorkflowDocument = {
      name: 'self dependency',
      jobs: {
        test: {
          needs: 'test',
          steps: [{run: 'npm test'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'self-job-dependency',
        message: 'Job "test" depends on itself.',
        path: ['jobs', 'test', 'needs'],
        details: {job: 'test'},
        severity: 'error',
        scope: 'definition',
      },
    ]);
  });

  it('reports dependency cycles', () => {
    const document: WorkflowDocument = {
      name: 'cycle',
      jobs: {
        build: {
          needs: 'test',
          steps: [{run: 'npm run build'}],
        },
        test: {
          needs: 'build',
          steps: [{run: 'npm test'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'job-dependency-cycle',
        message: 'Circular dependency detected among jobs: build, test.',
        path: ['jobs'],
        details: {cycleSourceNames: ['build', 'test'], cycleJobIds: ['build', 'test']},
        severity: 'error',
        scope: 'definition',
      },
    ]);
  });

  it('reports only cycle members for dependencies blocked by a cycle', () => {
    const document: WorkflowDocument = {
      name: 'cycle with dependent',
      jobs: {
        build: {
          needs: 'test',
          steps: [{run: 'npm run build'}],
        },
        test: {
          needs: 'build',
          steps: [{run: 'npm test'}],
        },
        deploy: {
          needs: 'build',
          steps: [{run: 'npm run deploy'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'job-dependency-cycle',
        message: 'Circular dependency detected among jobs: build, test.',
        path: ['jobs'],
        details: {cycleSourceNames: ['build', 'test'], cycleJobIds: ['build', 'test']},
        severity: 'error',
        scope: 'definition',
      },
    ]);
  });

  it('reports stable job id collisions', () => {
    const document: WorkflowDocument = {
      name: 'collision',
      jobs: {
        'build app': {
          steps: [{run: 'npm run build'}],
        },
        'build-app': {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'duplicate-job-id',
        message: 'Job keys "build app" and "build-app" resolve to the same stable id "build-app".',
        path: ['jobs', 'build-app'],
        details: {id: 'build-app', sourceKeys: ['build app', 'build-app']},
        severity: 'error',
        scope: 'definition',
      },
    ]);
  });

  it('normalizes trimmed and symbolic job names into stable ids', () => {
    const document: WorkflowDocument = {
      name: 'stable ids',
      jobs: {
        '  Build App  ': {
          steps: [{run: 'npm run build'}],
        },
        '!!!': {
          steps: [{run: 'npm test'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs.map((job) => ({id: job.id, key: job.key}))).toEqual([
      {id: 'build-app', key: '  Build App  '},
      {id: 'unnamed', key: '!!!'},
    ]);
  });

  it('reports stable trigger id collisions with the later trigger inert', () => {
    const document: WorkflowDocument = {
      name: 'trigger collision',
      triggers: {
        main_push: {source: 'github', event: 'push'},
        'main push': {source: 'github', event: 'push'},
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const {model, diagnostics} = normalizeWithDiagnostics(document);

    expect(diagnostics).toEqual([
      {
        code: 'duplicate-trigger-id',
        message:
          'Trigger keys "main_push" and "main push" resolve to the same stable id "main-push".',
        path: ['triggers', 'main push'],
        details: {id: 'main-push', sourceKeys: ['main_push', 'main push']},
        severity: 'error',
        scope: 'trigger',
      },
    ]);
    expect(model.triggers.map((trigger) => trigger.key)).toEqual(['main_push']);
  });

  it('reports stable step id collisions inside a job', () => {
    const document: WorkflowDocument = {
      name: 'step collision',
      jobs: {
        build: {
          steps: [{run: 'npm install'}, {key: 'step 1', run: 'npm test'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'duplicate-step-id',
        message: 'Steps 0 and 1 in job "build" resolve to the same stable id "build-step-1".',
        path: ['jobs', 'build', 'steps', 1],
        details: {id: 'build-step-1', indexes: [0, 1]},
        severity: 'error',
        scope: 'definition',
      },
    ]);
  });

  it('validates trigger filters while preserving their source strings', () => {
    const document: WorkflowDocument = {
      name: 'validated trigger filter',
      triggers: {
        main: {
          source: 'github',
          event: 'push',
          filter: 'event.ref == "refs/heads/main" && trigger.source == "github"',
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.triggers).toEqual([
      {
        id: 'main',
        key: 'main',
        source: 'github',
        event: 'push',
        filter: 'event.ref == "refs/heads/main" && trigger.source == "github"',
      },
    ]);
  });

  it.each([
    [
      'jobs root',
      'jobs.build.outputs.result == "ok"',
      'context-unavailable-at-predicate-site',
      {
        field: 'trigger.filter',
        source: 'jobs.build.outputs.result == "ok"',
        contextRoots: ['jobs'],
        unavailableRoots: ['jobs'],
        site: 'ingest',
      },
    ],
    [
      'run root',
      'run.id == "run-1"',
      'context-unavailable-at-predicate-site',
      {
        field: 'trigger.filter',
        source: 'run.id == "run-1"',
        contextRoots: ['run'],
        unavailableRoots: ['run'],
        site: 'ingest',
      },
    ],
    [
      'runner root',
      'runner.os == "linux"',
      'runner-context-in-server-predicate',
      {
        field: 'trigger.filter',
        source: 'runner.os == "linux"',
        contextRoots: ['runner'],
        runnerRoots: ['runner'],
        site: 'ingest',
      },
    ],
    [
      'vars root',
      'vars.environment == "prod"',
      'context-unavailable-at-predicate-site',
      {
        field: 'trigger.filter',
        source: 'vars.environment == "prod"',
        contextRoots: ['vars'],
        unavailableRoots: ['vars'],
        site: 'ingest',
      },
    ],
  ] as const)('rejects trigger filters with %s', (_label, filter, code, details) => {
    const document: WorkflowDocument = {
      name: 'invalid trigger filter',
      triggers: {
        main: {
          source: 'github',
          event: 'push',
          filter,
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code,
        message: expect.any(String),
        path: ['triggers', 'main', 'filter'],
        details,
        severity: 'error',
        scope: 'definition',
      },
    ]);
  });

  it('makes a trigger with a non-boolean filter inert', () => {
    const document: WorkflowDocument = {
      name: 'invalid trigger filter',
      triggers: {
        main: {
          source: 'github',
          event: 'push',
          filter: 'event.ref',
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const {model, diagnostics} = normalizeWithDiagnostics(document);

    expect(diagnostics).toEqual([
      {
        code: 'invalid-trigger-filter',
        message: expect.any(String),
        path: ['triggers', 'main', 'filter'],
        details: {
          field: 'trigger.filter',
          source: 'event.ref',
          contextRoots: ['event'],
          reason: 'Predicate source must be boolean-shaped.',
        },
        severity: 'error',
        scope: 'trigger',
      },
    ]);
    expect(model.triggers).toEqual([]);
  });

  it.each(['manual', 'cron'] as const)('makes a %s trigger with a filter inert', (source) => {
    const document: WorkflowDocument = {
      name: 'unsupported trigger filter',
      triggers: {
        main: {
          source,
          event: source === 'cron' ? 'tick' : 'fire',
          filter: 'event.ref == "refs/heads/main"',
          ...(source === 'cron' ? {config: {schedule: '0 2 * * *'}} : {}),
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const {model, diagnostics} = normalizeWithDiagnostics(document);

    expect(diagnostics).toEqual([
      {
        code: 'invalid-trigger-filter',
        message: `A ${source} trigger cannot define a filter because it does not receive an event payload.`,
        path: ['triggers', 'main', 'filter'],
        details: {source: 'event.ref == "refs/heads/main"', triggerSource: source},
        severity: 'error',
        scope: 'trigger',
      },
    ]);
    expect(model.triggers).toEqual([]);
  });

  it('maps trigger with values to model inputs', () => {
    const document: WorkflowDocument = {
      name: 'inputs',
      triggers: {
        dispatch: {
          source: 'github',
          event: 'workflow_dispatch',
          with: {environment: 'production'},
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.triggers).toEqual([
      {
        id: 'dispatch',
        key: 'dispatch',
        source: 'github',
        event: 'workflow_dispatch',
        inputs: {environment: 'production'},
      },
    ]);
  });

  it('normalizes a valid cron trigger with the default timezone', () => {
    const document: WorkflowDocument = {
      name: 'nightly trigger',
      triggers: {
        nightly: {
          source: 'cron',
          event: 'tick',
          config: {schedule: '0 2 * * *'},
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.triggers).toEqual([
      {
        id: 'nightly',
        key: 'nightly',
        source: 'cron',
        event: 'tick',
        config: {
          schedule: '0 2 * * *',
          timezone: 'UTC',
        },
      },
    ]);
  });

  it('normalizes a valid cron trigger with an explicit timezone', () => {
    const document: WorkflowDocument = {
      name: 'nightly trigger',
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

    const model = normalizeWorkflowDocument(document);

    expect(model.triggers).toEqual([
      {
        id: 'nightly',
        key: 'nightly',
        source: 'cron',
        event: 'tick',
        config: {
          schedule: '0 2 * * *',
          timezone: 'Europe/Paris',
        },
      },
    ]);
  });

  it('materializes fire for a manual trigger with the event omitted', () => {
    const document: WorkflowDocument = {
      name: 'manual trigger',
      triggers: {
        manual: {source: 'manual'},
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.triggers).toEqual([
      {
        id: 'manual',
        key: 'manual',
        source: 'manual',
        event: 'fire',
      },
    ]);
  });

  it('materializes tick for a cron trigger with the event omitted', () => {
    const document: WorkflowDocument = {
      name: 'nightly trigger',
      triggers: {
        nightly: {
          source: 'cron',
          config: {schedule: '0 2 * * *'},
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.triggers).toEqual([
      {
        id: 'nightly',
        key: 'nightly',
        source: 'cron',
        event: 'tick',
        config: {
          schedule: '0 2 * * *',
          timezone: 'UTC',
        },
      },
    ]);
  });

  it('makes a cron trigger with a non-tick event inert', () => {
    const document: WorkflowDocument = {
      name: 'nightly trigger',
      triggers: {
        nightly: {
          source: 'cron',
          event: 'push',
          config: {schedule: '0 2 * * *'},
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const {model, diagnostics} = normalizeWithDiagnostics(document);

    expect(diagnostics).toEqual([
      {
        code: 'invalid-trigger-event',
        message: 'A cron trigger must use event "tick"; found "push".',
        path: ['triggers', 'nightly', 'event'],
        details: {event: 'push', source: 'cron'},
        severity: 'error',
        scope: 'trigger',
      },
    ]);
    expect(model.triggers).toEqual([]);
  });

  it('warns about an unknown trigger source and keeps the trigger active', () => {
    const document: WorkflowDocument = {
      name: 'unknown source',
      triggers: {
        on_deploy: {
          source: 'deploy_hook',
          event: 'received',
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const {model, diagnostics} = normalizeWithDiagnostics(document, {
      integrationValidationContext,
    });

    expect(diagnostics).toEqual([
      {
        code: 'unknown-trigger-source',
        message:
          'Source "deploy_hook" matches no connection in this workspace; the trigger stays active and fires once a connection with this slug exists.',
        path: ['triggers', 'on_deploy'],
        details: {source: 'deploy_hook'},
        severity: 'warning',
        scope: 'trigger',
      },
    ]);
    expect(model.triggers).toEqual([
      {id: 'on-deploy', key: 'on_deploy', source: 'deploy_hook', event: 'received'},
    ]);
  });

  it('reports only unknown-trigger-source for an unknown slug with an explicit event', () => {
    const document: WorkflowDocument = {
      name: 'unknown source with event',
      triggers: {
        on_deploy: {
          source: 'deploy_hook',
          event: 'pushh',
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const {model, diagnostics} = normalizeWithDiagnostics(document, {
      integrationValidationContext,
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['unknown-trigger-source']);
    expect(model.triggers).toEqual([
      {id: 'on-deploy', key: 'on_deploy', source: 'deploy_hook', event: 'pushh'},
    ]);
  });

  it('makes a manual trigger with a non-fire event inert', () => {
    const document: WorkflowDocument = {
      name: 'manual trigger',
      triggers: {
        on_demand: {
          source: 'manual',
          event: 'run',
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const {model, diagnostics} = normalizeWithDiagnostics(document);

    expect(diagnostics).toEqual([
      {
        code: 'invalid-trigger-event',
        message: 'A manual trigger must use event "fire"; found "run".',
        path: ['triggers', 'on_demand', 'event'],
        details: {event: 'run', source: 'manual'},
        severity: 'error',
        scope: 'trigger',
      },
    ]);
    expect(model.triggers).toEqual([]);
  });

  it('makes a webhook trigger with a non-received event inert', () => {
    const document: WorkflowDocument = {
      name: 'webhook trigger',
      triggers: {
        on_deploy: {
          source: 'deploy-hook',
          event: 'deployed',
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const {model, diagnostics} = normalizeWithDiagnostics(document, {
      integrationValidationContext,
    });

    expect(diagnostics).toEqual([
      {
        code: 'invalid-trigger-event',
        message: 'A webhook trigger must use event "received"; found "deployed".',
        path: ['triggers', 'on_deploy', 'event'],
        details: {event: 'deployed', source: 'deploy-hook', provider: 'webhook'},
        severity: 'error',
        scope: 'trigger',
      },
    ]);
    expect(model.triggers).toEqual([]);
  });

  it('makes a fixed-provider trigger inert when its event catalog is unavailable', () => {
    const document: WorkflowDocument = {
      name: 'webhook trigger without catalog',
      triggers: {
        on_deploy: {
          source: 'deploy-hook',
          event: 'deployed',
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };
    const contextWithoutWebhookCatalog = {
      ...integrationValidationContext,
      eventCatalogs: new Map(
        [...integrationValidationContext.eventCatalogs].filter(
          ([provider]) => provider !== 'webhook',
        ),
      ),
    };

    const {model, diagnostics} = normalizeWithDiagnostics(document, {
      integrationValidationContext: contextWithoutWebhookCatalog,
    });

    expect(diagnostics).toEqual([
      {
        code: 'invalid-trigger-event',
        message:
          'Provider "webhook" has no fixed event catalog; event "deployed" cannot be validated.',
        path: ['triggers', 'on_deploy', 'event'],
        details: {event: 'deployed', source: 'deploy-hook', provider: 'webhook'},
        severity: 'error',
        scope: 'trigger',
      },
    ]);
    expect(model.triggers).toEqual([]);
  });

  it('warns about an unlisted GitHub event and keeps the trigger active', () => {
    const document: WorkflowDocument = {
      name: 'github trigger',
      triggers: {
        on_deploy: {
          source: 'github-main',
          event: 'deployment.created',
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const {model, diagnostics} = normalizeWithDiagnostics(document, {
      integrationValidationContext,
    });

    expect(diagnostics).toEqual([
      {
        code: 'unknown-trigger-event',
        message:
          'Event "deployment.created" is not in the github event catalog; the trigger stays active because this deployment\'s provider app may deliver it.',
        path: ['triggers', 'on_deploy', 'event'],
        details: {event: 'deployment.created', source: 'github-main', provider: 'github'},
        severity: 'warning',
        scope: 'trigger',
      },
    ]);
    expect(model.triggers).toEqual([
      {id: 'on-deploy', key: 'on_deploy', source: 'github-main', event: 'deployment.created'},
    ]);
  });

  it('makes a whitespace-only event inert', () => {
    const document: WorkflowDocument = {
      name: 'blank event',
      triggers: {
        on_push: {
          source: 'github-main',
          event: '   ',
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const {model, diagnostics} = normalizeWithDiagnostics(document, {
      integrationValidationContext,
    });

    expect(diagnostics).toEqual([
      {
        code: 'invalid-trigger-event',
        message: 'A github-main trigger event cannot be blank.',
        path: ['triggers', 'on_push', 'event'],
        details: {event: '', source: 'github-main'},
        severity: 'error',
        scope: 'trigger',
      },
    ]);
    expect(model.triggers).toEqual([]);
  });

  it('trims a padded event before catalog validation and persistence', () => {
    const document: WorkflowDocument = {
      name: 'padded event',
      triggers: {
        on_push: {
          source: 'github-main',
          event: ' push ',
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const {model, diagnostics} = normalizeWithDiagnostics(document, {
      integrationValidationContext,
    });

    expect(diagnostics).toEqual([]);
    expect(model.triggers).toEqual([
      {id: 'on-push', key: 'on_push', source: 'github-main', event: 'push'},
    ]);
  });

  it('keeps an explicit catalog event on a resolved slug clean', () => {
    const document: WorkflowDocument = {
      name: 'github trigger',
      triggers: {
        on_push: {
          source: 'github-main',
          event: 'push',
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const {model, diagnostics} = normalizeWithDiagnostics(document, {
      integrationValidationContext,
    });

    expect(diagnostics).toEqual([]);
    expect(model.triggers).toEqual([
      {id: 'on-push', key: 'on_push', source: 'github-main', event: 'push'},
    ]);
  });

  it('skips slug and event checks when parsed without an integration context', () => {
    const document: WorkflowDocument = {
      name: 'no context',
      triggers: {
        on_deploy: {
          source: 'unknown_slug',
          event: 'whatever',
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const {model, diagnostics} = normalizeWithDiagnostics(document);

    expect(diagnostics).toEqual([]);
    expect(model.triggers).toEqual([
      {id: 'on-deploy', key: 'on_deploy', source: 'unknown_slug', event: 'whatever'},
    ]);
  });

  it('keeps a blank integration event active when parsed without context', () => {
    const document: WorkflowDocument = {
      name: 'blank event without context',
      triggers: {
        on_deploy: {
          source: 'unknown_slug',
          event: '   ',
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const {model, diagnostics} = normalizeWithDiagnostics(document);

    expect(diagnostics).toEqual([]);
    expect(model.triggers).toEqual([
      {id: 'on-deploy', key: 'on_deploy', source: 'unknown_slug', event: ''},
    ]);
  });

  it('keeps the event absent for integration triggers with the event omitted', () => {
    const document: WorkflowDocument = {
      name: 'source subscriptions',
      triggers: {
        on_any_deploy: {
          source: 'deploy_hook',
        },
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

    const model = normalizeWorkflowDocument(document);

    expect(model.triggers).toEqual([
      {
        id: 'on-any-deploy',
        key: 'on_any_deploy',
        source: 'deploy_hook',
      },
      {
        id: 'on-any-github-event',
        key: 'on_any_github_event',
        source: 'github_acme',
      },
    ]);
    expect(model.triggers[0]).not.toHaveProperty('event');
    expect(model.triggers[1]).not.toHaveProperty('event');
  });

  it('makes a cron trigger without a schedule inert', () => {
    const document: WorkflowDocument = {
      name: 'nightly trigger',
      triggers: {
        nightly: {
          source: 'cron',
          event: 'tick',
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const {model, diagnostics} = normalizeWithDiagnostics(document);

    expect(diagnostics).toEqual([
      {
        code: 'missing-cron-schedule',
        message: 'A cron trigger requires a schedule.',
        path: ['triggers', 'nightly', 'config', 'schedule'],
        severity: 'error',
        scope: 'trigger',
      },
    ]);
    expect(model.triggers).toEqual([]);
  });

  it.each([
    ['malformed', 'not a cron'],
    ['6-field', '0 0 2 * * *'],
    ['preset', '@daily'],
  ])('makes a cron trigger with an invalid %s schedule inert', (_label, schedule) => {
    const document: WorkflowDocument = {
      name: 'nightly trigger',
      triggers: {
        nightly: {
          source: 'cron',
          event: 'tick',
          config: {schedule},
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const {model, diagnostics} = normalizeWithDiagnostics(document);

    expect(diagnostics).toEqual([
      {
        code: 'invalid-cron-schedule',
        message: 'Cron trigger schedule must be a valid 5-field cron expression.',
        path: ['triggers', 'nightly', 'config', 'schedule'],
        details: {schedule},
        severity: 'error',
        scope: 'trigger',
      },
    ]);
    expect(model.triggers).toEqual([]);
  });

  it('makes a cron trigger with an invalid timezone inert', () => {
    const document: WorkflowDocument = {
      name: 'nightly trigger',
      triggers: {
        nightly: {
          source: 'cron',
          event: 'tick',
          config: {
            schedule: '0 2 * * *',
            timezone: 'Not/A/Zone',
          },
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const {model, diagnostics} = normalizeWithDiagnostics(document);

    expect(diagnostics).toEqual([
      {
        code: 'invalid-cron-timezone',
        message: 'Cron trigger timezone must be a valid IANA time zone.',
        path: ['triggers', 'nightly', 'config', 'timezone'],
        details: {timezone: 'Not/A/Zone'},
        severity: 'error',
        scope: 'trigger',
      },
    ]);
    expect(model.triggers).toEqual([]);
  });

  it('allows multiple cron triggers', () => {
    const document: WorkflowDocument = {
      name: 'cron triggers',
      triggers: {
        hourly: {
          source: 'cron',
          event: 'tick',
          config: {schedule: '0 * * * *'},
        },
        nightly: {
          source: 'cron',
          event: 'tick',
          config: {schedule: '0 2 * * *'},
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.triggers.map((trigger) => trigger.key)).toEqual(['hourly', 'nightly']);
  });

  it('allows a single manual trigger', () => {
    const document: WorkflowDocument = {
      name: 'manual trigger',
      triggers: {
        manual: {source: 'manual', event: 'fire'},
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.triggers).toMatchObject([{id: 'manual', source: 'manual', event: 'fire'}]);
  });

  it('keeps other triggers active when a cron trigger is inert', () => {
    const document: WorkflowDocument = {
      name: 'partially broken triggers',
      triggers: {
        nightly: {
          source: 'cron',
          event: 'tick',
          config: {schedule: 'not a cron'},
        },
        on_demand: {source: 'manual', event: 'fire'},
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const {model, diagnostics} = normalizeWithDiagnostics(document);

    expect(diagnostics).toEqual([
      {
        code: 'invalid-cron-schedule',
        message: 'Cron trigger schedule must be a valid 5-field cron expression.',
        path: ['triggers', 'nightly', 'config', 'schedule'],
        details: {schedule: 'not a cron'},
        severity: 'error',
        scope: 'trigger',
      },
    ]);
    expect(model.triggers).toEqual([
      {
        id: 'on-demand',
        key: 'on_demand',
        source: 'manual',
        event: 'fire',
      },
    ]);
  });

  it('keeps the first manual trigger active and makes later ones inert', () => {
    const document: WorkflowDocument = {
      name: 'manual triggers',
      triggers: {
        one: {source: 'manual', event: 'fire'},
        two: {source: 'manual', event: 'fire'},
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const {model, diagnostics} = normalizeWithDiagnostics(document);

    expect(diagnostics).toEqual([
      {
        code: 'multiple-manual-triggers',
        message:
          'A workflow may declare at most one manual trigger; found 2: one, two. This trigger is inert because it is not the first manual trigger in document order.',
        path: ['triggers', 'two'],
        details: {manualTriggerKeys: ['one', 'two']},
        severity: 'error',
        scope: 'trigger',
      },
    ]);
    expect(model.triggers.map((trigger) => trigger.key)).toEqual(['one']);
  });

  it('counts an earlier inert manual trigger toward the manual-trigger limit', () => {
    const document: WorkflowDocument = {
      name: 'manual triggers with an inert first trigger',
      triggers: {
        broken: {
          source: 'manual',
          event: 'fire',
          filter: 'event.ref == "refs/heads/main"',
        },
        working: {source: 'manual', event: 'fire'},
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const {model, diagnostics} = normalizeWithDiagnostics(document);

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'invalid-trigger-filter',
        path: ['triggers', 'broken', 'filter'],
        severity: 'error',
        scope: 'trigger',
      }),
      {
        code: 'multiple-manual-triggers',
        message:
          'A workflow may declare at most one manual trigger; found 2: broken, working. This trigger is inert because it is not the first manual trigger in document order.',
        path: ['triggers', 'working'],
        details: {manualTriggerKeys: ['broken', 'working']},
        severity: 'error',
        scope: 'trigger',
      },
    ]);
    expect(model.triggers.map((trigger) => trigger.key)).toEqual([]);
  });

  it('accumulates independent semantic issues in one pass', () => {
    const document: WorkflowDocument = {
      name: 'many issues',
      jobs: {
        'test app': {
          needs: 'missing',
          steps: [{run: 'npm test'}],
        },
        'test-app': {
          needs: 'test-app',
          steps: [{run: 'npm test'}],
        },
        lint: {
          needs: 'lint',
          steps: [{run: 'npm run lint'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues.map((issue) => issue.code)).toEqual([
      'duplicate-job-id',
      'unknown-job-dependency',
      'self-job-dependency',
    ]);
  });

  it('reports dependency-ordered normalization issues in document order', () => {
    const document: WorkflowDocument = {
      name: 'ordered issues',
      jobs: {
        deploy: {
          needs: 'build',
          runner: 'bad label',
          steps: [{run: 'npm run deploy'}],
        },
        build: {
          runner: 'also bad',
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues.map((issue) => issue.path)).toEqual([
      ['jobs', 'deploy', 'runner'],
      ['jobs', 'build', 'runner'],
    ]);
  });

  describe('definition-time interpolation', () => {
    const interpolation = (source: string) => '$'.concat('{{ ', source, ' }}');
    const listening = () => ({
      on: [{source: 'github', event: 'pull_request_review'}],
      max_executions: 1,
    });

    it('stores parsed templates for run, env, prompt, and step name fields', () => {
      const document: WorkflowDocument = {
        name: 'templated workflow',
        env: {RUN_ID: interpolation('run.id'), PORT: 3000},
        jobs: {
          build: {
            runner: ['linux', interpolation('execution.events[0].data.runner')],
            env: {JOB_NAME: interpolation('job.key')},
            steps: [
              {
                name: `deploy ${interpolation('event.action')}`,
                working_directory: 'packages/api',
                run: `deploy ${interpolation('run.id')}`,
                env: {PR_TITLE: interpolation('event.pull_request.title'), DEBUG: false},
              },
              {
                name: `review ${interpolation('inputs.topic')}`,
                working_directory: `packages/${interpolation('inputs.topic')}`,
                provider: 'openai',
                prompt: `Review ${interpolation('event.pull_request.title')}`,
              },
            ],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.templates?.env?.RUN_ID).toEqual([
        {
          kind: 'deferred',
          expression: {language: 'cel', source: 'run.id', check: 'typed', resultType: 'string'},
          roots: ['run'],
          fillTarget: 'run-creation',
        },
      ]);
      expect(model.templates?.env).not.toHaveProperty('PORT');
      expect(model.jobs[0]?.runner).toEqual(['linux']);
      expect(model.jobs[0]?.runnerTemplates).toEqual([
        [
          {
            kind: 'deferred',
            expression: {
              language: 'cel',
              source: 'execution.events[0].data.runner',
              check: 'typed',
              resultType: 'string',
            },
            roots: ['execution'],
            fillTarget: 'execution-creation',
          },
        ],
      ]);
      expect(model.jobs[0]?.templates?.env?.JOB_NAME).toEqual([
        {
          kind: 'deferred',
          expression: {language: 'cel', source: 'job.key', check: 'typed', resultType: 'string'},
          roots: ['job'],
          fillTarget: 'run-creation',
        },
      ]);
      expect(model.jobs[0]?.steps[0]).toMatchObject({
        kind: 'run',
        command: {value: `deploy ${interpolation('run.id')}`},
        workingDirectory: 'packages/api',
        templates: {
          command: [
            {kind: 'literal', value: 'deploy '},
            {
              kind: 'deferred',
              expression: {language: 'cel', source: 'run.id', check: 'typed'},
              roots: ['run'],
            },
          ],
          name: [
            {kind: 'literal', value: 'deploy '},
            {
              kind: 'deferred',
              expression: {language: 'cel', source: 'event.action', check: 'syntax'},
              roots: ['event'],
            },
          ],
          env: {
            PR_TITLE: [
              {
                kind: 'deferred',
                expression: {
                  language: 'cel',
                  source: 'event.pull_request.title',
                  check: 'syntax',
                },
                roots: ['event'],
              },
            ],
          },
        },
      });
      expect(model.jobs[0]?.steps[1]).toMatchObject({
        kind: 'agent',
        workingDirectory: `packages/${interpolation('inputs.topic')}`,
        templates: {
          workingDirectory: [
            {kind: 'literal', value: 'packages/'},
            {
              kind: 'deferred',
              expression: {source: 'inputs.topic'},
              roots: ['inputs'],
            },
          ],
          prompt: [
            {kind: 'literal', value: 'Review '},
            {
              kind: 'deferred',
              expression: {
                language: 'cel',
                source: 'event.pull_request.title',
                check: 'syntax',
              },
              roots: ['event'],
            },
          ],
          name: [
            {kind: 'literal', value: 'review '},
            {
              kind: 'deferred',
              expression: {language: 'cel', source: 'inputs.topic', check: 'syntax'},
              roots: ['inputs'],
            },
          ],
        },
      });
    });

    it('omits templates for pure literal and escaped interpolation text', () => {
      const document: WorkflowDocument = {
        name: 'literal workflow',
        env: {VALUE: '$${{ event.ref }}'},
        jobs: {
          build: {
            name: 'Build app',
            steps: [{name: 'literal step', run: 'echo $${{ event.ref }}'}],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model).not.toHaveProperty('templates');
      expect(model.jobs[0]?.steps[0]).not.toHaveProperty('templates');
      expect(model.env).toEqual({VALUE: '$${{ event.ref }}'});
      expect(model.jobs[0]?.name).toBe('Build app');
      expect(model.jobs[0]?.steps[0]).toMatchObject({
        kind: 'run',
        command: {value: 'echo $${{ event.ref }}'},
      });
    });

    it('preserves env keys that look like object prototype properties', () => {
      const document: WorkflowDocument = {
        name: 'prototype env',
        env: {['__proto__']: interpolation('event.name')},
        jobs: {
          build: {
            env: {['__proto__']: 'job-value'},
            steps: [
              {
                run: 'echo ok',
                env: {['__proto__']: interpolation('inputs.value')},
              },
            ],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);
      const workflowEnv = model.env ?? {};
      const jobEnv = model.jobs[0]?.env ?? {};
      const step = model.jobs[0]?.steps[0];
      if (step?.kind !== 'run') expect.fail('Expected a run step');
      const stepEnv = step.env ?? {};
      const workflowTemplates = model.templates?.env ?? {};
      const stepTemplates = step.templates?.env ?? {};

      expect(Object.hasOwn(workflowEnv, '__proto__')).toBe(true);
      expect(Object.hasOwn(jobEnv, '__proto__')).toBe(true);
      expect(Object.hasOwn(stepEnv, '__proto__')).toBe(true);
      expect(Object.getOwnPropertyDescriptor(workflowEnv, '__proto__')?.value).toBe(
        interpolation('event.name'),
      );
      expect(Object.getOwnPropertyDescriptor(jobEnv, '__proto__')?.value).toBe('job-value');
      expect(Object.getOwnPropertyDescriptor(stepEnv, '__proto__')?.value).toBe(
        interpolation('inputs.value'),
      );
      expect(
        Object.getOwnPropertyDescriptor(workflowTemplates, '__proto__')?.value?.[0],
      ).toMatchObject({
        kind: 'deferred',
        roots: ['event'],
      });
      expect(Object.getOwnPropertyDescriptor(stepTemplates, '__proto__')?.value?.[0]).toMatchObject(
        {
          kind: 'deferred',
          roots: ['inputs'],
        },
      );
    });

    it.each([
      ['event payload', 'event.pull_request.title', ['event']],
      ['job status', 'jobs.build.status', ['jobs']],
    ] as const)('allows %s context in run commands', (_label, source, roots) => {
      const document: WorkflowDocument = {
        name: 'unsafe run',
        jobs: {
          build: {
            steps: [{run: 'echo build'}],
          },
          deploy: {
            needs: 'build',
            steps: [{run: `echo ${interpolation(source)}`}],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.jobs[1]?.steps[0]).toMatchObject({
        kind: 'run',
        templates: {
          command: [
            {kind: 'literal', value: 'echo '},
            {kind: 'deferred', roots},
          ],
        },
      });
    });

    it('rejects secrets in agent fields', () => {
      const document: WorkflowDocument = {
        name: 'agent secret',
        jobs: {
          build: {
            steps: [{prompt: interpolation('secrets.OPENAI_API_KEY')}],
          },
        },
      };

      const error = expectInvalid(document);

      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'runner-context-in-field',
          details: expect.objectContaining({rejectedRoots: ['secrets']}),
        }),
      ]);
    });

    it('rejects computed vars keys', () => {
      const document: WorkflowDocument = {
        name: 'computed vars',
        jobs: {
          build: {
            steps: [{run: 'echo ok', env: {REGION: interpolation('vars[event.region]')}}],
          },
        },
      };

      const error = expectInvalid(document);

      expect(error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'computed-context-key',
            details: expect.objectContaining({root: 'vars'}),
          }),
        ]),
      );
      expect(error.issues.map((issue) => issue.code)).toEqual([
        'computed-context-key',
        'computed-context-key',
      ]);
    });

    it('rejects unknown secret stores', () => {
      const document: WorkflowDocument = {
        name: 'unknown secret store',
        jobs: {
          build: {
            steps: [{run: 'echo ok', env: {TOKEN: interpolation('secrets.vault.TOKEN')}}],
          },
        },
      };

      const error = expectInvalid(document);

      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'unknown-secret-store',
          details: expect.objectContaining({store: 'vault'}),
        }),
      ]);
    });

    it.each([
      'execution.events[0].data.body',
      'execution["events"][0].data.body',
    ])('allows execution event sub-paths in run commands: %s', (source) => {
      const document: WorkflowDocument = {
        name: 'unsafe execution run',
        jobs: {
          build: {
            steps: [{run: `echo ${interpolation(source)}`}],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.jobs[0]?.steps[0]).toMatchObject({
        kind: 'run',
        templates: {
          command: [
            {kind: 'literal', value: 'echo '},
            {kind: 'deferred', roots: ['execution']},
          ],
        },
      });
    });

    it.each([
      ['run', {run: `echo ${interpolation('execution.index')}`}],
      [
        'step-level env',
        {run: 'echo ok', env: {EXECUTION_INDEX: interpolation('execution.index')}},
      ],
      ['step name', {name: interpolation('execution.index'), run: 'echo ok'}],
    ] as const)('allows one-shot %s interpolation when execution context is available by dispatch', (_field, step) => {
      const document: WorkflowDocument = {
        name: 'dispatch execution context',
        jobs: {
          build: {
            steps: [step],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.jobs[0]?.steps).toHaveLength(1);
    });

    it.each([
      ['run', {run: `echo ${interpolation('execution.index')}`}],
      [
        'step-level env',
        {run: 'echo ok', env: {EXECUTION_INDEX: interpolation('execution.index')}},
      ],
      ['step name', {name: interpolation('execution.index'), run: 'echo ok'}],
    ] as const)('allows listening job %s interpolation when execution context is available', (_field, step) => {
      const document: WorkflowDocument = {
        name: 'execution context',
        jobs: {
          build: {
            listening: listening(),
            steps: [step],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.jobs[0]?.mode).toBe('listening');
    });

    it.each([
      ['prompt', {prompt: interpolation('execution.index')}],
      ['model', {model: interpolation('execution.name'), prompt: 'Fix it.'}],
      ['provider', {provider: interpolation('execution.name'), prompt: 'Fix it.'}],
    ] as const)('allows one-shot agent %s interpolation when execution context is available by dispatch', (_field, step) => {
      const document: WorkflowDocument = {
        name: 'dispatch agent context',
        jobs: {
          fix: {
            steps: [step],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.jobs[0]?.steps).toHaveLength(1);
    });

    it.each([
      ['prompt', {prompt: interpolation('execution.index')}],
      ['model', {model: interpolation('execution.name'), prompt: 'Fix it.'}],
      ['provider', {provider: interpolation('execution.name'), prompt: 'Fix it.'}],
    ] as const)('allows listening job agent %s interpolation when execution context is available', (_field, step) => {
      const document: WorkflowDocument = {
        name: 'agent execution context',
        jobs: {
          fix: {
            listening: listening(),
            steps: [step],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.jobs[0]?.mode).toBe('listening');
    });

    it('allows step self-root at step dispatch', () => {
      const document: WorkflowDocument = {
        name: 'dispatch step context',
        jobs: {
          build: {
            listening: listening(),
            steps: [{run: `echo ${interpolation('step.status')}`}],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.jobs[0]?.steps[0]).toMatchObject({
        kind: 'run',
        templates: {
          command: [
            {kind: 'literal', value: 'echo '},
            {
              kind: 'deferred',
              expression: {language: 'cel', source: 'step.status', check: 'typed'},
              roots: ['step'],
              fillTarget: 'step-dispatch',
            },
          ],
        },
      });
    });

    it('rejects dynamic job names in favor of execution_name', () => {
      const document: WorkflowDocument = {
        name: 'job display context',
        jobs: {
          build: {
            name: interpolation('execution.index'),
            steps: [{run: 'echo ok'}],
          },
          review: {
            name: interpolation('execution.index'),
            listening: listening(),
            steps: [{run: 'echo ok'}],
          },
        },
      };

      const error = expectInvalid(document);
      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'invalid-interpolation-template',
          message: 'Job name must be literal. Move runtime interpolation to execution_name.',
          path: ['jobs', 'build', 'name'],
        }),
        expect.objectContaining({
          code: 'invalid-interpolation-template',
          message: 'Job name must be literal. Move runtime interpolation to execution_name.',
          path: ['jobs', 'review', 'name'],
        }),
      ]);
    });

    it('does not apply availability checks to workflow-level or job-level env', () => {
      const document: WorkflowDocument = {
        name: 'shared env context',
        env: {WORKFLOW_EXECUTION: interpolation('execution.index')},
        jobs: {
          build: {
            env: {JOB_EXECUTION: interpolation('execution.index')},
            steps: [{run: 'echo ok'}],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.templates?.env?.WORKFLOW_EXECUTION?.[0]).toMatchObject({
        kind: 'deferred',
        roots: ['execution'],
      });
      expect(model.jobs[0]?.templates?.env?.JOB_EXECUTION?.[0]).toMatchObject({
        kind: 'deferred',
        roots: ['execution'],
      });
    });

    it('allows multi-root step fields when all roots are available by dispatch', () => {
      const document: WorkflowDocument = {
        name: 'mixed availability',
        jobs: {
          build: {
            steps: [
              {
                run: 'echo ok',
                env: {MIXED: interpolation('run.id + execution.name')},
              },
            ],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.jobs[0]?.steps).toHaveLength(1);
    });

    it('allows multi-root step fields when all roots including step are available by dispatch', () => {
      const document: WorkflowDocument = {
        name: 'mixed step availability',
        jobs: {
          build: {
            steps: [{run: `echo ${interpolation('string(execution.index) + step.status')}`}],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.jobs[0]?.steps[0]).toMatchObject({
        kind: 'run',
        templates: {
          command: [
            {kind: 'literal', value: 'echo '},
            {
              kind: 'deferred',
              roots: ['execution', 'step'],
              fillTarget: 'step-dispatch',
            },
          ],
        },
      });
    });

    it('keeps one-shot fields valid when they reference run-scoped contexts', () => {
      const document: WorkflowDocument = {
        name: 'run context',
        jobs: {
          build: {
            steps: [
              {
                name: interpolation('job.key'),
                run: `echo ${interpolation('run.id + trigger.source')}`,
                env: {INPUT: interpolation('inputs.value')},
              },
            ],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.jobs[0]?.steps[0]).toMatchObject({
        kind: 'run',
        templates: {
          command: [{kind: 'literal'}, {kind: 'deferred', roots: ['run', 'trigger']}],
          name: [{kind: 'deferred', roots: ['job']}],
          env: {INPUT: [{kind: 'deferred', roots: ['inputs']}]},
        },
      });
    });

    it('allows trusted execution metadata in run commands', () => {
      const document: WorkflowDocument = {
        name: 'execution metadata',
        jobs: {
          build: {
            listening: listening(),
            steps: [{run: `echo ${interpolation('executions[0].name')}`}],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.jobs[0]?.steps[0]).toMatchObject({
        kind: 'run',
        templates: {
          command: [
            {kind: 'literal', value: 'echo '},
            {
              kind: 'deferred',
              expression: {language: 'cel', source: 'executions[0].name', check: 'typed'},
              roots: ['executions'],
            },
          ],
        },
      });
    });

    it('rejects execution events in static job names', () => {
      const document: WorkflowDocument = {
        name: 'execution events allowed',
        jobs: {
          build: {
            name: `batch ${interpolation('execution.events[0].data.title')}`,
            listening: listening(),
            steps: [{provider: 'openai', prompt: interpolation('execution.events[0].data.body')}],
          },
        },
      };

      const error = expectInvalid(document);
      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'invalid-interpolation-template',
          path: ['jobs', 'build', 'name'],
        }),
      ]);
    });

    it('allows untrusted context in env, prompt, and step names', () => {
      const document: WorkflowDocument = {
        name: 'untrusted allowed',
        env: {EVENT_NAME: interpolation('event.name')},
        jobs: {
          build: {
            steps: [
              {name: interpolation('event.action'), run: 'echo ok'},
              {provider: 'openai', prompt: interpolation('inputs.prompt')},
            ],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.templates?.env?.EVENT_NAME?.[0]).toMatchObject({
        kind: 'deferred',
        expression: {check: 'syntax'},
        roots: ['event'],
      });
      expect(model.jobs[0]?.steps[0]).toMatchObject({
        kind: 'run',
        templates: {name: [{kind: 'deferred', roots: ['event']}]},
      });
      expect(model.jobs[0]?.steps[1]).toMatchObject({
        kind: 'agent',
        templates: {prompt: [{kind: 'deferred', roots: ['inputs']}]},
      });
    });

    it.each([
      ['model', {model: interpolation('event.model'), prompt: 'Fix it.'}, 'event'],
      ['provider', {provider: interpolation('inputs.provider'), prompt: 'Fix it.'}, 'inputs'],
    ] as const)('allows external context in agent %s interpolation', (field, step, root) => {
      const document: WorkflowDocument = {
        name: 'external agent field',
        jobs: {
          fix: {
            steps: [step],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.jobs[0]?.steps[0]).toMatchObject({
        kind: 'agent',
        templates: {
          [field]: [{kind: 'deferred', roots: [root]}],
        },
      });
    });

    it.each([
      ['model', {model: interpolation('steps.collect.outputs.value'), prompt: 'Fix it.'}, 'steps'],
      [
        'provider',
        {provider: interpolation('steps.collect.outputs.value'), prompt: 'Fix it.'},
        'steps',
      ],
      [
        'model',
        {
          model: interpolation('steps.filter(s, true).map(s, s.outputs.value)[0]'),
          prompt: 'Fix it.',
        },
        'steps',
      ],
      [
        'provider',
        {
          provider: interpolation('steps.filter(s, true).map(s, s.outputs.value)[0]'),
          prompt: 'Fix it.',
        },
        'steps',
      ],
      [
        'model',
        {model: interpolation('execution.events[0].data.body'), prompt: 'Fix it.'},
        'execution',
      ],
      [
        'provider',
        {provider: interpolation('execution.events[0].data.body'), prompt: 'Fix it.'},
        'execution',
      ],
      [
        'model',
        {model: interpolation('execution["events"][0].data.body'), prompt: 'Fix it.'},
        'execution',
      ],
      [
        'provider',
        {provider: interpolation('execution["events"][0].data.body'), prompt: 'Fix it.'},
        'execution',
      ],
    ] as const)('allows path-specific external context in agent %s interpolation', (field, step, root) => {
      const document: WorkflowDocument = {
        name: 'path-specific external agent field',
        jobs: {
          fix: {
            steps: [{key: 'collect', run: 'collect'}, step],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.jobs[0]?.steps[1]).toMatchObject({
        kind: 'agent',
        templates: {
          [field]: [{kind: 'deferred', roots: [root]}],
        },
      });
    });

    it.each([
      ['model', {model: interpolation('foo.bar'), prompt: 'Fix it.'}],
      ['provider', {provider: interpolation('foo.bar'), prompt: 'Fix it.'}],
    ] as const)('rejects unknown context roots in agent %s interpolation', (_field, step) => {
      const document: WorkflowDocument = {
        name: 'unknown agent context',
        jobs: {
          fix: {
            steps: [step],
          },
        },
      };

      const error = expectInvalid(document);

      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'unknown-interpolation-context',
          details: expect.objectContaining({unknownRoots: ['foo']}),
        }),
      ]);
    });

    it.each([
      ['model', {model: interpolation('run.name'), prompt: 'Fix it.'}],
      ['provider', {provider: interpolation('run.name'), prompt: 'Fix it.'}],
    ] as const)('stores trusted agent %s interpolation templates', (field, step) => {
      const document: WorkflowDocument = {
        name: 'supported agent field',
        jobs: {
          fix: {
            steps: [step],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.jobs[0]?.steps[0]).toMatchObject({
        kind: 'agent',
        templates: {[field]: [{kind: 'deferred', roots: ['run']}]},
      });
    });

    it('skips static provider catalog validation when provider is interpolated', () => {
      const document: WorkflowDocument = {
        name: 'templated provider',
        jobs: {
          fix: {
            steps: [{provider: interpolation('run.name'), prompt: 'Fix it.'}],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.jobs[0]?.steps[0]).toMatchObject({
        kind: 'agent',
        templates: {provider: [{kind: 'deferred', roots: ['run']}]},
      });
    });

    it('does not add provider catalog issues for invalid provider interpolation', () => {
      const document: WorkflowDocument = {
        name: 'invalid provider interpolation',
        jobs: {
          fix: {
            steps: [{harness: 'claude', provider: interpolation('foo.bar'), prompt: 'Fix it.'}],
          },
        },
      };

      const error = expectInvalid(document);

      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'unknown-interpolation-context',
          path: ['jobs', 'fix', 'steps', 0, 'provider'],
        }),
      ]);
    });

    it('skips static model catalog validation when model is interpolated', () => {
      const document: WorkflowDocument = {
        name: 'templated model',
        jobs: {
          fix: {
            steps: [
              {
                provider: 'anthropic',
                model: interpolation('run.name'),
                prompt: 'Fix it.',
              },
            ],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.jobs[0]?.steps[0]).toMatchObject({
        kind: 'agent',
        templates: {model: [{kind: 'deferred', roots: ['run']}]},
      });
    });

    it('does not add model catalog issues for invalid model interpolation', () => {
      const document: WorkflowDocument = {
        name: 'invalid model interpolation',
        jobs: {
          fix: {
            steps: [
              {
                harness: 'pi',
                provider: 'anthropic',
                model: interpolation('foo.bar'),
                prompt: 'Fix it.',
              },
            ],
          },
        },
      };

      const error = expectInvalid(document);

      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'unknown-interpolation-context',
          path: ['jobs', 'fix', 'steps', 0, 'model'],
        }),
      ]);
    });

    it('still validates literal providers through the catalog', () => {
      const document: WorkflowDocument = {
        name: 'literal provider',
        jobs: {
          fix: {
            steps: [{provider: 'github-copilot', prompt: 'Fix it.'}],
          },
        },
      };

      const error = expectInvalid(document);

      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'invalid-provider',
          path: ['jobs', 'fix', 'steps', 0, 'provider'],
        }),
      ]);
    });

    it('accepts a managed provider on Claude when the catalog exposes an Anthropic model', () => {
      const providerId = 'shipfox-managed';
      const managedCatalog: AgentValidationCatalog = {
        ...agentValidationCatalog,
        providers: [
          ...agentValidationCatalog.providers,
          {id: providerId, support_status: 'supported'},
        ],
        harnesses: agentValidationCatalog.harnesses.map((harness) =>
          harness.id === 'claude'
            ? {
                ...harness,
                supported_provider_ids: [...harness.supported_provider_ids, providerId],
                model_ids_by_provider: {
                  ...harness.model_ids_by_provider,
                  [providerId]: ['managed-claude'],
                },
              }
            : harness,
        ),
      };

      const model = normalizeWorkflowDocument(
        {
          name: 'managed Claude provider',
          jobs: {
            fix: {
              steps: [
                {
                  harness: 'claude',
                  provider: providerId,
                  model: 'managed-claude',
                  prompt: 'Fix it.',
                },
              ],
            },
          },
        },
        {agentValidationCatalog: managedCatalog},
      );

      expect(model.jobs[0]?.steps[0]).toMatchObject({
        kind: 'agent',
        harness: 'claude',
        provider: providerId,
        model: 'managed-claude',
      });
    });

    it('reports typed interpolation expression errors for trusted known contexts', () => {
      const document: WorkflowDocument = {
        name: 'bad trusted path',
        env: {BAD: interpolation('run.nope')},
        jobs: {
          build: {
            steps: [{run: 'echo ok'}],
          },
        },
      };

      const error = expectInvalid(document);

      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'invalid-interpolation-expression',
          path: ['env', 'BAD'],
          details: expect.objectContaining({
            field: 'env.value',
            expression: 'run.nope',
            contextRoots: ['run'],
          }),
        }),
      ]);
    });

    it('reports malformed interpolation templates before expression validation', () => {
      const document: WorkflowDocument = {
        name: 'bad template',
        env: {BAD: 'deploy ${{ event.ref'},
        jobs: {
          build: {
            steps: [{run: 'echo ok'}],
          },
        },
      };

      const error = expectInvalid(document);

      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'invalid-interpolation-template',
          path: ['env', 'BAD'],
          details: expect.objectContaining({field: 'env.value'}),
        }),
      ]);
    });

    it('reports unknown interpolation context roots', () => {
      const document: WorkflowDocument = {
        name: 'unknown context',
        env: {BAD: interpolation('foo.bar')},
        jobs: {
          build: {
            steps: [{run: 'echo ok'}],
          },
        },
      };

      const error = expectInvalid(document);

      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'unknown-interpolation-context',
          path: ['env', 'BAD'],
          details: expect.objectContaining({
            contextRoots: ['foo'],
            unknownRoots: ['foo'],
          }),
        }),
      ]);
    });

    it('type-checks merged trusted contexts and reports bad fields from either root', () => {
      const validDocument: WorkflowDocument = {
        name: 'merged contexts',
        env: {VALID: interpolation('run.name + trigger.source')},
        jobs: {
          build: {
            steps: [{run: 'echo ok'}],
          },
        },
      };
      const invalidDocument: WorkflowDocument = {
        name: 'bad merged contexts',
        env: {BAD: interpolation('run.name + trigger.nope')},
        jobs: {
          build: {
            steps: [{run: 'echo ok'}],
          },
        },
      };

      const model = normalizeWorkflowDocument(validDocument);
      const error = expectInvalid(invalidDocument);

      expect(model.templates?.env?.VALID?.[0]).toMatchObject({
        kind: 'deferred',
        expression: {check: 'typed'},
        roots: ['run', 'trigger'],
      });
      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'invalid-interpolation-expression',
          path: ['env', 'BAD'],
        }),
      ]);
    });

    it('uses syntax mode for mixed open contexts without a trust restriction', () => {
      const envDocument: WorkflowDocument = {
        name: 'mixed env',
        env: {MIXED: interpolation('run.nope + event.x')},
        jobs: {
          build: {
            steps: [{run: 'echo ok'}],
          },
        },
      };
      const runDocument: WorkflowDocument = {
        name: 'mixed run',
        jobs: {
          build: {
            steps: [{run: `echo ${interpolation('run.id + event.x')}`}],
          },
        },
      };

      const model = normalizeWorkflowDocument(envDocument);
      const runModel = normalizeWorkflowDocument(runDocument);

      expect(model.templates?.env?.MIXED?.[0]).toMatchObject({
        kind: 'deferred',
        expression: {check: 'syntax'},
        roots: expect.arrayContaining(['run', 'event']),
      });
      expect(runModel.jobs[0]?.steps[0]).toMatchObject({
        kind: 'run',
        templates: {
          command: [
            {kind: 'literal', value: 'echo '},
            {kind: 'deferred', roots: expect.arrayContaining(['run', 'event'])},
          ],
        },
      });
    });

    it('allows multi-segment run fields with external context', () => {
      const document: WorkflowDocument = {
        name: 'multi segment run',
        jobs: {
          build: {
            steps: [{run: `${interpolation('run.id')}-${interpolation('event.x')}`}],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.jobs[0]?.steps[0]).toMatchObject({
        kind: 'run',
        templates: {
          command: [
            {kind: 'deferred', roots: ['run']},
            {kind: 'literal', value: '-'},
            {kind: 'deferred', roots: ['event']},
          ],
        },
      });
    });

    it('does not parse templates in non-string env values', () => {
      const document: WorkflowDocument = {
        name: 'non-string env',
        env: {COUNT: 1, ENABLED: true},
        jobs: {
          build: {
            env: {LIMIT: 10},
            steps: [{run: 'echo ok', env: {DEBUG: false}}],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.env).toEqual({COUNT: '1', ENABLED: 'true'});
      expect(model).not.toHaveProperty('templates');
      expect(model.jobs[0]).not.toHaveProperty('templates');
      expect(model.jobs[0]?.steps[0]).toMatchObject({
        kind: 'run',
        env: {DEBUG: 'false'},
      });
      expect(model.jobs[0]?.steps[0]).not.toHaveProperty('templates');
    });
  });
});
