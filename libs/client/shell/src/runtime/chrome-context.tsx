import type {ComponentType, PropsWithChildren} from 'react';
import {createContext, useContext} from 'react';
import type {ProjectSlugResolver} from './router-context.js';

export interface ChromeSlots {
  ProjectBreadcrumb: ComponentType;
  projectSlugResolver: ProjectSlugResolver;
  /**
   * Optional content rendered in the account menu before the shell-owned logout
   * action. The composing component must render one DropdownMenuItem or return
   * null, and owns whether this content renders from the current session.
   */
  AccountMenuEntry?: ComponentType;
  /**
   * Optional component the projects hub renders as its first panel. The hub
   * renders nothing when the slot is absent, so a consumer that composes
   * without the onboarding feature is unaffected.
   */
  WorkspaceSetupChecklist?: ComponentType;
  /**
   * Optional component the nav bar renders right of the breadcrumbs. The bar
   * renders nothing when the slot is absent, and never on the pre-project gate
   * pages (while hideProjectNavigation is true).
   */
  WorkspaceSetupIndicator?: ComponentType;
  /**
   * Optional component the main layout renders above the navigation bar, inside
   * an error boundary. The layout reserves a minimum-height strip for the slot,
   * measures its rendered height, and accounts for it in the app-content
   * viewport arithmetic, so a composing component taller than the minimum is
   * still fully visible and the content area stays consistent. The layout
   * renders nothing when the slot is absent, so a consumer that composes
   * without the session banner is unaffected.
   */
  SessionBanner?: ComponentType;
}

const ChromeContext = createContext<ChromeSlots | undefined>(undefined);

export function ChromeProvider({
  chrome,
  children,
}: PropsWithChildren<{chrome: ChromeSlots | undefined}>) {
  return <ChromeContext.Provider value={chrome}>{children}</ChromeContext.Provider>;
}

export function useChrome(): ChromeSlots {
  const chrome = useContext(ChromeContext);
  if (!chrome) throw new Error('Client composition must provide browser chrome slots.');
  return chrome;
}
