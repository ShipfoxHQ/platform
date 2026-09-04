import {
  AUTH_USER,
  buildUserContext,
  setUserContext,
  type UserContextMembership,
} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {type AuthMethod, ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import {afterEach, beforeEach} from '@shipfox/vitest/vi';
import {sql} from 'drizzle-orm';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {db} from '#db/db.js';
import {
  createIntegrationsModule,
  createRepositoryAuthorizer,
  type IntegrationProvider,
  type RepositoryAuthorizer,
} from '#index.js';

let authenticatedMemberships: UserContextMembership[] = [];

function createFakeUserAuth(memberships: ReadonlyArray<UserContextMembership>): AuthMethod {
  return {
    name: AUTH_USER,
    authenticate: (request: FastifyRequest) => {
      if (
        request.headers.authorization !== 'Bearer user' &&
        request.headers.authorization !== 'Bearer impersonated'
      ) {
        throw new ClientError('Invalid user token', 'unauthorized', {status: 401});
      }

      setUserContext(
        request,
        buildUserContext({
          userId: 'user-1',
          email: 'user@example.com',
          memberships,
          ...(request.headers.authorization === 'Bearer impersonated'
            ? {impersonatorId: 'impersonator-1'}
            : {}),
        }),
      );
      return Promise.resolve();
    },
  };
}

export function sourceProvider(overrides: Partial<IntegrationProvider> = {}): IntegrationProvider {
  return {
    provider: 'gitea',
    displayName: 'Gitea',
    adapters: {
      source_control: {
        listRepositories: async () => {
          await Promise.resolve();
          return {
            repositories: [
              {
                externalRepositoryId: 'gitea:gitea-owner/platform',
                owner: 'gitea-owner',
                name: 'platform',
                fullName: 'gitea-owner/platform',
                defaultBranch: 'main',
                visibility: 'private',
                cloneUrl: 'https://gitea.local/gitea-owner/platform.git',
                htmlUrl: 'https://gitea.local/gitea-owner/platform',
              },
            ],
            nextCursor: null,
          };
        },
        resolveRepository: async () => {
          await Promise.resolve();
          throw new Error('not used');
        },
        listFiles: async () => {
          await Promise.resolve();
          return {files: [], nextCursor: null};
        },
        fetchFile: async () => {
          await Promise.resolve();
          throw new Error('not used');
        },
        resolveTriggerReference: () => null,
        resolveRef: async () => {
          await Promise.resolve();
          throw new Error('not used');
        },
      },
    },
    ...overrides,
  };
}

export interface CreateTestAppOptions {
  memberships?: ReadonlyArray<UserContextMembership> | undefined;
  projects?: ProjectsModuleClient | undefined;
  repositoryAuthorizer?: RepositoryAuthorizer | undefined;
}

export async function createTestApp(
  providers: IntegrationProvider[],
  options: CreateTestAppOptions = {},
): Promise<FastifyInstance> {
  const memberships = options.memberships ?? authenticatedMemberships;
  const integrationsModule = await createIntegrationsModule({
    providers,
    projects: options.projects,
    repositoryAuthorizer:
      options.repositoryAuthorizer ?? createRepositoryAuthorizer({enabled: false}),
  });
  const app = await createApp({
    auth: [createFakeUserAuth(memberships)],
    routes: integrationsModule.routes ?? [],
    swagger: false,
  });
  await app.ready();
  return app;
}

export function useIntegrationRouteTest() {
  let workspaceId: string;

  beforeEach(async () => {
    await closeApp();
    workspaceId = crypto.randomUUID();
    authenticatedMemberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];
  });

  afterEach(async () => {
    await closeApp();
    await db().execute(sql`TRUNCATE integrations_secret_cleanups CASCADE`);
  });

  return {
    get workspaceId() {
      return workspaceId;
    },
  };
}
