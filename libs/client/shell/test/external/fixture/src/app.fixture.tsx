import {getLoadedConfig} from '@shipfox/client-config';
import {QueryClient} from '@tanstack/react-query';
import {createMemoryHistory} from '@tanstack/react-router';
import {flushSync} from 'react-dom';
import {createRoot, type Root} from 'react-dom/client';
import {auth, ClientApp, workspaceSetup} from './main';
import {readProviderEvidence, resetProviderEvidence} from './provider';
import {router} from './shipfox-app.gen';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }));
  window.scrollTo = vi.fn();
  resetProviderEvidence();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
});

function mountClient(): void {
  flushSync(() => root.render(<ClientApp />));
}

function heading(name: string): Element | undefined {
  return [...container.querySelectorAll('h1, h2, h3')].find(
    (element) => element.textContent?.trim() === name,
  );
}

test('reports a missing external config fragment', async () => {
  window.__SHIPFOX_CONFIG__ = undefined;

  mountClient();

  await vi.waitFor(() => expect(heading('Configuration error')).toBeDefined());
  expect(container.textContent).toContain('externalGreeting');
});

test('renders the explicit default-route replacement', async () => {
  window.__SHIPFOX_CONFIG__ = {EXTERNAL_GREETING: 'Hello from the external fixture'};
  router.update({
    history: createMemoryHistory({initialEntries: ['/auth/login']}),
    context: {auth: undefined, queryClient: undefined},
  });
  await router.load();

  mountClient();

  await vi.waitFor(() => expect(heading('External login')).toBeDefined());
  expect(heading('Log in')).toBeUndefined();
});

test('renders the external route, provider order, navigation, settings, and config', async () => {
  window.__SHIPFOX_CONFIG__ = {EXTERNAL_GREETING: 'Hello from the external fixture'};
  router.update({
    history: createMemoryHistory({
      initialEntries: ['/workspaces/workspace/settings/external'],
    }),
    context: {auth, queryClient: new QueryClient(), workspaceSetup},
  });
  await router.load();
  mountClient();

  await vi.waitFor(() => expect(heading('External settings')).toBeDefined());
  expect(
    [...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent?.trim()),
  ).toEqual(['Projects', 'External', 'Settings']);
  expect(
    [...container.querySelectorAll('[aria-label="Workspace settings"] a')]
      .map((link) => link.textContent?.trim())
      .slice(0, 3),
  ).toEqual(['Members', 'External', 'Runners']);
  expect(container.querySelector('[aria-label="External provider order"]')?.textContent).toBe(
    'outer > inner',
  );
  expect(container.textContent).toContain('Hello from the external fixture');
  const userMenu = container.querySelector('[aria-label="User menu"]');
  if (!(userMenu instanceof HTMLButtonElement)) throw new Error('Expected the user menu button.');
  userMenu.dispatchEvent(new MouseEvent('pointerdown', {bubbles: true, button: 0}));
  await vi.waitFor(() =>
    expect(document.body.querySelector('[data-testid="external-account-menu-entry"]')).toBeTruthy(),
  );
  expect(document.body.textContent).toContain('Theme');
  expect(document.body.textContent).toContain('Logout');
  await vi.waitFor(() => expect(readProviderEvidence().map(({id}) => id)).toEqual(['outer', 'inner']));
  const providers = readProviderEvidence();
  expect(providers[1]?.queryClient).toBe(providers[0]?.queryClient);
  expect(providers[1]?.store).toBe(providers[0]?.store);
  expect(providers.map(({externalGreeting}) => externalGreeting)).toEqual([
    'Hello from the external fixture',
    'Hello from the external fixture',
  ]);
  expect(getLoadedConfig<{externalGreeting: string}>().externalGreeting).toBe(
    'Hello from the external fixture',
  );
});
