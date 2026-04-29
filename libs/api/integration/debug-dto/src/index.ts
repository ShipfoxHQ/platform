import {z} from 'zod';

export const createDebugConnectionBodySchema = z.object({
  workspace_id: z.string().uuid(),
});
export type CreateDebugConnectionBodyDto = z.infer<typeof createDebugConnectionBodySchema>;
