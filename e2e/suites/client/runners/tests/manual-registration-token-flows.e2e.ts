import {
  mintManualRegistrationToken,
  mintProvisionerToken,
} from '@shipfox/e2e-driver-runner-process';
import {stableScreenshot} from '@shipfox/e2e-kit/ui';
import {createShipfoxTokenPrefixRegexes} from '@shipfox/regex';
import {expect, test} from './test.js';

const MANUAL_REGISTRATION_TOKEN_PREFIX_RE = createShipfoxTokenPrefixRegexes(['mrt']).unqualified;
const PROVISIONER_TOKEN_PREFIX_RE = createShipfoxTokenPrefixRegexes(['pt']).unqualified;
const VISUAL_TEST_NOW = new Date('2026-01-15T12:00:00Z');
const VISUAL_TEST_MANUAL_TOKEN_PREFIX = 'sf_mrt_visual';
const VISUAL_TEST_MANUAL_TOKEN = 'sf_mrt_visual_regression_token';
const VISUAL_TEST_PROVISIONER_TOKEN_PREFIX = 'sf_pt_visual';
const VISUAL_TEST_PROVISIONER_TOKEN = 'sf_pt_visual_regression_token';
const VISUAL_TEST_CREATED_AT = 'Jan 15, 2026, 12:00 PM';
const VISUAL_TEST_EXPIRES_AT = 'Jan 16, 2026, 12:00 PM';

test('creates a manual runner registration token from settings', async ({
  page,
  runnerTokens,
  createReadyWorkspace,
}) => {
  test.setTimeout(60_000);

  await page.clock.setFixedTime(VISUAL_TEST_NOW);
  const {workspaceSlug} = await createReadyWorkspace({
    name: 'Manual Token Create Workspace',
  });

  await runnerTokens.gotoManualTokens(workspaceSlug);
  await expect(runnerTokens.manualEmptyState()).toBeVisible();
  await stableScreenshot(page, 'runners/settings-runners-empty');

  const createTokenDialog = await runnerTokens.openManualCreateDialog();
  await expect(createTokenDialog.field('Token name')).toBeVisible();
  await expect(createTokenDialog.confirmButton('Create token')).toBeVisible();
  await stableScreenshot(page, 'runners/settings-runners-create-token-form');

  await runnerTokens.createTokenFromDialog(createTokenDialog, 'E2E manual runner');

  await expect(createTokenDialog.locator().getByText('Token created')).toBeVisible();
  const rawToken = runnerTokens.rawToken(createTokenDialog, MANUAL_REGISTRATION_TOKEN_PREFIX_RE);
  await expect(rawToken).toBeVisible();

  const row = runnerTokens.manualTokenRow('E2E manual runner');
  await expect(row).toBeVisible();
  await stableScreenshot(page, 'runners/settings-runners-create-token-success', [
    {locator: rawToken, text: VISUAL_TEST_MANUAL_TOKEN},
    {
      locator: runnerTokens.manualTokenCell('E2E manual runner', 1),
      text: VISUAL_TEST_MANUAL_TOKEN_PREFIX,
    },
    {locator: runnerTokens.manualTokenCell('E2E manual runner', 2), text: VISUAL_TEST_EXPIRES_AT},
    {locator: runnerTokens.manualTokenCell('E2E manual runner', 3), text: VISUAL_TEST_CREATED_AT},
  ]);
});

test('revokes a manual runner registration token from settings', async ({
  page,
  runnerTokens,
  createReadyWorkspace,
}) => {
  const {
    sessionToken: userToken,
    workspaceId,
    workspaceSlug,
  } = await createReadyWorkspace({
    name: 'Manual Token Revoke Workspace',
  });
  await mintManualRegistrationToken({
    workspaceId,
    userToken,
    name: 'E2E manual revoke runner',
    ttlSeconds: 3600,
  });

  await runnerTokens.gotoManualTokens(workspaceSlug);
  const row = runnerTokens.manualTokenRow('E2E manual revoke runner');
  await expect(row).toBeVisible();

  const revokeDialog = await runnerTokens.openManualRevokeDialog('E2E manual revoke runner');
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes('/runners/manual-registration-tokens/') &&
        response.url().endsWith('/revoke') &&
        response.status() === 200,
    ),
    revokeDialog.locator().getByRole('button', {name: 'Revoke', exact: true}).click(),
  ]);
  await revokeDialog.expectClosed();

  await expect(row).toHaveCount(0);
  await expect(runnerTokens.manualEmptyState()).toBeVisible();
});

test('creates a provisioner registration token from settings', async ({
  page,
  runnerTokens,
  createReadyWorkspace,
}) => {
  test.setTimeout(60_000);

  await page.clock.setFixedTime(VISUAL_TEST_NOW);
  const {workspaceSlug} = await createReadyWorkspace({
    name: 'Provisioner Token Create Workspace',
  });

  await runnerTokens.gotoProvisionerTokens(workspaceSlug);
  await expect(runnerTokens.provisionerEmptyState()).toBeVisible();
  await stableScreenshot(page, 'runners/settings-provisioners-empty');

  const createTokenDialog = await runnerTokens.openProvisionerCreateDialog();
  await expect(createTokenDialog.field('Token name')).toBeVisible();
  await expect(createTokenDialog.confirmButton('Create token')).toBeVisible();
  await stableScreenshot(page, 'runners/settings-provisioners-create-token-form');

  await runnerTokens.createTokenFromDialog(createTokenDialog, 'E2E provisioner');

  await expect(createTokenDialog.locator().getByText('Token created')).toBeVisible();
  const rawToken = runnerTokens.rawToken(createTokenDialog, PROVISIONER_TOKEN_PREFIX_RE);
  await expect(rawToken).toBeVisible();

  const row = runnerTokens.provisionerTokenRow('E2E provisioner');
  await expect(row).toBeVisible();
  await stableScreenshot(page, 'runners/settings-provisioners-create-token-success', [
    {locator: rawToken, text: VISUAL_TEST_PROVISIONER_TOKEN},
    {
      locator: runnerTokens.provisionerTokenCell('E2E provisioner', 1),
      text: VISUAL_TEST_PROVISIONER_TOKEN_PREFIX,
    },
    {
      locator: runnerTokens.provisionerTokenCell('E2E provisioner', 3),
      text: VISUAL_TEST_EXPIRES_AT,
    },
    {
      locator: runnerTokens.provisionerTokenCell('E2E provisioner', 4),
      text: VISUAL_TEST_CREATED_AT,
    },
  ]);
});

test('revokes a provisioner registration token from settings', async ({
  page,
  runnerTokens,
  createReadyWorkspace,
}) => {
  const {
    sessionToken: userToken,
    workspaceId,
    workspaceSlug,
  } = await createReadyWorkspace({
    name: 'Provisioner Token Revoke Workspace',
  });
  await mintProvisionerToken({
    workspaceId,
    userToken,
    name: 'E2E revoke provisioner',
    ttlSeconds: 3600,
  });

  await runnerTokens.gotoProvisionerTokens(workspaceSlug);
  const row = runnerTokens.provisionerTokenRow('E2E revoke provisioner');
  await expect(row).toBeVisible();

  const revokeDialog = await runnerTokens.openProvisionerRevokeDialog('E2E revoke provisioner');
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes('/provisioners/tokens/') &&
        response.url().endsWith('/revoke') &&
        response.status() === 200,
    ),
    revokeDialog.locator().getByRole('button', {name: 'Revoke', exact: true}).click(),
  ]);
  await revokeDialog.expectClosed();

  await expect(row).toHaveCount(0);
  await expect(runnerTokens.provisionerEmptyState()).toBeVisible();
});
