export type IntegrationProviderKind = 'debug' | 'github';

export type IntegrationCapability = 'source_control';

export type IntegrationConnectionLifecycleStatus = 'active' | 'disabled' | 'error';

export interface IntegrationConnection {
  id: string;
  workspaceId: string;
  provider: IntegrationProviderKind;
  externalAccountId: string;
  displayName: string;
  lifecycleStatus: IntegrationConnectionLifecycleStatus;
  capabilities: IntegrationCapability[];
  createdAt: Date;
  updatedAt: Date;
}
