import {z} from 'zod';

export const e2eDispatchListenerEventBodySchema = z
  .object({
    workspace_id: z.string().uuid(),
    connection_id: z.string().uuid(),
    source: z.string().min(1),
    event: z.string().min(1),
    delivery_id: z.string().min(1),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
export type E2eDispatchListenerEventBodyDto = z.infer<typeof e2eDispatchListenerEventBodySchema>;

export const e2eDispatchListenerEventResponseSchema = z
  .object({
    event_ref: z.string().uuid(),
    delivery_id: z.string().min(1),
  })
  .strict();
export type E2eDispatchListenerEventResponseDto = z.infer<
  typeof e2eDispatchListenerEventResponseSchema
>;
