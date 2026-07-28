import {runnersInterModuleContract} from '@shipfox/api-runners-dto/inter-module';
import {
  createInterModuleKnownError,
  defineInterModulePresentation,
  type InterModulePresentation,
} from '@shipfox/inter-module';
import {EmptyRequiredLabelsError} from '#core/errors.js';
import {getEffectiveRunnerToolCapabilities} from '#core/runner-tool-capabilities.js';
import {
  cancelRunnerJobs,
  enqueueJobExecution,
  getWorkspaceJobCounts,
  isJobLeaseActive,
  releaseJobExecution,
} from '#db/job-executions.js';

export function createRunnersInterModulePresentation(): InterModulePresentation<
  typeof runnersInterModuleContract
> {
  return defineInterModulePresentation(runnersInterModuleContract, {
    enqueueJobExecution: async (input) => {
      try {
        await enqueueJobExecution(input);
        return {};
      } catch (error) {
        throw toEnqueueJobExecutionKnownError(error);
      }
    },
    releaseJobExecution: async (input) => {
      await releaseJobExecution(input);
      return {};
    },
    cancelJobs: async (input) => {
      await cancelRunnerJobs(input);
      return {};
    },
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

export function toEnqueueJobExecutionKnownError(error: unknown): unknown {
  if (error instanceof EmptyRequiredLabelsError) {
    return createInterModuleKnownError(
      runnersInterModuleContract.methods.enqueueJobExecution,
      'empty-required-labels',
      {},
    );
  }
  return error;
}
