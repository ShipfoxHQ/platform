import type {
  IntegrationConnection,
  ListRepositoriesInput,
  RepositoryPage,
  RepositorySnapshot,
  RepositoryVisibility,
  ResolveRepositoryInput,
  SourceControlProvider,
} from '@shipfox/api-integration-core-dto';
import type {GithubApiClient, GithubRepository} from '#api/client.js';
import {getGithubInstallationByConnectionId} from '#db/installations.js';
import {GithubIntegrationProviderError} from './errors.js';

type GithubIntegrationConnection = IntegrationConnection<'github'>;

export class GithubSourceControlProvider
  implements SourceControlProvider<GithubIntegrationConnection>
{
  constructor(private readonly github: GithubApiClient) {}

  async listRepositories(
    input: ListRepositoriesInput<GithubIntegrationConnection>,
  ): Promise<RepositoryPage> {
    const installation = await getGithubInstallationByConnectionId(input.connection.id);
    if (!installation) {
      throw new GithubIntegrationProviderError(
        'access-denied',
        'GitHub installation details were not found for the connection',
      );
    }

    const page = await this.github.listInstallationRepositories({
      installationId: Number.parseInt(installation.installationId, 10),
      limit: input.limit,
      cursor: input.cursor,
    });

    return {
      repositories: page.repositories.map(toRepositorySnapshot),
      nextCursor: page.nextCursor,
    };
  }

  async resolveRepository(
    input: ResolveRepositoryInput<GithubIntegrationConnection>,
  ): Promise<RepositorySnapshot> {
    let cursor: string | undefined;
    do {
      const page = await this.listRepositories({
        connection: input.connection,
        limit: 100,
        cursor,
      });
      const repository = page.repositories.find(
        (item) => item.externalRepositoryId === input.externalRepositoryId,
      );
      if (repository) return repository;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    throw new GithubIntegrationProviderError('repository-not-found', 'GitHub repository not found');
  }
}

function toRepositorySnapshot(repository: GithubRepository): RepositorySnapshot {
  return {
    externalRepositoryId: String(repository.id),
    owner: repository.ownerLogin,
    name: repository.name,
    fullName: repository.fullName,
    defaultBranch: repository.defaultBranch,
    visibility: toRepositoryVisibility(repository),
    cloneUrl: repository.cloneUrl,
    htmlUrl: repository.htmlUrl,
  };
}

function toRepositoryVisibility(repository: GithubRepository): RepositoryVisibility {
  if (repository.visibility === 'public') return 'public';
  if (repository.visibility === 'private') return 'private';
  if (repository.visibility === 'internal') return 'internal';
  return repository.private ? 'private' : 'public';
}
