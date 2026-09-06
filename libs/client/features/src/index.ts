import {agentAccessFeature, agentFeature} from '@shipfox/client-agent/feature';
import {authFeature} from '@shipfox/client-auth/feature';
import {integrationsFeature} from '@shipfox/client-integrations/feature';
import {invitationsFeature} from '@shipfox/client-invitations/feature';
import {projectsFeature} from '@shipfox/client-projects/feature';
import {runnersFeature} from '@shipfox/client-runners/feature';
import {secretsFeature} from '@shipfox/client-secrets/feature';
import type {ClientFeature} from '@shipfox/client-shell';
import {triggersFeature} from '@shipfox/client-triggers/feature';
import {workflowsFeature} from '@shipfox/client-workflows/feature';
import {workspaceSettingsFeature} from '@shipfox/client-workspace-settings/feature';

export function defaultFeatures(): ClientFeature[] {
  return [
    authFeature,
    invitationsFeature,
    integrationsFeature,
    projectsFeature,
    workflowsFeature,
    agentFeature,
    agentAccessFeature,
    runnersFeature,
    secretsFeature,
    triggersFeature,
    workspaceSettingsFeature,
  ];
}
