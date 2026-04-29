import {DebugIntegrationProviderError, DebugSourceControlProvider} from '#core/source-control.js';

describe('DebugSourceControlProvider', () => {
  it('returns deterministic repositories with cursor pagination', async () => {
    const provider = new DebugSourceControlProvider();

    const result = await provider.listRepositories({
      connection: {},
      limit: 1,
    });

    expect(result.repositories[0]?.externalRepositoryId).toBe('platform');
    expect(result.nextCursor).toBe('1');
  });

  it('resolves a known repository by external id', async () => {
    const provider = new DebugSourceControlProvider();

    const result = await provider.resolveRepository({
      externalRepositoryId: 'platform',
    });

    expect(result.fullName).toBe('debug-owner/platform');
  });

  it('rejects unknown repositories with a provider error', async () => {
    const provider = new DebugSourceControlProvider();

    const result = provider.resolveRepository({
      externalRepositoryId: 'unknown',
    });

    await expect(result).rejects.toBeInstanceOf(DebugIntegrationProviderError);
  });
});
