import type {RepositorySnapshot} from '#db/repositories.js';
import {VcsProviderError} from '../errors.js';
import type {ResolveRepositoryInput, VcsProvider} from './vcs-provider.js';

export class TestVcsProvider implements VcsProvider {
  async resolveRepository(input: ResolveRepositoryInput): Promise<RepositorySnapshot> {
    await Promise.resolve();

    if (input.externalRepositoryId === 'not-found') {
      throw new VcsProviderError('repository-not-found', 'Repository not found');
    }
    if (input.externalRepositoryId === 'access-denied') {
      throw new VcsProviderError('access-denied', 'Repository access denied');
    }
    if (input.externalRepositoryId === 'rate-limited') {
      throw new VcsProviderError('rate-limited', 'Provider rate limited', 60);
    }
    if (input.externalRepositoryId === 'timeout') {
      throw new VcsProviderError('timeout', 'Provider request timed out');
    }
    if (input.externalRepositoryId === 'provider-unavailable') {
      throw new VcsProviderError('provider-unavailable', 'Provider is unavailable');
    }
    if (input.externalRepositoryId === 'malformed-provider-response') {
      throw new VcsProviderError('malformed-provider-response', 'Provider returned malformed data');
    }

    const owner = 'test-owner';
    const name = input.externalRepositoryId;
    return {
      provider: input.connection.provider,
      providerHost: input.connection.providerHost,
      externalRepositoryId: input.externalRepositoryId,
      owner,
      name,
      fullName: `${owner}/${name}`,
      defaultBranch: 'main',
      visibility: 'private',
      cloneUrl: `https://${input.connection.providerHost}/${owner}/${name}.git`,
      htmlUrl: `https://${input.connection.providerHost}/${owner}/${name}`,
    };
  }
}
