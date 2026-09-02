import {Outlet} from '@tanstack/react-router';
import type {PropsWithChildren, ReactNode} from 'react';
import type {LayoutNavigationEntry} from '#contract.js';
import {ApplicationFrame} from './application-frame.js';

export interface ApplicationLayoutProps extends PropsWithChildren {
  context: ReactNode;
  navigation: {
    ariaLabel: string;
    entries: readonly LayoutNavigationEntry[];
  };
}

/** Standard application chrome for authenticated routes outside a workspace. */
export function ApplicationLayout({children, context, navigation}: ApplicationLayoutProps) {
  return (
    <ApplicationFrame compactLogo context={context} navigation={navigation}>
      {children ?? <Outlet />}
    </ApplicationFrame>
  );
}
