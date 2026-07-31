import {instanceMetrics} from '@shipfox/node-opentelemetry';

export type WorkspacesInvitationEmailRequested = 'requested' | 'skipped';
export type WorkspacesMembershipChangeAction = 'added' | 'removed';
export type WorkspacesInvitationAcceptOutcome = 'added' | 'already_member';
export type WorkspacesRateLimitOutcome = 'allowed' | 'blocked' | 'unavailable';

const meter = instanceMetrics.getMeter('workspaces');

const workspaceCreatedCount = meter.createCounter<Record<string, never>>('workspaces_created', {
  description: 'Workspaces created',
});

const membershipChangedCount = meter.createCounter<{
  action: WorkspacesMembershipChangeAction;
}>('workspaces_membership_changed', {
  description: 'Workspace membership changes by action',
});

const invitationCreatedCount = meter.createCounter<{
  email_requested: WorkspacesInvitationEmailRequested;
}>('workspaces_invitation_created', {
  description: 'Workspace invitations created by whether an invitation email was requested',
});

const invitationAcceptedCount = meter.createCounter<{
  outcome: WorkspacesInvitationAcceptOutcome;
}>('workspaces_invitation_accepted', {
  description: 'Workspace invitations accepted by membership outcome',
});

const workspaceRateLimitCheckCount = meter.createCounter<{
  action: 'slug-availability';
  outcome: WorkspacesRateLimitOutcome;
}>('workspaces_rate_limit_checks', {
  description: 'Workspace rate-limit checks by action and outcome',
});

const workspaceRateLimitPruneFailureCount = meter.createCounter(
  'workspaces_rate_limit_prune_failures',
  {
    description: 'Workspace rate-limit prune failures',
  },
);

function recordMetric(record: () => void): void {
  try {
    record();
  } catch {
    // Metrics must not affect workspace mutations.
  }
}

export function recordWorkspaceCreated(): void {
  recordMetric(() => workspaceCreatedCount.add(1));
}

export function recordWorkspaceMembershipChanged(action: WorkspacesMembershipChangeAction): void {
  recordMetric(() => membershipChangedCount.add(1, {action}));
}

export function recordWorkspaceInvitationCreated(
  emailRequested: WorkspacesInvitationEmailRequested,
): void {
  recordMetric(() => invitationCreatedCount.add(1, {email_requested: emailRequested}));
}

export function recordWorkspaceInvitationAccepted(
  outcome: WorkspacesInvitationAcceptOutcome,
): void {
  recordMetric(() => invitationAcceptedCount.add(1, {outcome}));
}

export function recordWorkspaceRateLimitCheck(params: {
  action: 'slug-availability';
  outcome: WorkspacesRateLimitOutcome;
}): void {
  recordMetric(() => workspaceRateLimitCheckCount.add(1, params));
}

export function recordWorkspaceRateLimitPruneFailure(): void {
  recordMetric(() => workspaceRateLimitPruneFailureCount.add(1));
}
