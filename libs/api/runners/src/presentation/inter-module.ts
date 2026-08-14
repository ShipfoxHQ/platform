import {runnersInterModuleContract} from '@shipfox/api-runners-dto/inter-module';
import {defineInterModulePresentation, type InterModulePresentation} from '@shipfox/inter-module';
import {getEffectiveRunnerToolCapabilities} from '#core/runner-tool-capabilities.js';
import {getWorkspaceJobCounts, isJobLeaseActive} from '#db/job-executions.js';

export function createRunnersInterModulePresentation(): InterModulePresentation<
  typeof runnersInterModuleContract
> {
  return defineInterModulePresentation(runnersInterModuleContract, {
    getLeaseState: async (input) => ({active: await isJobLeaseActive(input)}),
    getEffectiveRunnerToolCapabilities: async (input) => {
      const result = await getEffectiveRunnerToolCapabilities(input);
      return {capabilities: result.capabilities, reportFresh: result.reportFresh};
    },
    getWorkspaceJobCounts: async ({workspaceIds}) => ({
      counts: await getWorkspaceJobCounts({workspaceIds}),
    }),
  });
}
