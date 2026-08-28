import type {WorkflowDocument, WorkflowDocumentStep} from '@shipfox/workflow-document';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import type {IntegrationValidationContext} from '../entities/integration-context.js';
import type {WorkflowModel, WorkflowModelToolStep} from '../entities/workflow-model.js';
import {InvalidWorkflowModelError} from './invalid-workflow-model-error.js';
import {normalizeWorkflowDocument} from './normalize-workflow-document.js';

function normalize(
  document: WorkflowDocument,
  options?: {integrationValidationContext?: IntegrationValidationContext | undefined},
): WorkflowModel {
  return normalizeWorkflowDocument(
    {runner: 'ubuntu-latest', ...document},
    {
      agentValidationCatalog,
      ...options,
    },
  );
}

function expectInvalid(
  document: WorkflowDocument,
  options?: {integrationValidationContext?: IntegrationValidationContext | undefined},
): InvalidWorkflowModelError {
  try {
    normalize(document, options);
    expect.fail('Expected InvalidWorkflowModelError');
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidWorkflowModelError);
    return error as InvalidWorkflowModelError;
  }
}

function toolStep(step: WorkflowDocumentStep): WorkflowDocumentStep {
  return step;
}

function mappingOutputs(
  outputs: Record<string, string>,
): NonNullable<WorkflowDocumentStep['outputs']> {
  return outputs as unknown as NonNullable<WorkflowDocumentStep['outputs']>;
}

function toolDocument(step: WorkflowDocumentStep): WorkflowDocument {
  return {
    name: 'tools',
    jobs: {use: {steps: [step]}},
  };
}

const integrationValidationContext = {
  agentToolSelectionCatalogs: new Map([
    [
      'github',
      {
        selectors: [
          {token: 'issue_read', kind: 'family', sensitivity: 'read', sensitive: false},
          {token: 'issue_read.get', kind: 'method', sensitivity: 'read', sensitive: false},
        ],
      },
    ],
  ]),
  agentToolCatalogs: new Map([
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
              },
              required: ['identifier', 'description'],
              additionalProperties: false,
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
            outputSchema: {
              type: 'object',
              properties: {title: {type: 'string'}},
              required: ['title'],
              additionalProperties: false,
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
                // Mirror the real provider catalog: `method` is required but
                // server-injected at dispatch, so authors must not set it.
                method: {type: 'string'},
              },
              required: ['owner', 'repo', 'method'],
              additionalProperties: false,
            },
            methods: [
              {
                id: 'update',
                description: 'Update an issue',
                sensitivity: 'write',
                sensitive: false,
                requiredScope: 'write',
              },
            ],
          },
        ],
      },
    ],
  ]),
  workspaceConnectionSnapshot: new Map([
    ['linear-main', {id: 'conn_3', provider: 'linear', capabilities: ['agent_tools']}],
    ['sentry-main', {id: 'conn_2', provider: 'sentry', capabilities: []}],
    ['github-main', {id: 'conn_1', provider: 'github', capabilities: ['agent_tools']}],
    ['webhook-main', {id: 'conn_5', provider: 'webhook', capabilities: []}],
  ]),
  eventCatalogs: new Map(),
  fixedEventProviders: new Set(),
  defaultConnectionSlug: 'github-main',
} satisfies IntegrationValidationContext;

describe('normalizeToolStep', () => {
  it('splits family.method ids and parses with templates and output mappings', () => {
    const model = normalize(
      {
        name: 'tools',
        jobs: {
          use: {
            steps: [
              toolStep({
                key: 'issue',
                tool: 'issue_read.get',
                with: {
                  owner: 'acme',
                  repo: 'platform',
                  number: 7,
                },
                outputs: mappingOutputs({
                  title: '$' + '{{ result.title }}',
                }),
              }),
            ],
          },
        },
      },
      {integrationValidationContext},
    );

    const step = model.jobs[0]?.steps[0] as WorkflowModelToolStep;
    expect(step.kind).toBe('tool');
    expect(step.tool).toEqual({id: 'issue_read', method: 'get'});
    expect(step.with).toEqual({owner: 'acme', repo: 'platform', number: 7});
    expect(step.templates).toBeUndefined();
    expect(step.outputMappings).toMatchObject({
      title: {language: 'cel', source: 'result.title'},
    });
    expect(step.outputs).toEqual({title: {type: 'string'}});
  });

  it('records a steps.<key> overlay typed from the catalog output schema', () => {
    const model = normalize(
      {
        name: 'tools',
        jobs: {
          use: {
            steps: [
              toolStep({
                key: 'issue',
                tool: 'get_issue',
                connection: 'linear-main',
                with: {id: 'ENG-1'},
                outputs: mappingOutputs({
                  identifier: '$' + '{{ result.identifier }}',
                }),
              }),
              toolStep({
                key: 'next',
                tool: 'save_comment',
                connection: 'linear-main',
                with: {
                  issueId: '$' + '{{ steps.issue.outputs.identifier }}',
                  body: '$' + '{{ steps.issue.outputs.result.description }}',
                },
              }),
            ],
          },
        },
      },
      {integrationValidationContext},
    );

    const issue = model.jobs[0]?.steps[0] as WorkflowModelToolStep;
    const next = model.jobs[0]?.steps[1] as WorkflowModelToolStep;
    expect(issue.outputMappings?.identifier).toMatchObject({
      check: 'typed',
      resultType: 'string',
    });
    // The `with` templates fill at dispatch from the typed peer step outputs.
    expect(next.templates?.with).toMatchObject({
      issueId: [{kind: 'deferred', roots: ['steps']}],
      body: [{kind: 'deferred', roots: ['steps']}],
    });
    expect(next.outputMappings).toBeUndefined();
  });

  it('rejects a mapped output that reads a key absent from the output schema', () => {
    const error = expectInvalid(
      toolDocument(
        toolStep({
          key: 'issue',
          tool: 'get_issue',
          connection: 'linear-main',
          with: {id: 'ENG-1'},
          outputs: mappingOutputs({missing: '$' + '{{ result.missing }}'}),
        }),
      ),
      {integrationValidationContext},
    );

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-interpolation-expression',
        path: ['jobs', 'use', 'steps', 0, 'outputs', 'missing'],
      }),
    ]);
  });

  it('types the gate of a tool step without exit_code', () => {
    const error = expectInvalid(
      toolDocument(
        toolStep({
          key: 'issue',
          tool: 'get_issue',
          connection: 'linear-main',
          with: {id: 'ENG-1'},
          gate: {success: 'step.exit_code == 0'},
        }),
      ),
      {integrationValidationContext},
    );

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-step-gate-success',
        path: ['jobs', 'use', 'steps', 0, 'gate', 'success'],
      }),
    ]);
  });

  it('accepts a gate over step.outputs.result typed from the output schema', () => {
    const model = normalize(
      toolDocument(
        toolStep({
          key: 'issue',
          tool: 'get_issue',
          connection: 'linear-main',
          with: {id: 'ENG-1'},
          gate: {success: 'step.outputs.result.identifier == "ENG-1"'},
        }),
      ),
      {integrationValidationContext},
    );

    expect(model.jobs[0]?.steps[0]).toMatchObject({
      kind: 'tool',
      gate: {success: expect.objectContaining({check: 'typed'})},
    });
  });

  it('rejects a literal-only output mapping', () => {
    const error = expectInvalid(
      toolDocument(
        toolStep({
          key: 'issue',
          tool: 'get_issue',
          connection: 'linear-main',
          with: {id: 'ENG-1'},
          outputs: mappingOutputs({title: 'not an expression'}),
        }),
      ),
      {integrationValidationContext},
    );

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'tool-output-invalid',
        path: ['jobs', 'use', 'steps', 0, 'outputs', 'title'],
      }),
    ]);
  });

  it('rejects a multi-expression output mapping', () => {
    const error = expectInvalid(
      toolDocument(
        toolStep({
          key: 'issue',
          tool: 'get_issue',
          connection: 'linear-main',
          with: {id: 'ENG-1'},
          outputs: mappingOutputs({
            x: '$' + '{{ result.identifier }} $' + '{{ result.description }}',
          }),
        }),
      ),
      {integrationValidationContext},
    );

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'tool-output-invalid',
        path: ['jobs', 'use', 'steps', 0, 'outputs', 'x'],
      }),
    ]);
  });

  it('rejects a non-string output mapping value', () => {
    const error = expectInvalid(
      toolDocument(
        toolStep({
          key: 'issue',
          tool: 'get_issue',
          connection: 'linear-main',
          with: {id: 'ENG-1'},
          // The declaration form is not valid on a tool step: every value must
          // be a single interpolation expression string.
          outputs: {ts: {type: 'string'}},
        }),
      ),
      {integrationValidationContext},
    );

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'tool-output-invalid',
        path: ['jobs', 'use', 'steps', 0, 'outputs', 'ts'],
      }),
    ]);
  });

  it('accepts a vars-rooted output mapping', () => {
    const model = normalize(
      toolDocument(
        toolStep({
          key: 'issue',
          tool: 'get_issue',
          connection: 'linear-main',
          with: {id: 'ENG-1'},
          outputs: mappingOutputs({sev: '$' + '{{ vars.SEVERITY }}'}),
        }),
      ),
      {integrationValidationContext},
    );

    const step = model.jobs[0]?.steps[0] as WorkflowModelToolStep;
    expect(step.outputMappings?.sev).toMatchObject({
      language: 'cel',
      source: 'vars.SEVERITY',
    });
  });

  it('rejects a mapped output named result', () => {
    const error = expectInvalid(
      toolDocument(
        toolStep({
          key: 'issue',
          tool: 'get_issue',
          connection: 'linear-main',
          with: {id: 'ENG-1'},
          outputs: mappingOutputs({result: '$' + '{{ result.identifier }}'}),
        }),
      ),
      {integrationValidationContext},
    );

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'tool-output-invalid',
        message: 'The "result" output is reserved for the tool result and cannot be redeclared.',
        path: ['jobs', 'use', 'steps', 0, 'outputs', 'result'],
      }),
    ]);
  });

  it('keeps a __proto__ output key as an own mapping', () => {
    const model = normalize(
      toolDocument(
        toolStep({
          key: 'issue',
          tool: 'get_issue',
          connection: 'linear-main',
          with: {id: 'ENG-1'},
          outputs: mappingOutputs(
            Object.fromEntries([['__proto__', '$' + '{{ result.identifier }}']]),
          ),
        }),
      ),
      {integrationValidationContext},
    );

    const step = model.jobs[0]?.steps[0] as WorkflowModelToolStep;
    expect(step.outputMappings).toBeDefined();
    expect(Object.hasOwn(step.outputMappings as object, '__proto__')).toBe(true);
    expect(step.outputMappings?.['__proto__']).toMatchObject({
      language: 'cel',
      source: 'result.identifier',
    });
  });

  it('rejects secrets in tool inputs as runner context', () => {
    const error = expectInvalid(
      toolDocument(
        toolStep({
          key: 'issue',
          tool: 'get_issue',
          connection: 'linear-main',
          with: {id: '$' + '{{ secrets.API_TOKEN }}'},
        }),
      ),
      {integrationValidationContext},
    );

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'runner-context-in-field',
        path: ['jobs', 'use', 'steps', 0, 'with', 'id'],
      }),
    ]);
  });

  it('rejects a missing connection when no default source connection exists', () => {
    const error = expectInvalid(
      toolDocument(
        toolStep({
          tool: 'get_issue',
          with: {id: 'ENG-1'},
        }),
      ),
      {
        integrationValidationContext: {
          ...integrationValidationContext,
          defaultConnectionSlug: undefined,
        },
      },
    );

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'missing-connection-for-tool',
        path: ['jobs', 'use', 'steps', 0, 'tool'],
      }),
    ]);
  });

  it('rejects a connection that is not in the workspace snapshot', () => {
    const error = expectInvalid(
      toolDocument(
        toolStep({
          tool: 'get_issue',
          connection: 'missing-main',
          with: {id: 'ENG-1'},
        }),
      ),
      {integrationValidationContext},
    );

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'integration-connection-not-found',
        path: ['jobs', 'use', 'steps', 0, 'connection'],
      }),
    ]);
  });

  it('rejects a connection that does not support agent tools', () => {
    const error = expectInvalid(
      toolDocument(
        toolStep({
          tool: 'get_issue',
          connection: 'sentry-main',
          with: {id: 'ENG-1'},
        }),
      ),
      {integrationValidationContext},
    );

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'integration-connection-not-capable',
        path: ['jobs', 'use', 'steps', 0, 'connection'],
      }),
    ]);
  });

  it('rejects an unknown standalone tool', () => {
    const error = expectInvalid(
      toolDocument(
        toolStep({
          tool: 'no_such_tool',
          connection: 'linear-main',
        }),
      ),
      {integrationValidationContext},
    );

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'unknown-integration-tool',
        message: 'Unknown integration tool: no_such_tool.',
        path: ['jobs', 'use', 'steps', 0, 'tool'],
      }),
    ]);
  });

  it('lists the available methods when a family is named without a method', () => {
    const error = expectInvalid(
      toolDocument(
        toolStep({
          tool: 'issue_read',
          connection: 'github-main',
          with: {owner: 'acme', repo: 'platform'},
        }),
      ),
      {integrationValidationContext},
    );

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'unknown-integration-tool',
        message:
          'Tool "issue_read" names a method family; specify one of its methods. Available methods: issue_read.get, issue_read.create.',
        path: ['jobs', 'use', 'steps', 0, 'tool'],
      }),
    ]);
  });

  it('lists the available methods when a family method is unknown', () => {
    const error = expectInvalid(
      toolDocument(
        toolStep({
          tool: 'issue_read.bogus',
          connection: 'github-main',
          with: {owner: 'acme', repo: 'platform'},
        }),
      ),
      {integrationValidationContext},
    );

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'unknown-integration-tool',
        message:
          'Unknown integration tool method "issue_read.bogus". Available methods: issue_read.get, issue_read.create.',
        path: ['jobs', 'use', 'steps', 0, 'tool'],
      }),
    ]);
  });

  it('rejects a method suffix on a tool without methods', () => {
    const error = expectInvalid(
      toolDocument(
        toolStep({
          tool: 'get_issue.get',
          connection: 'linear-main',
        }),
      ),
      {integrationValidationContext},
    );

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'unknown-integration-tool',
        message: 'Unknown integration tool: get_issue.get.',
        path: ['jobs', 'use', 'steps', 0, 'tool'],
      }),
    ]);
  });

  it('rejects a tool id with a second dot in family.method', () => {
    const error = expectInvalid(
      toolDocument(
        toolStep({
          tool: 'issue_write.update.extra',
          connection: 'github-main',
        }),
      ),
      {integrationValidationContext},
    );

    // The structural failure is reported once; the catalog lookup is skipped
    // so the same root cause does not surface again as unknown-integration-tool.
    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'tool-id-invalid',
        message:
          'Tool id "issue_write.update.extra" must be a standalone tool id or "family.method" with a single dot.',
        path: ['jobs', 'use', 'steps', 0, 'tool'],
      }),
    ]);
  });

  it('rejects a tool id with a second dot without an integration context', () => {
    const error = expectInvalid(
      toolDocument(
        toolStep({
          tool: 'issue_write.update.extra',
        }),
      ),
    );

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'tool-id-invalid',
        message:
          'Tool id "issue_write.update.extra" must be a standalone tool id or "family.method" with a single dot.',
        path: ['jobs', 'use', 'steps', 0, 'tool'],
      }),
    ]);
  });

  it.each([
    'issue_write.',
    '.issue_read.get',
  ] as const)('rejects a boundary-dot tool id "%s" as tool-id-invalid', (toolId) => {
    const error = expectInvalid(
      toolDocument(
        toolStep({
          tool: toolId,
          connection: 'github-main',
        }),
      ),
      {integrationValidationContext},
    );

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'tool-id-invalid',
        message: `Tool id "${toolId}" must be a standalone tool id or "family.method" with a single dot.`,
        path: ['jobs', 'use', 'steps', 0, 'tool'],
      }),
    ]);
  });

  it.each([
    ['with', {integrationValidationContext}],
    ['without', undefined],
  ] as const)('rejects an interpolated tool id %s an integration context', (_label, options) => {
    const error = expectInvalid(
      toolDocument(
        toolStep({
          tool: '$' + '{{ steps.setup.outputs.tool_id }}',
          connection: 'github-main',
        }),
      ),
      options,
    );

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'tool-id-invalid',
        message: 'Tool id must be literal. Interpolation is rejected.',
        path: ['jobs', 'use', 'steps', 0, 'tool'],
      }),
    ]);
  });

  it.each([
    ['with', {integrationValidationContext}],
    ['without', undefined],
  ] as const)('rejects an interpolated connection %s an integration context', (_label, options) => {
    const connection = '$' + '{{ inputs.connection }}';
    const error = expectInvalid(
      toolDocument(
        toolStep({
          tool: 'get_issue',
          connection,
        }),
      ),
      options,
    );

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'tool-id-invalid',
        message: `Connection slug "${connection}" must be literal. Interpolation is rejected.`,
        path: ['jobs', 'use', 'steps', 0, 'connection'],
      }),
    ]);
  });

  it('treats an escaped $${{ sequence in a tool id as literal', () => {
    const model = normalize(
      toolDocument(
        toolStep({
          key: 'issue',
          tool: 'slack' + '$${{channel}}',
          connection: 'linear-main',
          with: {id: 'ENG-1'},
        }),
      ),
    );

    // The document schema treats `$${{` as the escaped literal form; the model
    // boundary mirrors that rule and reports no interpolation issue, freezing
    // the raw source as the standalone id.
    expect(model.jobs[0]?.steps[0]).toMatchObject({
      kind: 'tool',
      tool: {id: 'slack' + '$${{channel}}'},
    });
  });

  it('walks nested with arrays and objects for interpolation templates', () => {
    const model = normalize(
      toolDocument(
        toolStep({
          key: 'issue',
          tool: 'get_issue',
          connection: 'linear-main',
          with: {
            id: 'ENG-1',
            labels: ['fixed', '$' + '{{ inputs.label }}'],
            query: {q: '$' + '{{ vars.QUERY }}'},
          },
        }),
      ),
      {integrationValidationContext},
    );

    const step = model.jobs[0]?.steps[0] as WorkflowModelToolStep;
    expect(step.templates?.with).toMatchObject({
      labels: [undefined, [{kind: 'deferred', roots: ['inputs']}]],
      query: {q: [{kind: 'deferred', roots: ['vars']}]},
    });
  });

  it('collapses fully-literal nested with values to undefined', () => {
    const model = normalize(
      toolDocument(
        toolStep({
          key: 'issue',
          tool: 'get_issue',
          connection: 'linear-main',
          with: {id: 'ENG-1', labels: ['fixed', 'closed'], query: {q: 'text'}},
        }),
      ),
      {integrationValidationContext},
    );

    expect((model.jobs[0]?.steps[0] as WorkflowModelToolStep).templates).toBeUndefined();
  });

  it('rejects missing required tool inputs', () => {
    const error = expectInvalid(
      toolDocument(
        toolStep({
          tool: 'get_issue',
          connection: 'linear-main',
        }),
      ),
      {integrationValidationContext},
    );

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'tool-input-invalid',
        message: 'Tool "get_issue" requires input "id".',
        path: ['jobs', 'use', 'steps', 0, 'with', 'id'],
      }),
    ]);
  });

  it('rejects literal tool inputs whose type does not match the schema', () => {
    const error = expectInvalid(
      toolDocument(
        toolStep({
          tool: 'issue_read.get',
          connection: 'github-main',
          with: {owner: 'acme', repo: 'platform', number: 'seven'},
        }),
      ),
      {integrationValidationContext},
    );

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'tool-input-invalid',
        message: 'Tool input "with.number" must be integer; found string.',
        path: ['jobs', 'use', 'steps', 0, 'with', 'number'],
      }),
    ]);
  });

  it('accepts interpolated leaves whose type is only known at dispatch', () => {
    const model = normalize(
      toolDocument(
        toolStep({
          tool: 'issue_read.get',
          connection: 'github-main',
          with: {
            owner: 'acme',
            repo: 'platform',
            number: '$' + '{{ inputs.issue_number }}',
          },
        }),
      ),
      {integrationValidationContext},
    );

    expect(model.jobs[0]?.steps[0]).toMatchObject({kind: 'tool'});
  });

  it('rejects unknown tool inputs when the schema forbids additional properties', () => {
    const error = expectInvalid(
      toolDocument(
        toolStep({
          tool: 'issue_write.update',
          connection: 'github-main',
          with: {owner: 'acme', repo: 'platform', milestone: 'v1'},
        }),
      ),
      {integrationValidationContext},
    );

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'tool-input-unknown-key',
        message: 'Unknown tool input "milestone" for tool "issue_write.update".',
        path: ['jobs', 'use', 'steps', 0, 'with', 'milestone'],
      }),
    ]);
  });

  it('rejects an authored method input on a family.method tool', () => {
    const error = expectInvalid(
      toolDocument(
        toolStep({
          tool: 'issue_write.update',
          connection: 'github-main',
          with: {owner: 'acme', repo: 'platform', method: 'PUT'},
        }),
      ),
      {integrationValidationContext},
    );

    // `method` is server-injected for family.method tools, so it is neither a
    // required nor an unknown input; only the authored-value rejection fires.
    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'tool-input-invalid',
        path: ['jobs', 'use', 'steps', 0, 'with', 'method'],
      }),
    ]);
  });

  it('does not require a server-injected method input on family.method tools', () => {
    const model = normalize(
      toolDocument(
        toolStep({
          tool: 'issue_write.update',
          connection: 'github-main',
          with: {owner: 'acme', repo: 'platform', title: 'Fix'},
        }),
      ),
      {integrationValidationContext},
    );

    expect(model.jobs[0]?.steps[0]).toMatchObject({kind: 'tool'});
  });

  it('types job outputs from a tool step result overlay', () => {
    const model = normalize(
      {
        name: 'tools',
        jobs: {
          use: {
            outputs: {
              issueKey: '$' + '{{ steps.issue.outputs.result.identifier }}',
            },
            steps: [
              toolStep({
                key: 'issue',
                tool: 'get_issue',
                connection: 'linear-main',
                with: {id: 'ENG-1'},
              }),
            ],
          },
        },
      },
      {integrationValidationContext},
    );

    // The job output is typed from the catalog overlay even though the tool
    // step authored no `outputs` (the toolOverlayByKey guard must stay on).
    expect(model.jobs[0]?.outputs?.issueKey?.[0]).toMatchObject({
      kind: 'deferred',
      expression: expect.objectContaining({check: 'typed', resultType: 'string'}),
    });
    expect(model.jobs[0]?.outputTypes).toEqual({issueKey: 'string'});
  });

  it('types later step expressions from a tool result overlay without authored outputs', () => {
    const model = normalize(
      {
        name: 'tools',
        jobs: {
          use: {
            steps: [
              toolStep({
                key: 'issue',
                tool: 'get_issue',
                connection: 'linear-main',
                with: {id: 'ENG-1'},
              }),
              toolStep({
                key: 'next',
                tool: 'save_comment',
                connection: 'linear-main',
                with: {
                  issueId: '$' + '{{ steps.issue.outputs.result.identifier }}',
                  body: 'typed from the tool overlay',
                },
              }),
            ],
          },
        },
      },
      {integrationValidationContext},
    );

    const next = model.jobs[0]?.steps[1] as WorkflowModelToolStep;
    expect(next.templates?.with).toMatchObject({
      issueId: [
        {
          kind: 'deferred',
          expression: expect.objectContaining({check: 'typed', resultType: 'string'}),
        },
      ],
    });
  });

  it('preserves structured mapped output types in the step overlay', () => {
    const linearCatalog = integrationValidationContext.agentToolCatalogs.get('linear');
    const context: IntegrationValidationContext = {
      ...integrationValidationContext,
      agentToolCatalogs: new Map([
        ...integrationValidationContext.agentToolCatalogs,
        [
          'linear',
          {
            tools: [
              ...(linearCatalog?.tools ?? []),
              {
                id: 'nested_reader',
                description: 'Read a nested payload',
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
                    meta: {
                      type: 'object',
                      properties: {count: {type: 'integer'}},
                      required: ['count'],
                      additionalProperties: false,
                    },
                  },
                  required: ['meta'],
                  additionalProperties: false,
                },
              },
            ],
          },
        ],
      ]),
    };
    const model = normalize(
      {
        name: 'tools',
        jobs: {
          use: {
            steps: [
              toolStep({
                key: 'nested',
                tool: 'nested_reader',
                connection: 'linear-main',
                with: {id: 'ENG-1'},
                outputs: mappingOutputs({
                  meta: '$' + '{{ result.meta }}',
                }),
              }),
              toolStep({
                key: 'next',
                tool: 'save_comment',
                connection: 'linear-main',
                with: {
                  issueId: 'ENG-1',
                  body: '$' + '{{ steps.nested.outputs.meta.count }}',
                },
              }),
            ],
          },
        },
      },
      {integrationValidationContext: context},
    );

    const next = model.jobs[0]?.steps[1] as WorkflowModelToolStep;
    // The mapped `meta` output keeps the catalog object shape instead of
    // degrading to schema-less JSON, so nested field access stays typed as
    // `int` rather than falling back to the untyped `string` map lookup.
    expect(next.templates?.with).toMatchObject({
      body: [
        {
          kind: 'deferred',
          expression: expect.objectContaining({check: 'typed', resultType: 'int'}),
        },
      ],
    });
  });

  it('keeps shape-only checks when the integration context is absent', () => {
    const model = normalize(
      toolDocument(
        toolStep({
          key: 'issue',
          tool: 'get_issue',
          connection: 'linear-main',
          with: {id: '$' + '{{ run.number }}'},
          outputs: mappingOutputs({identifier: '$' + '{{ result.identifier }}'}),
        }),
      ),
    );

    const step = model.jobs[0]?.steps[0] as WorkflowModelToolStep;
    expect(step.kind).toBe('tool');
    expect(step.tool).toEqual({id: 'get_issue'});
    expect(step.outputMappings?.identifier).toBeDefined();
  });

  it('reports tool issues with the definition scope', () => {
    const error = expectInvalid(
      toolDocument(
        toolStep({
          tool: 'get_issue',
          connection: 'linear-main',
        }),
      ),
      {integrationValidationContext},
    );

    expect(error.issues[0]).toMatchObject({
      code: 'tool-input-invalid',
      scope: 'definition',
      severity: 'error',
    });
  });
});
