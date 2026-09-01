import {
  integrationsInterModuleContract,
  repositoryAuthorizationErrorCodes,
} from './inter-module.js';

describe('integrationsInterModuleContract', () => {
  test('owns the repository authorization error codes', () => {
    expect(repositoryAuthorizationErrorCodes).toEqual({
      notGranted: 'repository-not-granted',
      ambiguous: 'repository-ambiguous',
      storeUnavailable: 'repository-authorization-unavailable',
      targetInvalid: 'repository-authorization-target-invalid',
    });
  });

  test('accepts a nullable normalized trigger reference', () => {
    const result = integrationsInterModuleContract.methods.resolveTriggerReference.output.parse({
      externalRepositoryId: 'github:42',
      ref: 'refs/heads/main',
      commit: 'a'.repeat(40),
      actor: 'octocat',
    });

    expect(result?.externalRepositoryId).toBe('github:42');
    expect(result?.actor).toBe('octocat');
    expect(
      integrationsInterModuleContract.methods.resolveTriggerReference.output.parse(null),
    ).toBeNull();
  });

  test('accepts a reference from a payload that named no actor', () => {
    const result = integrationsInterModuleContract.methods.resolveTriggerReference.output.parse({
      externalRepositoryId: 'github:42',
      ref: 'refs/heads/main',
      commit: 'a'.repeat(40),
      actor: null,
    });

    expect(result?.actor).toBeNull();
  });

  test('accepts a source repository lookup through the producer contract', () => {
    const result = integrationsInterModuleContract.methods.resolveSourceRepository.output.parse({
      connection: {
        id: '00000000-0000-4000-8000-000000000001',
        provider: 'github',
        slug: 'github-main',
      },
      repository: {
        externalRepositoryId: 'shipfox/project',
        owner: 'shipfox',
        name: 'project',
        fullName: 'shipfox/project',
        defaultBranch: 'main',
        visibility: 'private',
        cloneUrl: 'https://github.com/shipfox/project.git',
        htmlUrl: 'https://github.com/shipfox/project',
      },
    });

    expect(result.repository.fullName).toBe('shipfox/project');
  });

  test('accepts a workspace-scoped connection lookup through the producer contract', () => {
    const input = integrationsInterModuleContract.methods.resolveConnection.input.parse({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      slug: 'github-main',
    });
    const output = integrationsInterModuleContract.methods.resolveConnection.output.parse({
      id: '00000000-0000-4000-8000-000000000002',
      provider: 'github',
      slug: 'github-main',
    });

    expect(input.slug).toBe('github-main');
    expect(output?.id).toBe('00000000-0000-4000-8000-000000000002');
    expect(integrationsInterModuleContract.methods.resolveConnection.output.parse(null)).toBeNull();
  });

  test('accepts a resolved source ref through the producer contract', () => {
    const result = integrationsInterModuleContract.methods.resolveSourceRef.output.parse({
      ref: 'refs/heads/fix-triage-prompt',
      commit: 'a'.repeat(40),
    });

    expect(result).toEqual({ref: 'refs/heads/fix-triage-prompt', commit: 'a'.repeat(40)});
  });

  test('parses a ref-bearing input through the producer contract', () => {
    const input = integrationsInterModuleContract.methods.resolveSourceRef.input.parse({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      connectionId: '00000000-0000-4000-8000-000000000002',
      externalRepositoryId: 'github:42',
      ref: 'refs/heads/main',
    });

    expect(input.ref).toBe('refs/heads/main');
  });

  test('rejects control characters in a ref-bearing input', () => {
    expect(() =>
      integrationsInterModuleContract.methods.resolveSourceRef.input.parse({
        workspaceId: '00000000-0000-4000-8000-000000000001',
        connectionId: '00000000-0000-4000-8000-000000000002',
        externalRepositoryId: 'github:42',
        ref: 'refs/heads/unsafe\nname',
      }),
    ).toThrow();
  });

  test('accepts checkout targets addressed by an external id or owner/name', () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const connectionId = '00000000-0000-4000-8000-000000000002';
    const projectId = '00000000-0000-4000-8000-000000000003';

    expect(
      integrationsInterModuleContract.methods.createCheckoutSpec.input.parse({
        workspaceId,
        connectionId,
        projectId,
        target: {kind: 'external-id', externalRepositoryId: 'github:42'},
      }),
    ).toMatchObject({projectId, target: {kind: 'external-id', externalRepositoryId: 'github:42'}});

    expect(
      integrationsInterModuleContract.methods.createCheckoutCredentials.input.parse({
        workspaceId,
        connectionId,
        target: {kind: 'name', owner: 'shipfox', name: 'platform'},
        permissions: {contents: 'read'},
      }).target,
    ).toEqual({kind: 'name', owner: 'shipfox', name: 'platform'});
  });

  test('trims name targets and rejects whitespace-only names', () => {
    const input = {
      workspaceId: '00000000-0000-4000-8000-000000000001',
      connectionId: '00000000-0000-4000-8000-000000000002',
      target: {kind: 'name' as const, owner: ' shipfox ', name: ' platform '},
    };

    expect(
      integrationsInterModuleContract.methods.createCheckoutSpec.input.parse(input),
    ).toMatchObject({target: {kind: 'name', owner: 'shipfox', name: 'platform'}});
    expect(() =>
      integrationsInterModuleContract.methods.createCheckoutSpec.input.parse({
        ...input,
        target: {kind: 'name', owner: ' ', name: 'platform'},
      }),
    ).toThrow();
  });

  test.each([
    ['a missing target', {}],
    [
      'both target forms',
      {
        target: {kind: 'name', owner: 'shipfox', name: 'platform'},
        externalRepositoryId: 'github:42',
      },
    ],
    [
      'a caller-supplied clone URL',
      {
        target: {kind: 'name', owner: 'shipfox', name: 'platform'},
        repositoryUrl: 'https://github.com/shipfox/platform.git',
      },
    ],
  ])('rejects checkout input with %s', (_label, extra) => {
    expect(() =>
      integrationsInterModuleContract.methods.createCheckoutSpec.input.parse({
        workspaceId: '00000000-0000-4000-8000-000000000001',
        connectionId: '00000000-0000-4000-8000-000000000002',
        ...extra,
      }),
    ).toThrow();
  });

  test.each([
    ['connection-not-found', {connectionId: '00000000-0000-4000-8000-000000000001'}],
    ['provider-unavailable', {provider: 'github'}],
    ['provider-failure', {reason: 'rate-limited', retryAfterSeconds: 30}],
  ] as const)('defines the %s source failure', (code, details) => {
    const schema =
      integrationsInterModuleContract.methods.resolveSourceRepository.errors[
        code as keyof typeof integrationsInterModuleContract.methods.resolveSourceRepository.errors
      ];

    expect(schema.parse(details)).toEqual(details);
  });

  test.each([
    'repository-not-granted',
    'repository-ambiguous',
    'repository-authorization-unavailable',
    'repository-authorization-target-invalid',
  ] as const)('defines the %s checkout failure', (code) => {
    const schema = integrationsInterModuleContract.methods.createCheckoutSpec.errors[code];

    expect(schema.parse({})).toEqual({});
  });

  test('requires the provider-resolved checkout target in a checkout spec', () => {
    const output = integrationsInterModuleContract.methods.createCheckoutSpec.output.parse({
      repositoryUrl: 'https://github.com/shipfox/platform.git',
      ref: 'main',
      target: {kind: 'external-id', externalRepositoryId: 'github:42'},
    });

    expect(output.target).toEqual({kind: 'external-id', externalRepositoryId: 'github:42'});
  });

  test.each([
    ['ref-not-found', {ref: 'refs/heads/missing'}],
    ['ref-invalid', {ref: 'a'.repeat(40)}],
  ] as const)('defines the %s ref failure', (code, details) => {
    const schema =
      integrationsInterModuleContract.methods.resolveSourceRef.errors[
        code as keyof typeof integrationsInterModuleContract.methods.resolveSourceRef.errors
      ];

    expect(schema.parse(details)).toEqual(details);
  });

  test('accepts provider event catalogs and fixed event providers on the validation context', () => {
    const output = integrationsInterModuleContract.methods.getAgentToolsContext.output.parse({
      selectionCatalogs: [],
      catalogs: [],
      workspaceConnections: [],
      eventCatalogs: [
        {provider: 'github', events: ['push']},
        {provider: 'webhook', events: ['received']},
      ],
      fixedEventProviders: ['webhook'],
      defaultConnection: null,
    });

    expect(output.eventCatalogs).toEqual([
      {provider: 'github', events: ['push']},
      {provider: 'webhook', events: ['received']},
    ]);
    expect(output.fixedEventProviders).toEqual(['webhook']);
  });

  test('rejects empty fixed event provider identifiers', () => {
    expect(() =>
      integrationsInterModuleContract.methods.getAgentToolsContext.output.parse({
        selectionCatalogs: [],
        catalogs: [],
        workspaceConnections: [],
        eventCatalogs: [],
        fixedEventProviders: [''],
        defaultConnection: null,
      }),
    ).toThrow();
  });

  const toolCallInput = {
    workspaceId: '00000000-0000-4000-8000-000000000001',
    connectionId: '00000000-0000-4000-8000-000000000002',
    tool: {
      id: 'issue_read',
      provider: 'github',
      method: 'get',
      sensitivity: 'read',
      sensitive: false,
      requiredScope: [],
      inputSchema: {type: 'object'},
      methods: [
        {
          id: 'get',
          token: 'issue_read.get',
          sensitivity: 'read',
          sensitive: false,
          requiredScope: [],
        },
      ],
    },
    arguments: {owner: 'shipfox', repo: 'platform', issue_number: 1},
    caller: {
      kind: 'tool_step',
      projectId: 'project-1',
      runId: 'run-1',
      jobExecutionId: 'execution-1',
      stepId: 'step-1',
      stepAttempt: 2,
      callIndex: 3,
    },
  };

  test('accepts a frozen tool call input with a tool-step caller', () => {
    const input = integrationsInterModuleContract.methods.callTool.input.parse(toolCallInput);

    expect(input.caller).toMatchObject({kind: 'tool_step', callIndex: 3});
    expect(input.tool.method).toBe('get');
  });

  test('accepts an agent caller and optional output metadata', () => {
    const input = integrationsInterModuleContract.methods.callTool.input.parse({
      ...toolCallInput,
      caller: {kind: 'agent'},
      tool: {
        ...toolCallInput.tool,
        method: undefined,
        methods: undefined,
        outputSchema: {type: 'object'},
      },
    });

    expect(input.caller).toEqual({kind: 'agent'});
    expect(input.tool.methods).toBeUndefined();
  });

  test('accepts a successful tool call outcome with a null structured result', () => {
    const output = integrationsInterModuleContract.methods.callTool.output.parse({
      outcome: 'success',
      result: null,
      content: [{type: 'text', text: 'dispatched'}],
    });

    expect(output.outcome).toBe('success');
  });

  test('accepts a bounded error outcome with retry and status details', () => {
    const output = integrationsInterModuleContract.methods.callTool.output.parse({
      outcome: 'error',
      code: 'rate-limited',
      message: 'Try again later',
      retryAfterSeconds: 30,
      status: 429,
    });

    expect(output).toEqual({
      outcome: 'error',
      code: 'rate-limited',
      message: 'Try again later',
      retryAfterSeconds: 30,
      status: 429,
    });
  });

  test('rejects a tool step caller without its identity fields', () => {
    expect(() =>
      integrationsInterModuleContract.methods.callTool.input.parse({
        ...toolCallInput,
        caller: {kind: 'tool_step'},
      }),
    ).toThrow();
  });

  test.each([undefined, ''])('rejects a tool step caller with projectId %j', (projectId) => {
    expect(() =>
      integrationsInterModuleContract.methods.callTool.input.parse({
        ...toolCallInput,
        caller: {...toolCallInput.caller, projectId},
      }),
    ).toThrow();
  });

  test.each([
    ['connection-not-found', {connectionId: '00000000-0000-4000-8000-000000000001'}],
    ['connection-inactive', {connectionId: '00000000-0000-4000-8000-000000000001'}],
    ['connection-workspace-mismatch', {connectionId: '00000000-0000-4000-8000-000000000001'}],
    ['connection-provider-changed', {connectionId: '00000000-0000-4000-8000-000000000001'}],
    ['provider-unavailable', {provider: 'github'}],
    ['capability-unavailable', {provider: 'github', capability: 'agent_tools'}],
  ] as const)('defines the %s callTool failure', (code, details) => {
    const schema =
      integrationsInterModuleContract.methods.callTool.errors[
        code as keyof typeof integrationsInterModuleContract.methods.callTool.errors
      ];

    expect(schema.parse(details)).toEqual(details);
  });

  test.each([
    'repository-not-granted',
    'repository-ambiguous',
    'repository-authorization-unavailable',
  ] as const)('defines the %s callTool failure', (code) => {
    const schema = integrationsInterModuleContract.methods.callTool.errors[code];

    expect(schema.parse({})).toEqual({});
  });
});
