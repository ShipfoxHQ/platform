import {z} from 'zod';

export const workspaceStatusSchema = z.enum(['active', 'suspended', 'deleted']);

export const createWorkspaceBodySchema = z.object({
  name: z.string().min(1).max(255),
});

export type CreateWorkspaceBodyDto = z.infer<typeof createWorkspaceBodySchema>;

export const workspaceDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: workspaceStatusSchema,
  settings: z.record(z.unknown()),
  created_at: z.string(),
  updated_at: z.string(),
});

export type WorkspaceDto = z.infer<typeof workspaceDtoSchema>;

export const workspaceResponseSchema = workspaceDtoSchema;

export type WorkspaceResponseDto = z.infer<typeof workspaceResponseSchema>;
