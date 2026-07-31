import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';

const id = z.string().uuid();
const provider = z.string().min(1);
const capability = z.enum(['source_control', 'agent_tools']);
const repository = z.object({
  externalRepositoryId: z.string(),
  owner: z.string(),
  name: z.string(),
  fullName: z.string(),
  defaultBranch: z.string(),
  visibility: z.enum(['public', 'private', 'internal', 'unknown']),
  cloneUrl: z.string(),
  htmlUrl: z.string(),
});
const triggerReference = z.object({
  externalRepositoryId: z.string(),
  ref: z.string(),
  commit: z.string(),
});
const sourceInput = z.object({workspaceId: id, connectionId: id, externalRepositoryId: z.string()});
const providerError = z.object({
  reason: z.string(),
  retryAfterSeconds: z.number().int().positive().optional(),
});
const sourceErrors = {
  'connection-not-found': z.object({connectionId: id}),
  'connection-inactive': z.object({connectionId: id}),
  'connection-workspace-mismatch': z.object({connectionId: id}),
  'provider-unavailable': z.object({provider}),
  'capability-unavailable': z.object({provider, capability}),
  'checkout-unsupported': z.object({provider}),
  'provider-failure': providerError,
};

/** Producer-owned synchronous operations for the Integrations bounded context. */
export const integrationsInterModuleContract = defineInterModuleContract({
  module: 'integrations',
  methods: {
    resolveSourceRepository: {
      input: sourceInput,
      output: z.object({connection: z.object({id, provider, slug: z.string()}), repository}),
      errors: sourceErrors,
    },
    resolveTriggerReference: {
      input: z.object({workspaceId: id, connectionId: id, payload: z.unknown()}),
      output: triggerReference.nullable(),
      errors: sourceErrors,
    },
    listSourceFiles: {
      input: sourceInput.extend({
        ref: z.string(),
        prefix: z.string(),
        limit: z.number().int().positive(),
        cursor: z.string().optional(),
      }),
      output: z.object({
        files: z.array(
          z.object({path: z.string(), type: z.literal('file'), size: z.number().int().nullable()}),
        ),
        nextCursor: z.string().nullable(),
      }),
      errors: sourceErrors,
    },
    fetchSourceFile: {
      input: sourceInput.extend({ref: z.string(), path: z.string()}),
      output: z.object({path: z.string(), ref: z.string(), content: z.string()}),
      errors: sourceErrors,
    },
    createCheckoutSpec: {
      input: sourceInput.extend({
        ref: z.string().optional(),
        permissions: z.object({contents: z.enum(['read', 'write'])}).optional(),
      }),
      output: z.object({
        repositoryUrl: z.string(),
        ref: z.string(),
        credentials: z
          .object({username: z.string(), token: z.string(), expiresAt: z.string().datetime()})
          .optional(),
        gitAuthor: z.object({name: z.string(), email: z.string()}).optional(),
      }),
      errors: sourceErrors,
    },
    getAgentToolsContext: {
      input: z.object({workspaceId: id, defaultConnectionId: id}),
      output: z.object({
        selectionCatalogs: z.array(
          z.object({
            provider,
            selectors: z.array(
              z.object({
                token: z.string(),
                kind: z.enum(['family', 'family_wildcard', 'method', 'standalone']),
                sensitivity: z.enum(['read', 'write']),
                sensitive: z.boolean(),
              }),
            ),
          }),
        ),
        catalogs: z.array(
          z.object({
            provider,
            tools: z.array(
              z.object({
                id: z.string(),
                description: z.string(),
                sensitivity: z.enum(['read', 'write']),
                sensitive: z.boolean(),
                requiredScope: z.unknown(),
                inputSchema: z.record(z.string(), z.unknown()),
                outputSchema: z.record(z.string(), z.unknown()).optional(),
                methods: z
                  .array(
                    z.object({
                      id: z.string(),
                      description: z.string(),
                      sensitivity: z.enum(['read', 'write']),
                      sensitive: z.boolean(),
                      requiredScope: z.unknown(),
                    }),
                  )
                  .optional(),
              }),
            ),
          }),
        ),
        workspaceConnections: z.array(
          z.object({slug: z.string(), id, provider, capabilities: z.array(capability)}),
        ),
        defaultConnection: z.object({id, slug: z.string(), provider}).nullable(),
      }),
      errors: sourceErrors,
    },
  },
});

export type IntegrationsModuleClient = InterModuleClient<typeof integrationsInterModuleContract>;
