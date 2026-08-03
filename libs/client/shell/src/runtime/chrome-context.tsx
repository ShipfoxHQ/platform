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
