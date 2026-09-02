const {isPiExtensionAvailableMock} = vi.hoisted(() => ({
  isPiExtensionAvailableMock: vi.fn(),
}));

vi.mock('#core/pi-extensions.js', () => ({
  isPiExtensionAvailable: isPiExtensionAvailableMock,
}));

import {runnerToolCapabilities} from '#core/tool-capabilities.js';

beforeEach(() => {
  isPiExtensionAvailableMock.mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('runnerToolCapabilities', () => {
  it('reports web access tools when pi-web-access is available', () => {
    expect(runnerToolCapabilities().harnesses.pi?.tools).toEqual([
      'read',
      'bash',
      'edit',
      'write',
      'grep',
      'find',
      'ls',
      'web_search',
      'fetch_content',
      'get_search_content',
    ]);
    expect(isPiExtensionAvailableMock).toHaveBeenCalledWith({packageName: 'pi-web-access'});
  });

  it('reports only built-in tools when pi-web-access is unavailable', () => {
    isPiExtensionAvailableMock.mockReturnValue(false);

    expect(runnerToolCapabilities().harnesses.pi?.tools).toEqual([
      'read',
      'bash',
      'edit',
      'write',
      'grep',
      'find',
      'ls',
    ]);
  });

  it('does not advertise renewable Git when it is not enabled', async () => {
    vi.stubEnv('SHIPFOX_RUNNER_ENABLE_RENEWABLE_GIT', undefined);
    vi.resetModules();

    const {runnerToolCapabilities: disabledCapabilities} = await import(
      '#core/tool-capabilities.js'
    );

    expect(disabledCapabilities().features).toBeUndefined();
  });

  it('advertises renewable Git only when explicitly enabled', async () => {
    vi.stubEnv('SHIPFOX_RUNNER_ENABLE_RENEWABLE_GIT', 'true');
    vi.resetModules();

    const {runnerToolCapabilities: enabledCapabilities} = await import(
      '#core/tool-capabilities.js'
    );

    expect(enabledCapabilities().features).toEqual({renewable_git: true});
  });
});
