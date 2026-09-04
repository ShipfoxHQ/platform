import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';

const activeLeases = new Set<string>();
const leaseStates = new Map<
  string,
  Awaited<ReturnType<RunnersInterModuleClient['getLeaseState']>>
>();
const toolCapabilities = new Map<
  string,
  Awaited<ReturnType<RunnersInterModuleClient['getEffectiveRunnerToolCapabilities']>>
>();

function leaseKey(params: {
  jobId: string;
  jobExecutionId: string;
  runnerSessionId: string;
}): string {
  return `${params.jobId}:${params.jobExecutionId}:${params.runnerSessionId}`;
}

export function registerActiveRunnerLease(params: {
  jobId: string;
  jobExecutionId: string;
  runnerSessionId: string;
  renewableInference?: boolean | undefined;
}): void {
  const key = leaseKey(params);
  activeLeases.add(key);
  leaseStates.set(key, {
    active: true,
    ...(params.renewableInference === undefined
      ? {}
      : {renewableInference: params.renewableInference}),
  });
}

export function setRunnerToolCapabilities(
  runnerSessionId: string,
  capabilities: Awaited<ReturnType<RunnersInterModuleClient['getEffectiveRunnerToolCapabilities']>>,
): void {
  toolCapabilities.set(runnerSessionId, capabilities);
}

export function resetRunnersTestClient(): void {
  activeLeases.clear();
  leaseStates.clear();
  toolCapabilities.clear();
}

export const runnersTestClient: RunnersInterModuleClient = {
  getLeaseState: async (params) =>
    leaseStates.get(leaseKey(params)) ?? {active: activeLeases.has(leaseKey(params))},
  getEffectiveRunnerToolCapabilities: async ({runnerSessionId}) =>
    toolCapabilities.get(runnerSessionId) ?? {capabilities: {harnesses: {}}, reportFresh: false},
  getWorkspaceJobCounts: async ({workspaceIds}) => ({
    counts: workspaceIds.map((workspaceId) => ({workspaceId, queued: 0, running: 0})),
  }),
};
