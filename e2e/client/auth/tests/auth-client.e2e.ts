import {randomUUID} from 'node:crypto';
import {expect, test} from './test.js';

const LOGIN_URL_RE = /\/auth\/login$/u;

test('redirects guests from the app root to login', async ({page}) => {
  await page.goto('/');

  await expect(page).toHaveURL(LOGIN_URL_RE);
  await expect(page.getByRole('heading', {name: 'Connect to Shipfox'})).toBeVisible();
});

test('logs in through the UI with an E2E-created verified user', async ({page, auth}) => {
  const user = await auth.createUser();

  await page.goto('/auth/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', {name: 'Log in'}).click();

  await expect(page.getByRole('heading', {name: 'Create your workspace'})).toBeVisible();
});

test('hydrates an E2E browser session from the refresh cookie after reload', async ({
  page,
  auth,
}) => {
  const user = await auth.createUser();
  await auth.loginAs(page, user);

  await page.goto('/');
  await expect(page.getByRole('heading', {name: 'Create your workspace'})).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', {name: 'Create your workspace'})).toBeVisible();
});

test('creates a workspace through the real onboarding UI', async ({page, auth}) => {
  const user = await auth.createUser();
  await auth.loginAs(page, user);
  const workspaceName = `E2E Workspace ${randomUUID()}`;

  await page.goto('/');
  await page.getByLabel('Workspace name').fill(workspaceName);
  await page.getByRole('button', {name: 'Create workspace'}).click();

  await expect(page.getByRole('heading', {name: 'Projects'})).toBeVisible();
  await expect(page.getByText(workspaceName)).toBeVisible();
});
