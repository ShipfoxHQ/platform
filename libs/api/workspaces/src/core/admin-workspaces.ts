import {createHash} from 'node:crypto';
import {type AdministrationRole, createAdministrationActionEvent} from '@shipfox/api-common-dto';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import type {StringIdCursor} from '@shipfox/node-drizzle';
import {logger} from '@shipfox/node-opentelemetry';
import {
  reactivateWorkspaceWithAudit,
  suspendWorkspaceWithAudit,
} from '#db/admin-workspace-commands.js';
import {listAdminWorkspaces as listAdminWorkspaceRows} from '#db/workspaces.js';

const ADMIN_OPERATOR_ROLE: AdministrationRole = 'admin-operator';
const SUSPEND_COMMAND = 'workspace.suspend';
const REACTIVATE_COMMAND = 'workspace.reactivate';

export interface WorkspaceAdministrationMutationContext {
  actorId: string;
  actorRole: AdministrationRole;
  idempotencyKey: string;
  correlationId: string;
  workspaceId: string;
  reason: string;
}

export interface WorkspaceAdministrationMutationResult {
  workspaceId: string;
  status: 'active' | 'suspended';
  correlationId: string;
}

function hashAdministrationValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function commandFingerprint(
  command: string,
  params: WorkspaceAdministrationMutationContext,
): string {
  return hashAdministrationValue(
    `${command}:${JSON.stringify({workspaceId: params.workspaceId, reason: params.reason})}`,
  );
}

function administrationEvent(params: {
  actorId: string;
  actorRole: AdministrationRole;
  command: string;
  workspaceId: string;
  reason: string;
  correlationId: string;
  idempotencyKeyFingerprint: string;
}) {
  return createAdministrationActionEvent({
    actorId: params.actorId,
    actorRole: params.actorRole,
    requiredRole: ADMIN_OPERATOR_ROLE,
    command: params.command,
    targetType: 'workspace',
    targetId: params.workspaceId,
    reason: params.reason,
    result: 'succeeded',
    correlationId: params.correlationId,
    idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
    occurredAt: new Date().toISOString(),
  });
}

async function runWorkspaceAdministrationMutation(
  params: WorkspaceAdministrationMutationContext,
  command: string,
  update: typeof suspendWorkspaceWithAudit,
): Promise<WorkspaceAdministrationMutationResult> {
  const idempotencyKeyFingerprint = hashAdministrationValue(params.idempotencyKey);
  const result = await update({
    actorId: params.actorId,
    workspaceId: params.workspaceId,
    idempotencyKeyFingerprint,
    requestFingerprint: commandFingerprint(command, params),
    event: administrationEvent({
      actorId: params.actorId,
      actorRole: params.actorRole,
      command,
      workspaceId: params.workspaceId,
      reason: params.reason,
      correlationId: params.correlationId,
      idempotencyKeyFingerprint,
    }),
  });
  return result;
}

export async function suspendWorkspace(
  params: WorkspaceAdministrationMutationContext,
): Promise<WorkspaceAdministrationMutationResult> {
  return await runWorkspaceAdministrationMutation(
    params,
    SUSPEND_COMMAND,
    suspendWorkspaceWithAudit,
  );
}

export async function reactivateWorkspace(
  params: WorkspaceAdministrationMutationContext,
): Promise<WorkspaceAdministrationMutationResult> {
  return await runWorkspaceAdministrationMutation(
    params,
    REACTIVATE_COMMAND,
    reactivateWorkspaceWithAudit,
  );
}

export interface WorkspaceAdministratorSummary {
  id: string;
  name: string;
  status: 'active' | 'suspended' | 'deleted';
  memberSummary: {count: number};
  projectSummary: {state: 'available'; count: number} | {state: 'unknown'};
  jobCounts: {state: 'available'; queued: number; running: number} | {state: 'unknown'};
  createdAt: Date;
  updatedAt: Date;
}

export interface ListWorkspaceAdministratorSummariesParams {
  workspaceId?: string | undefined;
  search?: string | undefined;
  status?: 'active' | 'suspended' | 'deleted' | undefined;
  limit: number;
  cursor?: StringIdCursor | undefined;
  projects: ProjectsModuleClient;
  runners: RunnersInterModuleClient;
}

export interface ListWorkspaceAdministratorSummariesResult {
  workspaces: WorkspaceAdministratorSummary[];
  nextCursor: StringIdCursor | null;
}

export async function listWorkspaceAdministratorSummaries(
  params: ListWorkspaceAdministratorSummariesParams,
): Promise<ListWorkspaceAdministratorSummariesResult> {
  const result = await listAdminWorkspaceRows(params);
  const workspaceIds = result.workspaces.map(({id}) => id);
  const [projectCounts, jobCounts] = await Promise.all([
    getProjectCounts(params.projects, workspaceIds),
    getJobCounts(params.runners, workspaceIds),
  ]);

  return {
    workspaces: result.workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      status: workspace.status,
      memberSummary: {count: workspace.memberCount},
      projectSummary: projectCounts?.get(workspace.id) ?? {state: 'unknown'},
      jobCounts: jobCounts?.get(workspace.id) ?? {state: 'unknown'},
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    })),
    nextCursor: result.nextCursor,
  };
}

async function getProjectCounts(
  projects: ProjectsModuleClient,
  workspaceIds: string[],
): Promise<Map<string, {state: 'available'; count: number} | {state: 'unknown'}> | null> {
  if (workspaceIds.length === 0) return new Map();

  try {
    const result = await projects.getWorkspaceProjectCounts({workspaceIds});
    const counts = new Map(
      result.counts.map(({workspaceId, count}) => [
        workspaceId,
        {state: 'available', count} as const,
      ]),
    );
    return new Map(
      workspaceIds.map((workspaceId) => [
        workspaceId,
        counts.get(workspaceId) ?? {state: 'unknown'},
      ]),
    );
  } catch (error) {
    logger().warn(
      {operation: 'admin-workspace-project-summary', err: error},
      'Project summary unavailable',
    );
    return null;
  }
}

async function getJobCounts(
  runners: RunnersInterModuleClient,
  workspaceIds: string[],
): Promise<Map<
  string,
  {state: 'available'; queued: number; running: number} | {state: 'unknown'}
> | null> {
  if (workspaceIds.length === 0) return new Map();

  try {
    const result = await runners.getWorkspaceJobCounts({workspaceIds});
    const counts = new Map(
      result.counts.map(({workspaceId, queued, running}) => [
        workspaceId,
        {state: 'available', queued, running} as const,
      ]),
    );
    return new Map(
      workspaceIds.map((workspaceId) => [
        workspaceId,
        counts.get(workspaceId) ?? {state: 'unknown'},
      ]),
    );
  } catch (error) {
    logger().warn({operation: 'admin-workspace-job-counts', err: error}, 'Job counts unavailable');
    return null;
  }
}
