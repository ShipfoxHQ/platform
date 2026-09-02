import {
  createE2eTestVcsConnectionBodySchema,
  integrationConnectionDtoSchema,
  repositoryDtoSchema,
  testVcsStatsDtoSchema,
} from '@shipfox/api-integration-core-dto';
import type {IntegrationConnection as SpiIntegrationConnection} from '@shipfox/api-integration-spi';
import {ClientError, defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import {z} from 'zod';
import {config} from '#config.js';
import {getIntegrationProviderCapabilities} from '#core/providers/registry.js';
import {
  getIntegrationConnectionById,
  resolveUniqueConnectionSlug,
  upsertIntegrationConnection,
} from '#db/connections.js';
import {db} from '#db/db.js';
import {toIntegrationConnectionDto, toRepositoryDto} from '#presentation/dto/integrations.js';
import {retryConnectionSlugCollision, slugifyConnectionSlug} from '#providers/connection-slug.js';
import {
  createTestVcsIntegrationProvider,
  TEST_VCS_PROVIDER,
  type TestVcsSourceControlProvider,
} from '#providers/test-vcs.js';
import {
  createTestVcsFixture,
  createTestVcsFixtureService,
  isValidTestVcsBranchName,
  isValidTestVcsRefreshTiming,
  type TestVcsFileInput,
  type TestVcsRenewalMode,
} from '#providers/test-vcs-fixture.js';
import type {IntegrationModuleParts} from '#providers/types.js';

const repositoryPartSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u);
const branchNameSchema = z
  .string()
  .min(1)
  .max(200)
  .refine(isValidTestVcsBranchName, {message: 'must be a valid Git branch name'});
const fileSchema = z.object({path: z.string().min(1).max(512), content: z.string()}).strict();
const createConnectionBodySchema = createE2eTestVcsConnectionBodySchema.superRefine(
  (body, context) => {
    if (body.renewal_mode !== 'refresh-at') return;
    if (
      isValidTestVcsRefreshTiming(
        config.INTEGRATIONS_TEST_VCS_CREDENTIAL_TTL_SECONDS,
        body.refresh_after_seconds,
      )
    ) {
      return;
    }
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['refresh_after_seconds'],
      message: 'refresh_after_seconds must produce a deadline before credential expiry',
    });
  },
);
const createRepositoryBodySchema = z
  .object({
    connection_id: z.string().uuid(),
    name: repositoryPartSchema,
    default_branch: branchNameSchema.default('main'),
    files: z.array(fileSchema).min(1).max(128),
  })
  .strict();
const commitFilesBodySchema = z
  .object({
    connection_id: z.string().uuid(),
    external_repository_id: z.string().min(1),
    message: z.string().min(1).max(200),
    files: z.array(fileSchema).min(1).max(128),
  })
  .strict();
const statsQuerySchema = z.object({connection_id: z.string().uuid().optional()}).strict();
const failMintsBodySchema = z.object({count: z.number().int().min(1).max(10)}).strict();

type TestVcsConnection = SpiIntegrationConnection<typeof TEST_VCS_PROVIDER>;

export function load(): Promise<IntegrationModuleParts> {
  const fixture = createTestVcsFixture({
    port: config.INTEGRATIONS_TEST_VCS_PORT,
  });
  const {provider, sourceControl} = createTestVcsIntegrationProvider({
    fixture,
    credentialTtlSeconds: config.INTEGRATIONS_TEST_VCS_CREDENTIAL_TTL_SECONDS,
  });
  const capabilities = getIntegrationProviderCapabilities(provider.adapters);

  return Promise.resolve({
    provider,
    services: [createTestVcsFixtureService(fixture)],
    e2eRoutes: [
      createTestVcsRoutes({
        fixture,
        sourceControl,
        connectionCapabilities: capabilities,
      }),
    ],
  });
}

function createTestVcsRoutes(options: {
  fixture: ReturnType<typeof createTestVcsFixture>;
  sourceControl: TestVcsSourceControlProvider;
  connectionCapabilities: ReturnType<typeof getIntegrationProviderCapabilities>;
}): RouteGroup {
  return {
    prefix: '/integrations/test-vcs',
    routes: [
      defineRoute({
        method: 'POST',
        path: '/connections',
        description: 'Create a private Test VCS connection for E2E tests.',
        schema: {
          body: createConnectionBodySchema,
          response: {201: integrationConnectionDtoSchema},
        },
        handler: async (request, reply) => {
          const connection = await connectTestVcsConnection({
            workspaceId: request.body.workspace_id,
            accountId: request.body.account_id,
            displayName: request.body.display_name ?? `Test VCS ${request.body.account_id}`,
            capabilities: options.connectionCapabilities,
          });
          options.sourceControl.configureConnection(connection.id, {
            renewalMode: request.body.renewal_mode,
            ...(request.body.refresh_after_seconds === undefined
              ? {}
              : {refreshAfterSeconds: request.body.refresh_after_seconds}),
          });
          reply.code(201);
          return toIntegrationConnectionDto(connection, {
            capabilities: options.connectionCapabilities,
          });
        },
      }),
      defineRoute({
        method: 'POST',
        path: '/repositories',
        description: 'Create a real bare repository in the private Test VCS fixture.',
        schema: {
          body: createRepositoryBodySchema,
          response: {201: repositoryDtoSchema},
        },
        handler: async (request, reply) => {
          const connection = await requireTestVcsConnection(request.body.connection_id);
          const repository = await options.sourceControl.createRepository({
            connection,
            name: request.body.name,
            defaultBranch: request.body.default_branch,
            files: request.body.files,
          });
          reply.code(201);
          return toRepositoryDto(connection.id, repository);
        },
      }),
      defineRoute({
        method: 'POST',
        path: '/commits',
        description: 'Commit files to a private Test VCS fixture repository for E2E tests.',
        schema: {
          body: commitFilesBodySchema,
          response: {200: z.object({commit: z.string().min(1)}).strict()},
        },
        handler: async (request) => {
          const connection = await requireTestVcsConnection(request.body.connection_id);
          const commit = await options.sourceControl.commitFiles({
            connection,
            externalRepositoryId: request.body.external_repository_id,
            message: request.body.message,
            files: request.body.files,
          });
          return {commit};
        },
      }),
      defineRoute({
        method: 'GET',
        path: '/stats',
        description: 'Read redacted Test VCS fixture observations for E2E assertions.',
        schema: {
          querystring: statsQuerySchema,
          response: {200: testVcsStatsDtoSchema},
        },
        handler: async (request) => {
          const owner =
            request.query.connection_id === undefined
              ? undefined
              : (await requireTestVcsConnection(request.query.connection_id)).externalAccountId;
          const stats = options.fixture.stats(owner);
          return {
            mint_count: stats.mintCount,
            request_count: stats.requestCount,
            accepted_request_count: stats.acceptedRequestCount,
            rejected_request_count: stats.rejectedRequestCount,
            generations: stats.generations,
            invalidations: stats.invalidations,
            requests: stats.requests,
          };
        },
      }),
      defineRoute({
        method: 'POST',
        path: '/fail-next-mints',
        description: 'Make the next Test VCS credential mints fail for E2E failure assertions.',
        schema: {
          body: failMintsBodySchema,
          response: {204: z.void()},
        },
        handler: (request, reply) => {
          options.sourceControl.failNextCredentialMints(request.body.count);
          reply.code(204).send();
        },
      }),
    ],
  };
}

async function connectTestVcsConnection(input: {
  workspaceId: string;
  accountId: string;
  displayName: string;
  capabilities: ReturnType<typeof getIntegrationProviderCapabilities>;
}): Promise<TestVcsConnection> {
  return (await retryConnectionSlugCollision(() =>
    db().transaction(async (tx) => {
      const slug = await resolveUniqueConnectionSlug(
        {
          workspaceId: input.workspaceId,
          provider: TEST_VCS_PROVIDER,
          externalAccountId: input.accountId,
          baseSlug: slugifyConnectionSlug(`test_vcs_${input.accountId}`, {fallback: 'test_vcs'}),
        },
        {tx},
      );
      return await upsertIntegrationConnection(
        {
          workspaceId: input.workspaceId,
          provider: TEST_VCS_PROVIDER,
          externalAccountId: input.accountId,
          slug,
          displayName: input.displayName,
          lifecycleStatus: 'active',
          capabilities: input.capabilities,
        },
        {tx},
      );
    }),
  )) as TestVcsConnection;
}

async function requireTestVcsConnection(connectionId: string): Promise<TestVcsConnection> {
  const connection = await getIntegrationConnectionById(connectionId);
  if (!connection || connection.provider !== TEST_VCS_PROVIDER) {
    throw new ClientError('Test VCS connection not found', 'test-vcs-connection-not-found', {
      status: 404,
    });
  }
  return connection as TestVcsConnection;
}

export type {TestVcsFileInput, TestVcsRenewalMode};
