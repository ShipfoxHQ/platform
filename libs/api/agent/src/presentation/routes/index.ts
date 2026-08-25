import type {ManagedModelProvider, WorkspaceProvidersPolicy} from '@shipfox/api-agent-dto';
import {SESSION_TRANSCRIPT_CONTENT_TYPE} from '@shipfox/api-agent-dto';
import {AUTH_LEASED_JOB, AUTH_USER} from '@shipfox/api-auth-context';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {createRawBodyPlugin, type RouteGroup} from '@shipfox/node-fastify';
import {config} from '#config.js';
import type {AgentSecretsClient} from '#core/secrets-client.js';
import type {SessionArtifactStore} from '#core/session-artifacts/store.js';
import type {WorkspaceProviderPolicyOptions} from '#core/workspace-provider-policy.js';
import {createCommitSessionTranscriptRoute} from './commit-session-transcript.js';
import {createCustomModelProviderRoute} from './create-custom-model-provider.js';
import {createDeleteModelProviderConfigRoute} from './delete-model-provider-config.js';
import {createDiscoverCustomModelProviderModelsRoute} from './discover-custom-model-provider-models.js';
import {createDiscoverCustomModelProviderModelsBySlugRoute} from './discover-custom-model-provider-models-by-slug.js';
import {createGetSessionTranscriptRoute} from './get-session-transcript.js';
import {createListModelProviderCatalogRoute} from './list-model-provider-catalog.js';
import {listModelProviderConfigsRoute} from './list-model-provider-configs.js';
import {setDefaultHarnessRoute} from './set-default-harness.js';
import {createSetDefaultModelProviderRoute} from './set-default-model-provider.js';
import {createUpdateCustomModelProviderRoute} from './update-custom-model-provider.js';
import {createUpdateModelProviderDefaultModelRoute} from './update-model-provider-default-model.js';
import {createUpsertModelProviderConfigRoute} from './upsert-model-provider-config.js';

// The raw-body parser limit is a memory guard, not the cap check: the artifact
// store compares the blob against AGENT_SESSION_BLOB_CAP_BYTES precisely, and
// a blob over the parser limit (cap + a margin) is surfaced by the route error
// mapper under the same `blob-cap-exceeded` contract, so a runner keying on
// that code sees one shape for every over-cap payload.
const SESSION_TRANSCRIPT_BODY_LIMIT_MARGIN_BYTES = 1024 * 1024;

export function createAgentRoutes(
  secrets: AgentSecretsClient,
  options: {
    managedProvider?: ManagedModelProvider | undefined;
    workspaceProviders?: WorkspaceProvidersPolicy | undefined;
    /**
     * Workflows client used by the lease-authed session transcript routes to
     * resolve the step context. Optional like the module's workflows seam: a
     * consumer that composes the agent module without workflows has no
     * dispatcher creating session claims, so the dormant routes are omitted.
     */
    workflows?: WorkflowsModuleClient | undefined;
    /** Encrypted session artifact store backing the transcript routes. */
    sessionArtifactStore?: SessionArtifactStore | undefined;
  } = {},
): RouteGroup[] {
  const workspaceProviderPolicy: WorkspaceProviderPolicyOptions = {
    workspaceProviders: options.workspaceProviders ?? 'enabled',
    managedProviderId: options.managedProvider?.id,
  };

  // Keep the raw transcript parser in its own Fastify scope so the
  // octet-stream body does not disturb the JSON route groups. Both routes are
  // dormant without a workflows client (no dispatcher creates claims or
  // records descriptors), mirroring the module's workflows-gated subscribers.
  const sessionRoutes: RouteGroup[] =
    options.workflows === undefined || options.sessionArtifactStore === undefined
      ? []
      : [
          {
            prefix: '/runs/jobs/current',
            auth: AUTH_LEASED_JOB,
            plugins: [
              createRawBodyPlugin({
                contentType: SESSION_TRANSCRIPT_CONTENT_TYPE,
                bodyLimit:
                  config.AGENT_SESSION_BLOB_CAP_BYTES + SESSION_TRANSCRIPT_BODY_LIMIT_MARGIN_BYTES,
              }),
            ],
            routes: [
              createGetSessionTranscriptRoute({
                workflows: options.workflows,
                store: options.sessionArtifactStore,
              }),
              createCommitSessionTranscriptRoute({
                workflows: options.workflows,
                store: options.sessionArtifactStore,
              }),
            ],
          },
        ];

  return [
    {
      prefix: '/workspaces/:workspaceId/agent',
      auth: AUTH_USER,
      routes: [
        listModelProviderConfigsRoute,
        createCustomModelProviderRoute(secrets, workspaceProviderPolicy),
        createDiscoverCustomModelProviderModelsRoute(workspaceProviderPolicy),
        createDiscoverCustomModelProviderModelsBySlugRoute(secrets, workspaceProviderPolicy),
        createUpdateCustomModelProviderRoute(secrets, workspaceProviderPolicy),
        createUpsertModelProviderConfigRoute(secrets, workspaceProviderPolicy),
        createUpdateModelProviderDefaultModelRoute(workspaceProviderPolicy),
        createDeleteModelProviderConfigRoute(secrets, workspaceProviderPolicy),
        setDefaultHarnessRoute,
        createSetDefaultModelProviderRoute(workspaceProviderPolicy),
      ],
    },
    {
      prefix: '/agent',
      auth: AUTH_USER,
      routes: [
        createListModelProviderCatalogRoute({
          managedProvider: options.managedProvider,
          workspaceProviders: options.workspaceProviders,
        }),
      ],
    },
    ...sessionRoutes,
  ];
}

export const agentRoutes = createAgentRoutes(undefined as unknown as AgentSecretsClient);
