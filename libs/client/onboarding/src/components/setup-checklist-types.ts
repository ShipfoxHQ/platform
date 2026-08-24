import type {SetupChecklist, SetupChecklistItem} from '#core/setup-checklist.js';

export interface WorkspaceReference {
  id: string;
  slug: string;
}

export interface WorkspaceSetupHostProps {
  /** A stable workspace makes the hosts easy to compose in isolated surfaces and stories. */
  workspace?: WorkspaceReference;
}

export interface SetupChecklistBodyProps {
  checklist: SetupChecklist;
  workspaceSlug: string;
  completion?: boolean;
  showBurst?: boolean;
  onBurstComplete?: () => void;
  onAction?: ((item: SetupChecklistItem) => void) | undefined;
  onDone?: () => void;
}
