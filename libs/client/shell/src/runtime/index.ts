export {
  ApplicationLayout,
  type ApplicationLayoutProps,
} from '#components/application-layout.js';
export {AuthActions, AuthShell, type AuthShellProps} from '#components/auth-shell.js';
export {
  FOCUSED_FRAME_CONTENT_CLASS_NAME,
  FocusedFrame,
} from '#components/focused-frame.js';
export {WorkspaceCrumb, type WorkspaceCrumbProps} from '#components/workspace-crumb.js';
export {WorkspaceSwitcher} from '#components/workspace-switcher.js';
export type {
  AuthenticatedSession,
  UserIdentity,
  WorkspaceMembership,
  WorkspaceSummary,
} from '#core/session.js';
export {
  type SessionResponseDto,
  toAuthenticatedSession,
  toUserIdentity,
} from '#hooks/api/session-mapper.js';
export * from '../compose/compose-client-features.js';
export * from '../compose/compose-routes.js';
export * from '../compose/errors.js';
export * from '../compose/merge-config.js';
export * from '../compose/normalize-route-path.js';
export * from '../compose/validate-providers.js';
export * from '../compose/validate-registries.js';
export * from './active-workspace.js';
export * from './anchor-paths.js';
export * from './anchors.js';
export * from './auth.js';
export * from './chrome-context.js';
export * from './client-analytics.js';
export * from './compose-client-app.js';
export * from './define-route.js';
export * from './last-workspace.js';
export * from './layout-navigation.js';
export * from './nav-order.js';
export * from './route-frame.js';
export * from './route-inputs.js';
export * from './router-context.js';
export * from './search-serialization.js';
export * from './workspace-setup.js';
export * from './workspace-setup-dismissal.js';
