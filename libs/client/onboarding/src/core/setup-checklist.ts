import type {WorkspaceIntegrationReadiness} from './integration-readiness.js';

export type SetupChecklistItemStatus = 'done' | 'open' | 'info';

export type SetupChecklistItemId =
  | 'source-control'
  | 'project'
  | 'tools'
  | 'runner'
  | 'model-provider'
  | 'first-workflow'
  | 'teammates';

/** Every destination the checklist routes to. Keeps action routing total. */
export type SetupChecklistActionHref =
  | '/docs/getting-started'
  | '/settings/agents'
  | '/settings/integrations'
  | '/settings/members'
  | '/settings/runners';

export interface SetupChecklistAction {
  label: string;
  href: SetupChecklistActionHref;
}

export interface SetupChecklistItem {
  id: SetupChecklistItemId;
  title: string;
  status: SetupChecklistItemStatus;
  /** Tracked items count toward completion; pointers never do. */
  tracked: boolean;
  /** The row's underlying integration has a connection that needs attention. */
  attention?: boolean;
  /** One line of purpose, rendered for open and pointer rows. */
  purpose?: string;
  /** Primary action, a link to the settings page where the work happens. */
  action?: SetupChecklistAction;
}

export interface SetupChecklist {
  /** Rows in spec order: done progress, activation asks, then pointers. */
  items: readonly SetupChecklistItem[];
  /** Open tracked rows. */
  openCount: number;
  /** Rows that count toward completion. */
  trackedCount: number;
  /** True when every tracked row is done. */
  complete: boolean;
}

export interface SetupChecklistInput {
  readiness: WorkspaceIntegrationReadiness;
  installationRunners: 'managed' | 'none';
  workspaceRunnerCapacity: boolean;
  modelProvider: {installationProvided: boolean; configured: boolean};
  membership: {memberCount: number; pendingInvitationCount: number};
}

const TOOLS_TITLE = 'Connect your tools';
const TOOLS_PURPOSE =
  'Connect issue tracking, messaging, observability, or any Shipfox integration';
const RUNNER_PURPOSE = 'Jobs wait in `pending` until a runner is online';
const MODEL_PROVIDER_PURPOSE = 'Agent steps need a model provider to run';
const FIRST_WORKFLOW_PURPOSE =
  'Add a workflow file under `.shipfox/workflows/` and Shipfox picks it up on the next push';
const TEAMMATES_PURPOSE = 'Everyone in the workspace can edit workflows and see runs';

/**
 * Derives the workspace setup checklist from integration readiness and the
 * runner, model-provider, and membership facts. Rows follow the spec order;
 * the runner and model-provider rows exist only when the installation does
 * not already provide the capability.
 */
export function deriveSetupChecklist({
  readiness,
  installationRunners,
  workspaceRunnerCapacity,
  modelProvider,
  membership,
}: SetupChecklistInput): SetupChecklist {
  const toolsAttention =
    !readiness.hasToolIntegration && attentionToolProviders(readiness).length > 0;
  const items: SetupChecklistItem[] = [
    {id: 'source-control', title: 'Connect source control', status: 'done', tracked: true},
    {id: 'project', title: 'Create a project', status: 'done', tracked: true},
    {
      id: 'tools',
      title: toolsTitle(readiness),
      status: readiness.hasToolIntegration ? 'done' : 'open',
      tracked: true,
      attention: toolsAttention,
      purpose: TOOLS_PURPOSE,
      action: {label: 'Connect', href: '/settings/integrations'},
    },
  ];

  if (installationRunners === 'none') {
    items.push({
      id: 'runner',
      title: 'Set up runner capacity',
      status: workspaceRunnerCapacity ? 'done' : 'open',
      tracked: true,
      purpose: RUNNER_PURPOSE,
      action: {label: 'Set up', href: '/settings/runners'},
    });
  }

  if (!modelProvider.installationProvided) {
    items.push({
      id: 'model-provider',
      title: 'Configure a model provider',
      status: modelProvider.configured ? 'done' : 'open',
      tracked: true,
      purpose: MODEL_PROVIDER_PURPOSE,
      action: {label: 'Configure', href: '/settings/agents'},
    });
  }

  items.push(
    {
      id: 'first-workflow',
      title: 'Push your first workflow',
      status: 'info',
      tracked: false,
      purpose: FIRST_WORKFLOW_PURPOSE,
      action: {label: 'Read the quickstart', href: '/docs/getting-started'},
    },
    {
      id: 'teammates',
      title: 'Invite your teammates',
      status:
        membership.memberCount >= 2 || membership.pendingInvitationCount >= 1 ? 'done' : 'info',
      tracked: false,
      purpose: TEAMMATES_PURPOSE,
      action: {label: 'Invite', href: '/settings/members'},
    },
  );

  const trackedItems = items.filter((item) => item.tracked);
  const openCount = trackedItems.filter((item) => item.status === 'open').length;

  return {
    items,
    openCount,
    trackedCount: trackedItems.length,
    complete: openCount === 0,
  };
}

function toolsTitle(readiness: WorkspaceIntegrationReadiness): string {
  if (!readiness.hasToolIntegration) {
    const providers = attentionToolProviders(readiness);
    if (providers.length === 1) {
      const provider = providers[0];
      if (provider !== undefined) {
        return `${provider.displayName || provider.provider} needs attention`;
      }
    }
    if (providers.length > 1) {
      return `${providers.length} integrations need attention`;
    }
  }
  return TOOLS_TITLE;
}

function attentionToolProviders(readiness: WorkspaceIntegrationReadiness) {
  return readiness.attentionProviders
    .map((providerKey) => readiness.providers.find(({provider}) => provider === providerKey))
    .filter(
      (provider) => provider !== undefined && !provider.capabilities.includes('source_control'),
    );
}

/**
 * The single step a compact host asks for: the first open tracked row, or the
 * first unfinished pointer once every tracked row is done but the checklist has
 * not settled as complete.
 */
export function selectNextSetupStep(checklist: SetupChecklist): SetupChecklistItem | undefined {
  return (
    checklist.items.find((item) => item.tracked && item.status === 'open') ??
    checklist.items.find((item) => item.status !== 'done')
  );
}
