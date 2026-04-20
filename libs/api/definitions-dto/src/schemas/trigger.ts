import {z} from 'zod';

export const triggerSchema = z.object({
  type: z.string(),
  on: z.union([z.string(), z.array(z.string())]).optional(),
  with: z.record(z.unknown()).optional(),
  filter: z.string().optional(),
});

export type TriggerDto = z.infer<typeof triggerSchema>;
