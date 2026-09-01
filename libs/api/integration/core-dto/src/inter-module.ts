import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {isSafeRefInput} from '@shipfox/regex';
import {z} from 'zod';

const id = z.string().uuid();
const provider = z.string().min(1);
const capability = z.enum(['source_control', 'agent_tools']);
const safeRef = z.string().refine(isSafeRefInput, 'Ref contains a control character');
const connection = z.object({id, provider, slug: z.string().min(1)});
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
  actor: z.string().nullable(),
});
const sourceInput = z.object({workspaceId: id, connectionId: id, externalRepositoryId: z.string()});
// Checkout metadata must come from the provider response. Reject unknown fields
// such as caller-supplied clone URLs instead of silently stripping them.
const checkoutTargetValue = z.string().trim().min(1);
const checkoutTarget = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('external-id'), externalRepositoryId: checkoutTargetValue}).strict(),
  z
    .object({kind: z.literal('name'), owner: checkoutTargetValue, name: checkoutTargetValue})
    .strict(),
]);
const checkoutInput = z
  .object({
    workspaceId: id,
    connectionId: id,
    projectId: id.optional(),
    target: checkoutTarget.optional(),
    externalRepositoryId: z.string().min(1).optional(),
  })
  .strict();
const checkoutCredentialRenewal = z.discriminatedUnion('mode', [
  z.object({mode: z.literal('refresh-at'), refreshAt: z.string().datetime()}),
  z.object({mode: z.literal('on-rejection')}),
]);
const checkoutCredentials = z
  .object({
    username: z.string().min(1),
    token: z.string().min(1),
    expiresAt: z.string().datetime(),
    generation: z.string().min(1).optional(),
    renewal: checkoutCredentialRenewal.optional(),
  })
  .superRefine(({expiresAt, renewal}, ctx) => {
    if (renewal?.mode !== 'refresh-at') return;

    const refreshAt = Date.parse(renewal.refreshAt);
    if (refreshAt <= Date.now() || refreshAt >= Date.parse(expiresAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['renewal', 'refreshAt'],
        message: 'refreshAt must be in the future and earlier than expiresAt',
      });
    }
  });
const toolCallTool = z.object({
  id: z.string().min(1),
  provider,
  method: z.string().min(1).optional(),
  sensitivity: z.enum(['read', 'write']),
  sensitive: z.boolean(),
  requiredScope: z.array(z.unknown()),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  methods: z
    .array(
      z.object({
        id: z.string().min(1),
        token: z.string().min(1),
        description: z.string().min(1).optional(),
        sensitivity: z.enum(['read', 'write']),
        sensitive: z.boolean(),
        requiredScope: z.array(z.unknown()),
      }),
    )
    .min(1)
    .optional(),
});
const toolCallCaller = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('agent')}),
  z.object({
    kind: z.literal('tool_step'),
    runId: z.string().min(1),
    jobExecutionId: z.string().min(1),
    stepId: z.string().min(1),
    stepAttempt: z.number().int().nonnegative(),
    callIndex: z.number().int().nonnegative(),
  }),
]);
const toolCallOutcome = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('success'),
    result: z.record(z.string(), z.unknown()).nullable(),
    content: z.array(z.record(z.string(), z.unknown())),
  }),
  z.object({
    outcome: z.literal('error'),
    code: z.string().min(1),
    message: z.string(),
    retryAfterSeconds: z.number().int().positive().optional(),
    status: z.number().int().min(100).max(599).optional(),
  }),
]);
export const repositoryAuthorizationErrorCodes = {
  notGranted: 'repository-not-granted',
  ambiguous: 'repository-ambiguous',
  storeUnavailable: 'repository-authorization-unavailable',
} as const;
const repositoryAuthorizationErrors = {
  [repositoryAuthorizationErrorCodes.notGranted]: z.object({}),
  [repositoryAuthorizationErrorCodes.ambiguous]: z.object({}),
  [repositoryAuthorizationErrorCodes.storeUnavailable]: z.object({}),
};
const toolCallErrors = {
  'connection-not-found': z.object({connectionId: id}),
  'connection-inactive': z.object({connectionId: id}),
  'connection-workspace-mismatch': z.object({connectionId: id}),
  'connection-provider-changed': z.object({connectionId: id}),
  'provider-unavailable': z.object({provider}),
  'capability-unavailable': z.object({provider, capability}),
  ...repositoryAuthorizationErrors,
};
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
const checkoutErrors = {
  ...sourceErrors,
  ...repositoryAuthorizationErrors,
};

const refErrors = {
  ...sourceErrors,
  'ref-not-found': z.object({ref: safeRef}),
  'ref-invalid': z.object({ref: safeRef}),
};

/** Producer-owned synchronous operations for the Integrations bounded context. */
export const integrationsInterModuleContract = defineInterModuleContract({
  module: 'integrations',
  methods: {
    resolveSourceRepository: {
      input: sourceInput,
      output: z.object({connection, repository}),
      errors: sourceErrors,
    },
    resolveConnection: {
      input: z.object({workspaceId: id, slug: z.string().min(1)}),
      output: connection.nullable(),
    },
    resolveTriggerReference: {
      input: z.object({workspaceId: id, connectionId: id, payload: z.unknown()}),
      output: triggerReference.nullable(),
      errors: sourceErrors,
    },
    resolveSourceRef: {
      input: sourceInput.extend({ref: safeRef}),
      output: z.object({ref: z.string(), commit: z.string()}),
      errors: refErrors,
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
      input: checkoutInput
        .extend({
          ref: z.string().optional(),
          permissions: z.object({contents: z.enum(['read', 'write'])}).optional(),
        })
        .superRefine(requireCheckoutTarget),
      output: z.object({
        repositoryUrl: z.string(),
        ref: z.string(),
        credentials: checkoutCredentials.optional(),
        gitAuthor: z.object({name: z.string(), email: z.string()}).optional(),
      }),
      errors: checkoutErrors,
    },
    createCheckoutCredentials: {
      input: checkoutInput
        .extend({
          permissions: z.object({contents: z.enum(['read', 'write'])}),
          rejectedGeneration: z.string().optional(),
        })
        .superRefine(requireCheckoutTarget),
      output: checkoutCredentials,
      errors: checkoutErrors,
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
                indirectTargetNote: z.string().min(1).optional(),
                methods: z
                  .array(
                    z.object({
                      id: z.string(),
                      description: z.string(),
                      sensitivity: z.enum(['read', 'write']),
                      sensitive: z.boolean(),
                      requiredScope: z.unknown(),
                      indirectTargetNote: z.string().min(1).optional(),
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
        eventCatalogs: z.array(z.object({provider, events: z.array(z.string())})),
        fixedEventProviders: z.array(provider),
        defaultConnection: z.object({id, slug: z.string(), provider}).nullable(),
      }),
      errors: sourceErrors,
    },
    callTool: {
      input: z.object({
        workspaceId: id,
        connectionId: id,
        tool: toolCallTool,
        arguments: z.record(z.string(), z.unknown()),
        caller: toolCallCaller,
      }),
      output: toolCallOutcome,
      errors: toolCallErrors,
    },
  },
});

function requireCheckoutTarget(
  input: {
    target?: z.infer<typeof checkoutTarget> | undefined;
    externalRepositoryId?: string | undefined;
  },
  context: z.RefinementCtx,
): void {
  // This stays at the JSON boundary so malformed checkout payloads are rejected
  // before they reach the SPI normalizer used by in-memory callers.
  if (input.target === undefined && input.externalRepositoryId === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['target'],
      message: 'Checkout input requires a target or an external repository id',
    });
  }
  if (input.target !== undefined && input.externalRepositoryId !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['target'],
      message: 'Checkout input cannot include both a target and an external repository id',
    });
  }
}

export type IntegrationsModuleClient = InterModuleClient<typeof integrationsInterModuleContract>;
