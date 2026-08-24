import {loadWorkspaceSetupRoute} from '@shipfox/client-onboarding';
import {WorkspaceSetupChecklist, WorkspaceSetupIndicator} from '@shipfox/client-onboarding/feature';
import {ProjectBreadcrumb, resolveProjectSlug} from '@shipfox/client-projects';
import type {ChromeSlots, WorkspaceSetupGate} from '@shipfox/client-shell/runtime';

export const defaultChrome: ChromeSlots = {
  ProjectBreadcrumb,
  projectSlugResolver: resolveProjectSlug,
  WorkspaceSetupChecklist,
  WorkspaceSetupIndicator,
};
export const defaultWorkspaceSetupGate: WorkspaceSetupGate = loadWorkspaceSetupRoute;
