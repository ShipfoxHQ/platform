import {z} from 'zod';

export const jobPayloadStepSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  type: z.string(),
  config: z.record(z.unknown()),
  position: z.number(),
});

export type JobPayloadStepDto = z.infer<typeof jobPayloadStepSchema>;

export const jobPayloadSchema = z.object({
  job_id: z.string().uuid(),
  run_id: z.string().uuid(),
  job_name: z.string(),
  steps: z.array(jobPayloadStepSchema),
});

export type JobPayloadDto = z.infer<typeof jobPayloadSchema>;

export const jobPayloadResponseSchema = jobPayloadSchema;
export type JobPayloadResponseDto = z.infer<typeof jobPayloadResponseSchema>;
