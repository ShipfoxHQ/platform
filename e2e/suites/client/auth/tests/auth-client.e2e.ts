import {randomUUID} from 'node:crypto';
import {stableScreenshot} from '@shipfox/e2e-kit/ui';
import {expect, test} from './test.js';

const LOGIN_URL_RE = /\/auth\/login$/u;
const LOGIN_WITH_REDIRECT_URL_RE = /\/auth\/login\?redirect=/u;
const SIGNUP_URL_RE = /\/auth\/signup$/u;
const ONBOARDING_URL_RE = /\/setup\/workspaces\/new\/?$/u;
const ANY_WORKSPACE_URL_RE = /\/workspaces\//u;
const SIGNUP_NOT_ALLOWED_MESSAGE =
  process.env.AUTH_SIGNUP_NOT_ALLOWED_MESSAGE ??
  'This E2E deployment does not accept new accounts.';
const ALLOWED_SIGNUP_EMAIL_DOMAIN =
  process.env.AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS?.split(',')[0]?.trim() ?? 'allowed.example.test';

function workspaceUrlRe(wid: string): RegExp {
  return new RegExp(`/workspaces/${wid}(/|$)`, 'u');
}

test('redirects guests from the app root to login', async ({page, guestRedirects, login}) => {
  await guestRedirects.goto('/');

  await expect(page).toHaveURL(LOGIN_URL_RE);
  await expect(login.heading()).toBeVisible();
  await stableScreenshot(page, 'auth/login');
});

test('logs in through the UI with an E2E-created verified user', async ({
  page,
  auth,
  guestRedirects,
  login,
}) => {
  const user = await auth.createUser({email: `existing-${randomUUID()}@example.test`});

  await login.goto();
  await login.submit(user.email, user.password);

  await expect(guestRedirects.onboardingHeading()).toBeVisible();
  await stableScreenshot(page, 'auth/post-login-workspace');
});

test('keeps an unlisted password signup on the signup form', async ({page, signup}) => {
  await signup.goto();
  await signup.submit({
    email: `blocked-${randomUUID()}@example.test`,
    name: 'Blocked Signup',
    password: 'correct horse battery staple',
  });
  await expect(page).toHaveURL(SIGNUP_URL_RE);
  await expect(signup.alert()).toContainText(SIGNUP_NOT_ALLOWED_MESSAGE);
  await expect(signup.verificationHeading()).toBeHidden();
});
test('starts email verification for an address in the signup allowlist', async ({signup}) => {
  await signup.goto();
  await signup.submit({
    email: `allowed-${randomUUID()}@${ALLOWED_SIGNUP_EMAIL_DOMAIN}`,
    name: 'Allowed Signup',
    password: 'correct horse battery staple',
  });
  await expect(signup.verificationHeading()).toBeVisible();
});
test('form login routes a user with workspaces straight to /workspaces/$wid', async ({
  page,
  auth,
  login,
  workspaces,
}) => {
  const user = await auth.createUser();
  const wsA = await workspaces.create({userId: user.user.id, name: `A ${randomUUID()}`});

  // Record every URL the page transits through. Asserting only the final URL
  // would let a brief flash through /setup/workspaces/new slip past
  // Playwright auto-wait: that flash is the bug we're guarding against.
  const urlsSeen: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      urlsSeen.push(frame.url());
    }
  });

  await login.goto();
  await login.submit(user.email, user.password);

  await expect(page).toHaveURL(workspaceUrlRe(wsA.id));

  for (const url of urlsSeen) {
    expect(url, `transit URL must not flash through onboarding: ${url}`).not.toMatch(
      ONBOARDING_URL_RE,
    );
  }
});

test('hydrates an E2E browser session from the refresh cookie after reload', async ({
  page,
  auth,
  guestRedirects,
}) => {
  const user = await auth.createUser();
  await auth.loginAs(page, user);

  await guestRedirects.goto('/');
  await expect(guestRedirects.onboardingHeading()).toBeVisible();

  await page.reload();
  await expect(guestRedirects.onboardingHeading()).toBeVisible();
});

test('restores a nested deep link after login', async ({
  page,
  auth,
  guestRedirects,
  login,
  workspaces,
}) => {
  const user = await auth.createUser();
  const ws = await workspaces.create({userId: user.user.id, name: `DL ${randomUUID()}`});
  // Fresh E2E workspaces have no source connections, so WorkspaceSetupGuard
  // redirects /projects/new to /integrations. The deep-link restore is proven
  // by the URL transiting *through* /projects/new before that redirect.
  const target = `/workspaces/${ws.id}/projects/new`;

  const urlsSeen: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      urlsSeen.push(frame.url());
    }
  });

  await guestRedirects.goto(target);
  await expect(page).toHaveURL(LOGIN_WITH_REDIRECT_URL_RE);

  await login.emailField().fill(user.email);
  await login.passwordField().fill(user.password);
  // Snapshot the navigation log before submit so the assertion ignores the
  // pre-login visit to `target` and only proves the post-login restore.
  const preLoginCount = urlsSeen.length;
  await login.submitButton().click();

  await expect(page).toHaveURL(workspaceUrlRe(ws.id));

  const postLoginUrls = urlsSeen.slice(preLoginCount);
  const visitedNestedPath = postLoginUrls.some(
    (url) => new URL(url).pathname === `/workspaces/${ws.id}/projects/new`,
  );
  expect(
    visitedNestedPath,
    `expected URL to transit through /projects/new after login: ${postLoginUrls.join(', ')}`,
  ).toBe(true);
});

test('preserves search and hash in the deep link after login', async ({
  page,
  auth,
  guestRedirects,
  login,
  workspaces,
}) => {
  const user = await auth.createUser();
  const ws = await workspaces.create({userId: user.user.id, name: `DL ${randomUUID()}`});
  // WorkspaceSetupGuard at /workspaces/$wid redirects fresh workspaces to
  // /integrations and that redirect drops the search/hash. The restore is
  // proven by the URL transiting through the original deep target with search
  // and hash intact.
  const target = `/workspaces/${ws.id}?tab=runs#header`;

  const urlsSeen: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      urlsSeen.push(frame.url());
    }
  });

  await guestRedirects.goto(target);
  await expect(page).toHaveURL(LOGIN_WITH_REDIRECT_URL_RE);

  await login.emailField().fill(user.email);
  await login.passwordField().fill(user.password);
  // Snapshot the navigation log before submit so the assertion ignores the
  // pre-login visit to `target` and only proves the post-login restore.
  const preLoginCount = urlsSeen.length;
  await login.submitButton().click();

  await expect(page).toHaveURL(workspaceUrlRe(ws.id));

  const postLoginUrls = urlsSeen.slice(preLoginCount);
  const visitedTargetWithSearchAndHash = postLoginUrls.some((url) => {
    const u = new URL(url);
    return (
      u.pathname === `/workspaces/${ws.id}` && u.search === '?tab=runs' && u.hash === '#header'
    );
  });
  expect(
    visitedTargetWithSearchAndHash,
    `expected URL to transit with ?tab=runs#header preserved: ${postLoginUrls.join(', ')}`,
  ).toBe(true);
});

test('blocks open-redirect to a cross-origin URL after login', async ({
  page,
  auth,
  login,
  workspaces,
}) => {
  const user = await auth.createUser();
  await workspaces.create({userId: user.user.id, name: `Block ${randomUUID()}`});

  await login.gotoRawRedirect('//evil.com');
  await login.submit(user.email, user.password);

  await expect(page).toHaveURL(ANY_WORKSPACE_URL_RE);
  expect(page.url()).not.toContain('evil.com');
});

test('routes an already-authenticated visitor of /auth/login?redirect= straight to the deep link', async ({
  page,
  auth,
  login,
  workspaces,
}) => {
  const user = await auth.createUser();
  const ws = await workspaces.create({userId: user.user.id, name: `Auth ${randomUUID()}`});
  await auth.loginAs(page, user);

  await login.goto(`/workspaces/${ws.id}`);

  await expect(page).toHaveURL(workspaceUrlRe(ws.id));
  await expect(login.heading()).not.toBeVisible();
});

test('restores a /setup deep link for a workspace-less user after login', async ({
  page,
  auth,
  guestRedirects,
  login,
}) => {
  const user = await auth.createUser();

  await guestRedirects.goto('/setup/workspaces/new');
  await expect(page).toHaveURL(LOGIN_WITH_REDIRECT_URL_RE);

  await login.submit(user.email, user.password);

  await expect(page).toHaveURL(ONBOARDING_URL_RE);
});
