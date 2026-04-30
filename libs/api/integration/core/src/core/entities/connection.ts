import type {IntegrationProviderKind} from './provider.js';

export type IntegrationConnectionLifecycleStatus = 'active' | 'disabled' | 'error';

export interface IntegrationConnection {
  id: string;
  workspaceId: string;
  provider: IntegrationProviderKind;
  externalAccountId: string;
  displayName: string;
  lifecycleStatus: IntegrationConnectionLifecycleStatus;
  createdAt: Date;
  updatedAt: Date;
}
