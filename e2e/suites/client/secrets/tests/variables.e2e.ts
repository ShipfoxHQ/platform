import {expect, test} from './test.js';

const VARIABLE_CREATE_KEY = 'E2E_VARIABLE_CREATE';
const VARIABLE_EDIT_KEY = 'E2E_VARIABLE_EDIT';
const VARIABLE_DELETE_KEY = 'E2E_VARIABLE_DELETE';

test.describe('variables settings', () => {
  test('creates a workspace variable from settings', async ({
    variablesScreen,
    createReadyWorkspace,
  }) => {
    const {workspaceSlug} = await createReadyWorkspace({
      name: 'Variables Create Workspace',
    });
    const value = 'debug';

    await variablesScreen.goto(workspaceSlug);
    await expect(variablesScreen.emptyState()).toBeVisible();
    await variablesScreen.createVariable(VARIABLE_CREATE_KEY, value);

    await expect(
      variablesScreen.rowByKey(VARIABLE_CREATE_KEY).getByText(value, {exact: true}),
    ).toBeVisible();
  });

  test('edits a workspace variable from settings', async ({
    secrets,
    variablesScreen,
    createReadyWorkspace,
  }) => {
    const {userId, workspaceId, workspaceSlug} = await createReadyWorkspace({
      name: 'Variables Edit Workspace',
    });
    const oldValue = 'info';
    const newValue = 'debug';
    await secrets.createVariable({
      workspaceId,
      actorId: userId,
      key: VARIABLE_EDIT_KEY,
      value: oldValue,
    });

    await variablesScreen.goto(workspaceSlug);
    const row = variablesScreen.rowByKey(VARIABLE_EDIT_KEY);
    await expect(row.getByText(oldValue, {exact: true})).toBeVisible();
    const dialog = await variablesScreen.openUpdateDialog(VARIABLE_EDIT_KEY);
    await expect(dialog.field('Name')).toBeDisabled();
    await expect(dialog.field('Name')).toHaveValue(VARIABLE_EDIT_KEY);

    await dialog.locator().getByRole('textbox', {name: 'Value'}).fill(newValue);
    await dialog.confirm('Update variable');

    await expect(variablesScreen.toastMessage('Variable updated')).toBeVisible();
    await expect(row.getByText(newValue, {exact: true})).toBeVisible();
    await expect(row).not.toContainText(oldValue);
  });

  test('deletes a workspace variable from settings', async ({
    secrets,
    variablesScreen,
    createReadyWorkspace,
  }) => {
    const {userId, workspaceId, workspaceSlug} = await createReadyWorkspace({
      name: 'Variables Delete Workspace',
    });
    await secrets.createVariable({
      workspaceId,
      actorId: userId,
      key: VARIABLE_DELETE_KEY,
      value: 'trace',
    });

    await variablesScreen.goto(workspaceSlug);
    const row = variablesScreen.rowByKey(VARIABLE_DELETE_KEY);
    await variablesScreen.deleteVariable(VARIABLE_DELETE_KEY);

    await expect(row).toHaveCount(0);
    await expect(variablesScreen.emptyState()).toBeVisible();
  });
});
