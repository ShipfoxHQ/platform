import {createApiClient, preflightCheck} from '@shipfox/e2e-core';
import {createConnectedOrg, deleteOrg} from '@shipfox/e2e-driver-gitea';
import {message, startFakeOpenAiModelProvider, toolCall} from '@shipfox/e2e-driver-model-provider';
import {
  createOpenAiCompatibleCustomProvider,
  deleteModelProviderConfig,
} from '@shipfox/e2e-setup-agent';
import {createSession, createUser} from '@shipfox/e2e-setup-auth';
import {createTestVcsConnection} from '@shipfox/e2e-setup-integrations';
import {createWorkspace} from '@shipfox/e2e-setup-workspaces';
import {resetSuiteRunDir, writeSuiteContext} from '#suite-context.js';

const DETERMINISTIC_AGENT_MODEL = 'deterministic-output-agent';

/**
 * Arranges the whole suite once over HTTP: user, session, workspace, a fresh gitea org
 * connected to the workspace. On any failure it unwinds what it created, since
 * Playwright skips global teardown when setup throws.
 */
export default async function globalSetup(): Promise<void> {
  await preflightCheck({requireClient: false});
  resetSuiteRunDir();
  const runId = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;

  const cleanups: Array<() => Promise<void>> = [];
  try {
    const user = await createUser();
    // The access token snapshots memberships at sign time; workspace-scoped calls need it.
    const workspace = await createWorkspace({userId: user.user.id, userEmail: user.email});
    const session = await createSession({user_id: user.user.id});

    const org = await createConnectedOrg({
      workspaceId: workspace.id,
      sessionToken: session.token,
    });
    cleanups.push(() => deleteOrg({org: org.org}).catch(() => undefined));
    const testVcsAccountId = `test-vcs-${runId}`;
    const testVcsConnection = await createTestVcsConnection({
      workspaceId: workspace.id,
      accountId: testVcsAccountId,
      displayName: 'Test VCS Renewable Credentials E2E',
      renewalMode: 'on-rejection',
    });
    const testVcsClient = createApiClient({token: session.token});
    cleanups.push(() =>
      testVcsClient
        .request('delete', `/integration-connections/${testVcsConnection.id}`)
        .then(() => undefined)
        .catch(() => undefined),
    );

    const fakeModelProvider = await startFakeOpenAiModelProvider({runId});
    cleanups.push(() => fakeModelProvider.stop().catch(() => undefined));
    const modelProviderScript = await fakeModelProvider.createScript({
      id: `${runId}-agent-output-tool`,
      model: DETERMINISTIC_AGENT_MODEL,
      responses: [
        message('ok'),
        toolCall('set_output', {key: 'message', value: 'qwen-tool-output-ok'}),
        message('done'),
      ],
      assertions: [
        {kind: 'model', equals: DETERMINISTIC_AGENT_MODEL},
        {kind: 'tool_present', name: 'set_output', minRequestIndex: 1},
      ],
    });
    const modelProvider = await createOpenAiCompatibleCustomProvider({
      workspaceId: workspace.id,
      sessionToken: session.token,
      providerId: `det-output-tool-${runId}`,
      displayName: 'Deterministic Output Tool E2E',
      baseUrl: modelProviderScript.modelProviderBaseUrl,
      model: modelProviderScript.model,
      modelMetadata: {max_output_tokens: 512},
    });
    cleanups.push(() =>
      deleteModelProviderConfig({
        workspaceId: workspace.id,
        sessionToken: session.token,
        providerId: modelProvider.provider_id,
      }).catch(() => undefined),
    );

    const defaultProviderScript = await fakeModelProvider.createScript({
      id: `${runId}-default-agent`,
      model: DETERMINISTIC_AGENT_MODEL,
      responses: [message('ok')],
      assertions: [{kind: 'model', equals: DETERMINISTIC_AGENT_MODEL}],
    });
    const defaultProvider = await createOpenAiCompatibleCustomProvider({
      workspaceId: workspace.id,
      sessionToken: session.token,
      providerId: `det-default-${runId}`,
      displayName: 'Deterministic Default Agent E2E',
      baseUrl: defaultProviderScript.modelProviderBaseUrl,
      model: defaultProviderScript.model,
      modelMetadata: {max_output_tokens: 512},
    });
    cleanups.push(() =>
      deleteModelProviderConfig({
        workspaceId: workspace.id,
        sessionToken: session.token,
        providerId: defaultProvider.provider_id,
      }).catch(() => undefined),
    );
    await setDefaultModelProvider({
      workspaceId: workspace.id,
      sessionToken: session.token,
      providerId: defaultProvider.provider_id,
    });

    writeSuiteContext({
      runId,
      workspaceId: workspace.id,
      sessionToken: session.token,
      org: org.org,
      connectionId: org.connection.id,
      connectionSlug: org.connection.slug,
      testVcsConnectionId: testVcsConnection.id,
      testVcsAccountId,
      testVcsConnectionSlug: testVcsConnection.slug,
      modelProviderId: modelProvider.provider_id,
      agentModel: modelProviderScript.model,
      fakeModelProviderRunId: runId,
      fakeModelProviderScripts: {'agent-output-tool': modelProviderScript.id},
    });
  } catch (error) {
    for (const cleanup of cleanups.reverse()) {
      await cleanup().catch(() => undefined);
    }
    throw error;
  }
}

async function setDefaultModelProvider(params: {
  workspaceId: string;
  sessionToken: string;
  providerId: string;
}): Promise<void> {
  const client = createApiClient({token: params.sessionToken});
  await client.requestJson(
    'put',
    `/workspaces/${params.workspaceId}/agent/default-model-provider`,
    {json: {provider_id: params.providerId}},
  );
}
