import type {WorkspaceProvidersPolicy} from '@shipfox/api-agent-dto';
import {WorkspaceProvidersDisabledError} from './errors.js';

export interface WorkspaceProviderPolicyOptions {
  readonly workspaceProviders: WorkspaceProvidersPolicy;
  readonly managedProviderId?: string | undefined;
}

export function assertWorkspaceProviderConfigurationEnabled(
  options: WorkspaceProviderPolicyOptions,
): void {
  if (options.workspaceProviders !== 'disabled') return;
  if (options.managedProviderId === undefined) {
    throw new Error(
      'workspace provider configuration is disabled but no managed provider is registered',
    );
  }
  throw new WorkspaceProvidersDisabledError(options.managedProviderId);
}
