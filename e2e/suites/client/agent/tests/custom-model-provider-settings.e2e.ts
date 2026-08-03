import {
  type FakeOpenAiModelProviderHandle,
  type FakeOpenAiScriptHandle,
  message,
  startFakeOpenAiModelProvider,
} from '@shipfox/e2e-driver-model-provider';
import type {AgentHelper} from '@shipfox/e2e-setup-agent';
import {expect, test} from './test.js';

const FAKE_MODEL_ID = 'deterministic-settings-agent';
const CREATE_PROVIDER_ID = 'fake-openai-create';
const CREATE_PROVIDER_NAME = 'Fake OpenAI Create';
const EDIT_PROVIDER_ID = 'fake-openai-edit';
const EDIT_PROVIDER_NAME = 'Fake OpenAI Edit';
const EDITED_PROVIDER_NAME = 'Fake OpenAI Edited';
const DELETE_PROVIDER_ID = 'fake-openai-delete';
const DELETE_PROVIDER_NAME = 'Fake OpenAI Delete';
const PROVIDER_SAVE_TIMEOUT_MS = 75_000;

let fakeModelProvider: FakeOpenAiModelProviderHandle | undefined;

test.beforeAll(async () => {
  fakeModelProvider = await startFakeOpenAiModelProvider({
    runId: `client-agent-custom-model-provider-settings-${process.pid}-${crypto.randomUUID()}`,
  });
});

test.afterAll(async () => {
  await fakeModelProvider?.stop();
});

async function expectProviderInApi(params: {
  agent: AgentHelper;
  displayName: string;
  providerId: string;
  sessionToken: string;
  workspaceId: string;
}) {
  const configs = await params.agent.listModelProviderConfigs({
    workspaceId: params.workspaceId,
    sessionToken: params.sessionToken,
  });
  expect(configs.configs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        provider_id: params.providerId,
        display_name: params.displayName,
      }),
    ]),
  );
}

test('creates a custom model provider backed by a fake OpenAI-compatible provider', async ({
  page,
  agent,
  customModelProviders,
  createReadyWorkspace,
}) => {
  const {workspaceId, workspaceSlug, sessionToken} = await createReadyWorkspace({
    name: 'Model Provider Create Workspace',
  });
  const script = await createFakeProviderScript('create', 1);

  await customModelProviders.goto(workspaceSlug);
  const dialog = await customModelProviders.openCreateDialog();

  await customModelProviders.fillProviderIdentity(dialog, {
    displayName: CREATE_PROVIDER_NAME,
    providerId: CREATE_PROVIDER_ID,
    baseUrl: script.modelProviderBaseUrl,
  });
  const discoveryResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/agent/custom-model-providers/discover-models') &&
      response.request().method() === 'POST',
  );
  await customModelProviders.fetchModels(dialog);
  expect((await discoveryResponse).ok()).toBe(true);

  const defaultModelField = customModelProviders.defaultModelField(dialog);
  const discoveredModelOption = customModelProviders.discoveredModelOption(dialog, FAKE_MODEL_ID);
  if ((await discoveredModelOption.count()) === 0) {
    await customModelProviders.firstModelIdField(dialog).fill(FAKE_MODEL_ID);
    await customModelProviders.firstModelLabelField(dialog).fill(FAKE_MODEL_ID);
  }
  await expect(defaultModelField).toContainText(FAKE_MODEL_ID);

  await defaultModelField.selectOption(FAKE_MODEL_ID);
  const saveResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/agent/custom-model-providers') &&
      response.request().method() === 'POST' &&
      !response.url().includes('/discover-models'),
    {timeout: PROVIDER_SAVE_TIMEOUT_MS},
  );
  await customModelProviders.save(dialog);
  expect((await saveResponse).ok()).toBe(true);

  await customModelProviders.expectSavedToast('Custom provider saved');
  await expect(customModelProviders.configuredProviderRow(CREATE_PROVIDER_NAME)).toBeVisible();
  await expectProviderInApi({
    agent,
    workspaceId,
    sessionToken,
    providerId: CREATE_PROVIDER_ID,
    displayName: CREATE_PROVIDER_NAME,
  });
});

test('edits an existing custom model provider and validates the provider endpoint', async ({
  page,
  agent,
  customModelProviders,
  createReadyWorkspace,
}) => {
  const {workspaceId, workspaceSlug, sessionToken} = await createReadyWorkspace({
    name: 'Model Provider Edit Workspace',
  });
  const script = await createFakeProviderScript('edit', 2);
  await agent.createOpenAiCompatibleCustomProvider({
    baseUrl: script.modelProviderBaseUrl,
    model: FAKE_MODEL_ID,
    workspaceId,
    sessionToken,
    providerId: EDIT_PROVIDER_ID,
    displayName: EDIT_PROVIDER_NAME,
  });

  await customModelProviders.goto(workspaceSlug);
  const row = customModelProviders.configuredProviderRow(EDIT_PROVIDER_NAME);
  await expect(row).toBeVisible();
  const dialog = await customModelProviders.openEditDialog(EDIT_PROVIDER_NAME);
  await expect(dialog.field('Provider ID')).toBeDisabled();

  await dialog.field('Display name').fill(EDITED_PROVIDER_NAME);
  const saveResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/agent/custom-model-providers/${EDIT_PROVIDER_ID}`) &&
      response.request().method() === 'PUT',
    {timeout: PROVIDER_SAVE_TIMEOUT_MS},
  );
  await customModelProviders.save(dialog);
  expect((await saveResponse).ok()).toBe(true);

  await customModelProviders.expectSavedToast(`${EDIT_PROVIDER_NAME} saved`);
  await expect(customModelProviders.configuredProviderRow(EDITED_PROVIDER_NAME)).toBeVisible();
  await expect(customModelProviders.configuredProviderRow(EDIT_PROVIDER_NAME)).toHaveCount(0);
  await expectProviderInApi({
    agent,
    workspaceId,
    sessionToken,
    providerId: EDIT_PROVIDER_ID,
    displayName: EDITED_PROVIDER_NAME,
  });
});

test('deletes an existing custom model provider', async ({
  agent,
  customModelProviders,
  createReadyWorkspace,
}) => {
  const {workspaceId, workspaceSlug, sessionToken} = await createReadyWorkspace({
    name: 'Model Provider Delete Workspace',
  });
  const script = await createFakeProviderScript('delete', 1);
  await agent.createOpenAiCompatibleCustomProvider({
    baseUrl: script.modelProviderBaseUrl,
    model: FAKE_MODEL_ID,
    workspaceId,
    sessionToken,
    providerId: DELETE_PROVIDER_ID,
    displayName: DELETE_PROVIDER_NAME,
  });

  await customModelProviders.goto(workspaceSlug);
  const row = customModelProviders.configuredProviderRow(DELETE_PROVIDER_NAME);
  await expect(row).toBeVisible();
  const dialog = await customModelProviders.openDeleteDialog(DELETE_PROVIDER_NAME);
  await dialog.confirm('Delete');

  await customModelProviders.expectSavedToast(`${DELETE_PROVIDER_NAME} deleted`);
  await expect(row).toHaveCount(0);
  const configs = await agent.listModelProviderConfigs({workspaceId, sessionToken});
  expect(configs.configs.map((config) => config.provider_id)).not.toContain(DELETE_PROVIDER_ID);
});

async function createFakeProviderScript(
  suffix: string,
  validationResponses: number,
): Promise<FakeOpenAiScriptHandle> {
  if (!fakeModelProvider) throw new Error('Fake OpenAI model provider did not start.');

  return await fakeModelProvider.createScript({
    id: `${suffix}-${crypto.randomUUID()}`,
    model: FAKE_MODEL_ID,
    responses: Array.from({length: validationResponses}, () => message('OK')),
  });
}
