export type IntegrationCapability = 'source_control' | 'agent_tools';
export type ConnectionLifecycleStatus = 'active' | 'disabled' | 'error';

export interface IntegrationProvider {
  provider: string;
  displayName: string;
  capabilities: IntegrationCapability[];
}

export interface JiraSite {
  cloudId: string;
  name: string;
  url: string;
  scopes: string[];
}

export interface IntegrationConnection {
  id: string;
  workspaceId: string;
  provider: string;
  externalAccountId: string;
  slug: string;
  displayName: string;
  lifecycleStatus: ConnectionLifecycleStatus;
  capabilities: IntegrationCapability[];
  externalUrl?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface Repository {
  connectionId: string;
  externalRepositoryId: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  visibility: 'public' | 'private' | 'internal' | 'unknown';
  cloneUrl: string;
  htmlUrl: string;
}

export interface RepositoryPage {
  repositories: Repository[];
  nextCursor?: string;
}

export type RepositoryAccessMode = 'selected' | 'all';

export type RepositoryAccessOrigin =
  | {type: 'project'; projectId: string; projectName: string}
  | {type: 'manual'; grantId: string};

export interface RepositoryAccessRepository {
  externalRepositoryId: string;
  owner: string;
  name: string;
  origins: RepositoryAccessOrigin[];
}

export interface RepositoryAccess {
  mode: RepositoryAccessMode;
  repositories: RepositoryAccessRepository[];
  nextCursor?: string;
}

export interface WebhookConnection {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  lifecycleStatus: ConnectionLifecycleStatus;
  inboundUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface InstallRedirect {
  installUrl: string;
}

export type IntegrationUsageEvent = {
  value: string;
  label: string;
};

export type ConnectionLifecyclePresentation =
  | {kind: 'active'}
  | {kind: 'disabled'; label: 'Disabled'}
  | {kind: 'error'; label: 'Error'};

const githubUsageEvents = [
  'push',
  'branch_protection_configuration',
  'branch_protection_rule',
  'check_run',
  'check_suite',
  'code_scanning_alert',
  'commit_comment',
  'create',
  'custom_property',
  'custom_property_values',
  'delete',
  'dependabot_alert',
  'deploy_key',
  'deployment',
  'deployment_protection_rule',
  'deployment_review',
  'deployment_status',
  'discussion',
  'discussion_comment',
  'fork',
  'github_app_authorization',
  'gollum',
  'installation',
  'installation_repositories',
  'installation_target',
  'issue_comment',
  'issue_dependencies',
  'issues',
  'label',
  'marketplace_purchase',
  'member',
  'membership',
  'merge_group',
  'meta',
  'milestone',
  'org_block',
  'organization',
  'package',
  'page_build',
  'personal_access_token_request',
  'ping',
  'project',
  'project_card',
  'project_column',
  'projects_v2',
  'projects_v2_item',
  'projects_v2_status_update',
  'public',
  'pull_request',
  'pull_request_review',
  'pull_request_review_comment',
  'pull_request_review_thread',
  'registry_package',
  'release',
  'repository',
  'repository_advisory',
  'repository_dispatch',
  'repository_import',
  'repository_ruleset',
  'repository_vulnerability_alert',
  'secret_scanning_alert',
  'secret_scanning_alert_location',
  'secret_scanning_scan',
  'security_advisory',
  'security_and_analysis',
  'sponsorship',
  'star',
  'status',
  'sub_issues',
  'team',
  'team_add',
  'watch',
  'workflow_dispatch',
  'workflow_job',
  'workflow_run',
] as const;

const linearUsageEvents = [
  'Issue.create',
  'Issue.update',
  'Issue.remove',
  'Comment.create',
  'Comment.update',
  'Comment.remove',
  'IssueLabel.create',
  'IssueLabel.update',
  'IssueLabel.remove',
  'Project.create',
  'Project.update',
  'Project.remove',
  'Cycle.create',
  'Cycle.update',
  'Cycle.remove',
  'agentSession.created',
  'agentSession.prompted',
] as const;

const sentryIssueActions = ['created', 'resolved', 'assigned', 'archived', 'unresolved'] as const;

const jiraUsageEvents = [
  'jira:issue_created',
  'jira:issue_updated',
  'jira:issue_deleted',
  'comment_created',
  'comment_updated',
  'comment_deleted',
] as const;

export function usageEventsForConnection(
  connection: Pick<IntegrationConnection, 'provider' | 'capabilities'>,
): IntegrationUsageEvent[] {
  if (connection.provider === 'webhook') return [{value: 'received', label: 'received'}];
  if (connection.provider === 'github')
    return githubUsageEvents.map((value) => ({value, label: value}));
  if (connection.provider === 'sentry')
    return sentryIssueActions.map((action) => ({
      value: `issue.${action}`,
      label: `issue.${action}`,
    }));
  if (connection.provider === 'jira')
    return jiraUsageEvents.map((value) => ({value, label: value}));
  if (connection.provider === 'linear')
    return linearUsageEvents.map((value) => ({value, label: value}));
  if (connection.capabilities.includes('source_control')) return [{value: 'push', label: 'push'}];
  return [{value: 'received', label: 'received'}];
}

export function connectionLifecyclePresentation(
  status: ConnectionLifecycleStatus,
): ConnectionLifecyclePresentation {
  if (status === 'disabled') return {kind: 'disabled', label: 'Disabled'};
  if (status === 'error') return {kind: 'error', label: 'Error'};
  return {kind: 'active'};
}

export function hasCapability(
  connection: IntegrationConnection,
  capability: IntegrationCapability,
) {
  return connection.capabilities.includes(capability);
}

export function isUsableConnection(connection: IntegrationConnection) {
  return connection.lifecycleStatus === 'active';
}
