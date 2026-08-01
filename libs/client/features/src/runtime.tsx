import {loadWorkspaceSetupRoute} from '@shipfox/client-onboarding';
import {ProjectBreadcrumb, resolveProjectSlug} from '@shipfox/client-projects';
import type {ChromeSlots, WorkspaceSetupGate} from '@shipfox/client-shell/runtime';

export const defaultChrome: ChromeSlots = {
  ProjectBreadcrumb,
  projectSlugResolver: resolveProjectSlug,
};
export const defaultWorkspaceSetupGate: WorkspaceSetupGate = loadWorkspaceSetupRoute;
