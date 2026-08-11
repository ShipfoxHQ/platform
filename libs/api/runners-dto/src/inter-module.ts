import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';
import {runnerToolCapabilitiesSchema} from '#schemas/tool-capabilities.js';

const idSchema = z.string().uuid();

export const runnersInterModuleContract = defineInterModuleContract({
  module: 'runners',
  methods: {
    getLeaseState: {
      input: z.object({
        jobId: idSchema,
        jobExecutionId: idSchema,
        runnerSessionId: idSchema,
      }),
      output: z.object({active: z.boolean()}),
    },
    getEffectiveRunnerToolCapabilities: {
      input: z.object({runnerSessionId: idSchema}),
      output: z.object({
        capabilities: runnerToolCapabilitiesSchema,
        reportFresh: z.boolean(),
      }),
    },
    getWorkspaceJobCounts: {
      input: z.object({workspaceIds: z.array(idSchema).min(1).max(100)}),
      output: z.object({
        counts: z.array(
          z.object({
            workspaceId: idSchema,
            queued: z.number().int().nonnegative(),
            running: z.number().int().nonnegative(),
          }),
        ),
      }),
    },
  },
});

export type RunnersInterModuleClient = InterModuleClient<typeof runnersInterModuleContract>;
