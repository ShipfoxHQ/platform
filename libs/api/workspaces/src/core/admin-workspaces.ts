import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import type {StringIdCursor} from '@shipfox/node-drizzle';
import {logger} from '@shipfox/node-opentelemetry';
import {listAdminWorkspaces as listAdminWorkspaceRows} from '#db/workspaces.js';

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
