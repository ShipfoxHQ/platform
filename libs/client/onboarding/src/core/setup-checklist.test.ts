import {describe, expect, test} from '@shipfox/vitest/vi';
import {deriveIntegrationReadiness} from './integration-readiness.js';
import {
  deriveSetupChecklist,
  type SetupChecklistInput,
  type SetupChecklistItem,
  selectNextSetupStep,
} from './setup-checklist.js';

function readiness(overrides: Partial<ReturnType<typeof deriveIntegrationReadiness>> = {}) {
  return {
    ...deriveIntegrationReadiness({
      providers: [
        {
          provider: 'github',
          displayName: 'GitHub',
          capabilities: ['source_control', 'agent_tools'],
        },
        {provider: 'linear', displayName: 'Linear', capabilities: ['agent_tools']},
        {provider: 'webhook', displayName: 'Webhook', capabilities: []},
      ],
      connections: [],
    }),
    ...overrides,
  };
}

function input(overrides: Partial<SetupChecklistInput> = {}): SetupChecklistInput {
  return {
    readiness: readiness(),
    installationRunners: 'managed',
    workspaceRunnerCapacity: false,
    modelProvider: {installationProvided: true, configured: false},
    membership: {memberCount: 1, pendingInvitationCount: 0},
    ...overrides,
  };
}

function itemIds(items: readonly SetupChecklistItem[]) {
  return items.map((item) => item.id);
}

describe('deriveSetupChecklist', () => {
  test('keeps rows in spec order', () => {
    const checklist = deriveSetupChecklist(input());

    expect(itemIds(checklist.items)).toEqual([
      'source-control',
      'project',
      'tools',
      'first-workflow',
      'teammates',
    ]);
  });

  test('renders the Cloud shape as 2 of 3 done', () => {
    const checklist = deriveSetupChecklist(input());

    expect(checklist.items.map((item) => [item.id, item.status])).toEqual([
      ['source-control', 'done'],
      ['project', 'done'],
      ['tools', 'open'],
      ['first-workflow', 'info'],
      ['teammates', 'info'],
    ]);
    expect(checklist.trackedCount).toBe(3);
    expect(checklist.openCount).toBe(1);
    expect(checklist.complete).toBe(false);
  });

  test('completes on Cloud once a tool is connected', () => {
    const checklist = deriveSetupChecklist(
      input({readiness: readiness({hasToolIntegration: true})}),
    );

    expect(checklist.openCount).toBe(0);
    expect(checklist.complete).toBe(true);
    expect(checklist.items.find((item) => item.id === 'tools')?.status).toBe('done');
  });

  test('renders the bare self-host shape as 2 of 5 done', () => {
    const checklist = deriveSetupChecklist(
      input({
        installationRunners: 'none',
        modelProvider: {installationProvided: false, configured: false},
      }),
    );

    expect(itemIds(checklist.items)).toEqual([
      'source-control',
      'project',
      'tools',
      'runner',
      'model-provider',
      'first-workflow',
      'teammates',
    ]);
    expect(checklist.trackedCount).toBe(5);
    expect(checklist.openCount).toBe(3);
    expect(checklist.complete).toBe(false);
  });

  test('completes on a bare self-host only when tools, runner, and model provider are done', () => {
    const checklist = deriveSetupChecklist(
      input({
        readiness: readiness({hasToolIntegration: true}),
        installationRunners: 'none',
        workspaceRunnerCapacity: true,
        modelProvider: {installationProvided: false, configured: true},
      }),
    );

    expect(checklist.openCount).toBe(0);
    expect(checklist.complete).toBe(true);
  });

  test('keeps the checklist incomplete while any conditional row is open', () => {
    const checklist = deriveSetupChecklist(
      input({
        readiness: readiness({hasToolIntegration: true}),
        installationRunners: 'none',
        workspaceRunnerCapacity: false,
        modelProvider: {installationProvided: false, configured: true},
      }),
    );

    expect(checklist.openCount).toBe(1);
    expect(checklist.complete).toBe(false);
  });

  test('hides the runner row when the installation provides managed capacity', () => {
    const checklist = deriveSetupChecklist(
      input({installationRunners: 'managed', workspaceRunnerCapacity: false}),
    );

    expect(itemIds(checklist.items)).not.toContain('runner');
  });

  test('shows the runner row when the installation provides no capacity', () => {
    const checklist = deriveSetupChecklist(
      input({installationRunners: 'none', workspaceRunnerCapacity: false}),
    );

    expect(checklist.items.find((item) => item.id === 'runner')).toMatchObject({
      status: 'open',
      tracked: true,
      action: {href: '/settings/runners'},
    });
  });

  test('marks the runner row done when the workspace has capacity', () => {
    const checklist = deriveSetupChecklist(
      input({installationRunners: 'none', workspaceRunnerCapacity: true}),
    );

    expect(checklist.items.find((item) => item.id === 'runner')?.status).toBe('done');
  });

  test('hides the model-provider row when the installation provides inference', () => {
    const checklist = deriveSetupChecklist(
      input({modelProvider: {installationProvided: true, configured: false}}),
    );

    expect(itemIds(checklist.items)).not.toContain('model-provider');
  });

  test('shows the model-provider row only when the installation provides no inference', () => {
    const checklist = deriveSetupChecklist(
      input({modelProvider: {installationProvided: false, configured: false}}),
    );

    expect(checklist.items.find((item) => item.id === 'model-provider')).toMatchObject({
      status: 'open',
      tracked: true,
      action: {href: '/settings/agents'},
    });
  });

  test('marks the model-provider row done when a config exists', () => {
    const checklist = deriveSetupChecklist(
      input({modelProvider: {installationProvided: false, configured: true}}),
    );

    expect(checklist.items.find((item) => item.id === 'model-provider')?.status).toBe('done');
  });

  test('keeps source control and project rows always done', () => {
    const checklist = deriveSetupChecklist(input());

    expect(checklist.items.find((item) => item.id === 'source-control')?.status).toBe('done');
    expect(checklist.items.find((item) => item.id === 'project')?.status).toBe('done');
  });

  test('names a single attention provider in the tools title', () => {
    const checklist = deriveSetupChecklist(
      input({
        readiness: readiness({
          attentionProviders: ['linear'],
          hasToolIntegration: false,
        }),
      }),
    );

    expect(checklist.items.find((item) => item.id === 'tools')).toMatchObject({
      status: 'open',
      title: 'Linear needs attention',
    });
  });

  test('uses the provider display name for a key with brand capitalization', () => {
    const checklist = deriveSetupChecklist(
      input({
        readiness: readiness({
          providers: [
            {
              provider: 'github',
              displayName: 'GitHub',
              capabilities: ['agent_tools'],
              connected: false,
              attention: true,
            },
          ],
          attentionProviders: ['github'],
          hasToolIntegration: false,
        }),
      }),
    );

    expect(checklist.items.find((item) => item.id === 'tools')?.title).toBe(
      'GitHub needs attention',
    );
  });

  test('does not name a source-control provider in the tools title', () => {
    const checklist = deriveSetupChecklist(
      input({
        readiness: readiness({
          attentionProviders: ['github'],
          hasToolIntegration: false,
        }),
      }),
    );

    expect(checklist.items.find((item) => item.id === 'tools')?.title).toBe('Connect your tools');
  });

  test('counts several attention providers in the tools title', () => {
    const checklist = deriveSetupChecklist(
      input({
        readiness: readiness({
          attentionProviders: ['linear', 'webhook'],
          hasToolIntegration: false,
        }),
      }),
    );

    expect(checklist.items.find((item) => item.id === 'tools')?.title).toBe(
      '2 integrations need attention',
    );
  });

  test('keeps the base tools title when nothing needs attention', () => {
    const checklist = deriveSetupChecklist(input());

    expect(checklist.items.find((item) => item.id === 'tools')?.title).toBe('Connect your tools');
  });

  test('keeps the base tools title when the tools row is done despite attention', () => {
    const checklist = deriveSetupChecklist(
      input({
        readiness: readiness({
          attentionProviders: ['linear'],
          hasToolIntegration: true,
        }),
      }),
    );

    expect(checklist.items.find((item) => item.id === 'tools')).toMatchObject({
      status: 'done',
      title: 'Connect your tools',
      attention: false,
    });
  });

  test('carries the tools purpose and settings link on the open row', () => {
    const checklist = deriveSetupChecklist(input());

    expect(checklist.items.find((item) => item.id === 'tools')).toMatchObject({
      purpose: 'Connect issue tracking, messaging, observability, or any Shipfox integration',
      action: {href: '/settings/integrations'},
    });
  });

  test('treats the first-workflow row as a pointer that never counts', () => {
    const checklist = deriveSetupChecklist(input());

    expect(checklist.items.find((item) => item.id === 'first-workflow')).toMatchObject({
      status: 'info',
      tracked: false,
      action: {href: '/docs/getting-started'},
    });
  });

  test('treats the teammates row as a pointer that never counts', () => {
    const checklist = deriveSetupChecklist(input());

    expect(checklist.items.find((item) => item.id === 'teammates')).toMatchObject({
      status: 'info',
      tracked: false,
      action: {href: '/settings/members'},
    });
  });

  test('renders the teammates row done once a second member joined', () => {
    const checklist = deriveSetupChecklist(
      input({membership: {memberCount: 2, pendingInvitationCount: 0}}),
    );

    expect(checklist.items.find((item) => item.id === 'teammates')?.status).toBe('done');
  });

  test('renders the teammates row done once an invitation is pending', () => {
    const checklist = deriveSetupChecklist(
      input({membership: {memberCount: 1, pendingInvitationCount: 1}}),
    );

    expect(checklist.items.find((item) => item.id === 'teammates')?.status).toBe('done');
  });

  test('never counts pointers toward trackedCount or openCount', () => {
    const checklist = deriveSetupChecklist(
      input({
        membership: {memberCount: 1, pendingInvitationCount: 0},
        installationRunners: 'none',
        modelProvider: {installationProvided: false, configured: false},
      }),
    );

    expect(checklist.trackedCount).toBe(5);
    expect(checklist.openCount).toBe(3);
    expect(checklist.items.filter((item) => !item.tracked)).toHaveLength(2);
  });
});

describe('selectNextSetupStep', () => {
  test('picks the first open tracked row ahead of every pointer', () => {
    const checklist = deriveSetupChecklist(
      input({
        installationRunners: 'none',
        modelProvider: {installationProvided: false, configured: false},
      }),
    );

    expect(selectNextSetupStep(checklist)?.id).toBe('tools');
  });

  test('follows the spec order once an earlier ask is done', () => {
    const checklist = deriveSetupChecklist(
      input({
        readiness: readiness({hasToolIntegration: true}),
        installationRunners: 'none',
        modelProvider: {installationProvided: false, configured: false},
      }),
    );

    expect(selectNextSetupStep(checklist)?.id).toBe('runner');
  });

  test('falls back to the first unfinished pointer when every tracked row is done', () => {
    const checklist = deriveSetupChecklist(
      input({readiness: readiness({hasToolIntegration: true})}),
    );

    expect(checklist.openCount).toBe(0);
    expect(selectNextSetupStep(checklist)?.id).toBe('first-workflow');
  });

  test('returns nothing when the checklist has no rows left to show', () => {
    expect(
      selectNextSetupStep({items: [], openCount: 0, trackedCount: 0, complete: true}),
    ).toBeUndefined();
  });
});
