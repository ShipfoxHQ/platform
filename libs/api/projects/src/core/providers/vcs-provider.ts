import type {RepositorySnapshot} from '#db/repositories.js';
import type {VcsConnection} from '../entities/vcs-connection.js';

export interface ResolveRepositoryInput {
  connection: VcsConnection;
  externalRepositoryId: string;
}

export interface VcsConnectionProvider {
  refreshConnection?(connection: VcsConnection): Promise<VcsConnection>;
}

export interface VcsRepositoryProvider {
  resolveRepository(input: ResolveRepositoryInput): Promise<RepositorySnapshot>;
}

export interface VcsProvider extends VcsConnectionProvider, VcsRepositoryProvider {}
