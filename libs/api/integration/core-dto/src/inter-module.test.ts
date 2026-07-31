import {integrationsInterModuleContract} from './inter-module.js';

describe('integrationsInterModuleContract', () => {
  test('accepts a nullable normalized trigger reference', () => {
    const result = integrationsInterModuleContract.methods.resolveTriggerReference.output.parse({
      externalRepositoryId: 'github:42',
      ref: 'refs/heads/main',
      commit: 'a'.repeat(40),
    });

    expect(result?.externalRepositoryId).toBe('github:42');
    expect(
      integrationsInterModuleContract.methods.resolveTriggerReference.output.parse(null),
    ).toBeNull();
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
});
