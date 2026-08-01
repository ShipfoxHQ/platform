import {expect, test} from './test.js';

const SECRET_CREATE_KEY = 'E2E_SECRET_CREATE';
const SECRET_EDIT_KEY = 'E2E_SECRET_EDIT';
const SECRET_DELETE_KEY = 'E2E_SECRET_DELETE';

test.describe('secrets settings', () => {
  test('creates a workspace secret from settings', async ({
    secretsScreen,
    createReadyWorkspace,
  }) => {
    const {workspaceSlug} = await createReadyWorkspace({
      name: 'Secrets Create Workspace',
    });
    const value = 'secret-create-value-e2e';

    await secretsScreen.goto(workspaceSlug);
    await expect(secretsScreen.emptyState()).toBeVisible();
    await secretsScreen.createSecret(SECRET_CREATE_KEY, value);

    await expect(secretsScreen.valueHidden(SECRET_CREATE_KEY)).toBeVisible();
    await expect(secretsScreen.section()).not.toContainText(value);
  });

  test('edits a workspace secret from settings', async ({
    secrets,
    secretsScreen,
    createReadyWorkspace,
  }) => {
    const {userId, workspaceId, workspaceSlug} = await createReadyWorkspace({
      name: 'Secrets Edit Workspace',
    });
    const oldValue = 'secret-edit-old-value-e2e';
    const newValue = 'secret-edit-new-value-e2e';
    await secrets.createSecret({
      workspaceId,
      actorId: userId,
      key: SECRET_EDIT_KEY,
      value: oldValue,
    });

    await secretsScreen.goto(workspaceSlug);
    const dialog = await secretsScreen.openUpdateDialog(SECRET_EDIT_KEY);
    await expect(dialog.field('Name')).toBeDisabled();
    await expect(dialog.field('Name')).toHaveValue(SECRET_EDIT_KEY);

    await dialog.locator().getByRole('textbox', {name: 'Value'}).fill(newValue);
    await dialog.confirm('Update secret');

    await expect(secretsScreen.toastMessage('Secret updated')).toBeVisible();
    await expect(secretsScreen.rowByKey(SECRET_EDIT_KEY)).toBeVisible();
    await expect(secretsScreen.section()).not.toContainText(oldValue);
    await expect(secretsScreen.section()).not.toContainText(newValue);
  });

  test('deletes a workspace secret from settings', async ({
    secrets,
    secretsScreen,
    createReadyWorkspace,
  }) => {
    const {userId, workspaceId, workspaceSlug} = await createReadyWorkspace({
      name: 'Secrets Delete Workspace',
    });
    await secrets.createSecret({
      workspaceId,
      actorId: userId,
      key: SECRET_DELETE_KEY,
      value: 'secret-delete-value-e2e',
    });

    await secretsScreen.goto(workspaceSlug);
    const row = secretsScreen.rowByKey(SECRET_DELETE_KEY);
    await secretsScreen.deleteSecret(SECRET_DELETE_KEY);

    await expect(row).toHaveCount(0);
    await expect(secretsScreen.emptyState()).toBeVisible();
  });
});
