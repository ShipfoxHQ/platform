import {integrationsInterModuleContract} from './inter-module.js';

describe('integrationsInterModuleContract', () => {
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
    ['ref-not-found', {ref: 'refs/heads/missing'}],
    ['ref-invalid', {ref: 'a'.repeat(40)}],
  ] as const)('defines the %s ref failure', (code, details) => {
    const schema =
      integrationsInterModuleContract.methods.resolveSourceRef.errors[
        code as keyof typeof integrationsInterModuleContract.methods.resolveSourceRef.errors
      ];

    expect(schema.parse(details)).toEqual(details);
  });
});
