import {createGithubApiClient, type GithubApiClient} from '#api/client.js';
import {GithubSourceControlProvider} from '#core/source-control.js';
import {closeDb, db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';
import {
  type CreateGithubIntegrationRoutesOptions,
  createGithubIntegrationRoutes,
} from '#presentation/routes/install.js';

export type {GithubApiClient} from '#api/client.js';
export type {IntegrationConnection, IntegrationProvider} from '#core/contracts.js';
export {GithubIntegrationProviderError} from '#core/errors.js';
export type {ConnectGithubInstallationInput} from '#core/install.js';
export {handleGithubCallback} from '#core/install.js';
export {signGithubInstallState, verifyGithubInstallState} from '#core/state.js';
export type {GithubInstallation, UpsertGithubInstallationParams} from '#db/installations.js';
export {
  getGithubInstallationByConnectionId,
  upsertGithubInstallation,
} from '#db/installations.js';
export {closeDb, db, migrationsPath};

export interface CreateGithubIntegrationProviderOptions
  extends Omit<CreateGithubIntegrationRoutesOptions, 'github'> {
  github?: GithubApiClient | undefined;
}

export function createGithubIntegrationProvider(options: CreateGithubIntegrationProviderOptions) {
  const github = options.github ?? createGithubApiClient();

  return {
    provider: 'github' as const,
    displayName: 'GitHub',
    capabilities: ['source_control' as const],
    sourceControl: new GithubSourceControlProvider(github),
    routes: [
      createGithubIntegrationRoutes({
        github,
        connectGithubInstallation: options.connectGithubInstallation,
      }),
    ],
  };
}
