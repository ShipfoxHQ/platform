import {composeClientFeatures} from '@shipfox/client-shell/runtime';
import {describe, expect, it} from '@shipfox/vitest/vi';
import manifest from '../package.json' with {type: 'json'};
import {defaultFeatures} from './index.js';
import {defaultChrome, defaultWorkspaceSetupGate} from './runtime.js';

const SHIPFOX_PACKAGE_PATTERN = /^(@shipfox\/[^/]+)\//u;

describe('defaultFeatures', () => {
  it('composes the upstream client features in manifest order', () => {
    expect(defaultFeatures().map((feature) => feature.id)).toEqual([
      'shipfox.auth',
      'shipfox.invitations',
      'shipfox.integrations',
      'shipfox.projects',
      'shipfox.workflows',
      'shipfox.agent',
      'shipfox.agent-access',
      'shipfox.runners',
      'shipfox.secrets',
      'shipfox.triggers',
      'shipfox.workspace-settings',
    ]);
  });

  it('declares every default route implementation package as a peer dependency', () => {
    const peerPackageNames = Object.keys(manifest.peerDependencies ?? {}).filter((name) =>
      name.startsWith('@shipfox/client-'),
    );

    const routePackageNames = new Set(
      defaultFeatures()
        .flatMap((feature) => feature.routes ?? [])
        .map(({impl}) => SHIPFOX_PACKAGE_PATTERN.exec(impl)?.[1])
        .filter((name): name is string => name !== undefined),
    );

    expect([...routePackageNames].sort()).toEqual(peerPackageNames.sort());
  });

  it('composes each navigation and settings contribution exactly once', () => {
    const composition = composeClientFeatures(defaultFeatures());

    expect(composition.navigation.map(({id}) => id)).toEqual([
      'nav.projects',
      'nav.runs',
      'nav.workflows',
      'nav.settings',
    ]);
    expect(composition.settingsSections.map(({id}) => id)).toEqual([
      'settings.project-general',
      'settings.general',
      'settings.members',
      'settings.runners',
      'settings.provisioners',
      'settings.agents',
      'settings.agent-access',
      'settings.secrets',
      'settings.variables',
      'settings.integrations',
      'settings.events',
    ]);
    expect(new Set(composition.navigation.map(({id}) => id)).size).toBe(
      composition.navigation.length,
    );
    expect(new Set(composition.settingsSections.map(({id}) => id)).size).toBe(
      composition.settingsSections.length,
    );
  });
});

describe('defaultChrome', () => {
  it('wires the workspace setup checklist and indicator into the default chrome', () => {
    // Dropping either slot silently removes the Get-started guide from the hub
    // and the top bar, so the composition contract is asserted here.
    expect(defaultChrome.WorkspaceSetupChecklist).toBeDefined();
    expect(defaultChrome.WorkspaceSetupIndicator).toBeDefined();
    expect(defaultChrome.ProjectBreadcrumb).toBeDefined();
    expect(defaultChrome.projectSlugResolver).toBeDefined();
  });

  it('uses the onboarding workspace setup gate by default', () => {
    expect(defaultWorkspaceSetupGate).toBeDefined();
  });
});
