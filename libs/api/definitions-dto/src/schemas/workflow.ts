import {z} from 'zod';
import {jobSchema} from './job.js';
import {triggerSchema} from './trigger.js';

export const workflowSpecSchema = z.object({
  name: z.string().min(1),
  triggers: z.record(triggerSchema).optional(),
  runner: z.union([z.string(), z.array(z.string())]).optional(),
  jobs: z.record(jobSchema),
});

export type WorkflowSpecDto = z.infer<typeof workflowSpecSchema>;
