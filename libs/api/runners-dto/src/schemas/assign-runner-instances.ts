import {z} from 'zod';

export const RESERVATION_EXPIRED_ERROR_CODE = 'reservation-expired';
export const RUNNER_INSTANCE_NOT_ASSIGNABLE_ERROR_CODE = 'runner-instance-not-assignable';

export const assignRunnerInstancesBodySchema = z
  .object({
    reservation_id: z.string().uuid(),
    runner_instance_ids: z.array(z.string().uuid()).min(1).max(1000),
  })
  .strict()
  .refine((body) => new Set(body.runner_instance_ids).size === body.runner_instance_ids.length, {
    message: 'runner_instance_ids values must be unique',
    path: ['runner_instance_ids'],
  });

export const assignRunnerInstancesResponseSchema = z.object({
  runner_instance_ids: z.array(z.string().uuid()),
});

export type AssignRunnerInstancesBodyDto = z.infer<typeof assignRunnerInstancesBodySchema>;
export type AssignRunnerInstancesResponseDto = z.infer<typeof assignRunnerInstancesResponseSchema>;
